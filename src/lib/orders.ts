/**
 * 订单最小存储（MVP）
 * ==================
 * 现状：进程内 Map 实现。重启 / serverless 新实例即失，仅够让「webhook 落库 →
 * 报告页验证」链路先跑通，不适合当生产唯一数据源。
 *
 * 接 DB 的入口（P4）：
 *   1. 新建 `src/lib/orders-db.ts`，实现同一个 `OrderStore` 接口（get/upsert/list/clear）；
 *   2. 在 `getOrderStore()` 里按 `process.env.DATABASE_URL` 选择内存或 DB 实现；
 *   3. 路由 / 页面只依赖 `OrderStore` 接口，不用改。
 *
 * 幂等语义：同一订单重复投递（Lemon Squeezy webhook 重试）不会产生第二条记录，
 * `upsert()` 返回 `{ created:false, changed:false }`；已完成/已退款的终态不会被
 * 迟到的旧事件改回去。
 *
 * 注意：本模块只在服务端（API route / server component）使用，不要被客户端组件 import。
 */

export type OrderStatus = "completed" | "refunded" | "canceled" | "pending";

export type OrderRecord = {
  orderId: string;
  variantId: string;
  email: string;
  status: OrderStatus;
  /** Lemon Squeezy `checkout_data.custom` / webhook `meta.custom_data`；报告页用它重建报告 */
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  /** 最近一次写入该订单的 Lemon Squeezy 事件名（order_created / order_refunded …） */
  lastEventName: string;
  /** Lemon Squeezy 测试模式订单 */
  testMode: boolean;
};

export type OrderUpsertResult = {
  order: OrderRecord;
  /** 该 orderId 是否首次入库 */
  created: boolean;
  /** 本次投递是否改变了订单的可观察字段（幂等重放时为 false） */
  changed: boolean;
};

export interface OrderStore {
  get(orderId: string): Promise<OrderRecord | null>;
  upsert(order: OrderRecord): Promise<OrderUpsertResult>;
  list(): Promise<OrderRecord[]>;
  /** 仅测试 / 运维用；DB 实现里等价于 truncate */
  clear(): Promise<void>;
}

const TERMINAL_STATUSES: readonly OrderStatus[] = ["refunded", "canceled"];

function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * 状态合并规则：
 * - 已到终态（refunded / canceled）的订单，迟到的旧事件不能把它改回 completed；
 * - pending 事件不能把已完成的订单降级；
 * - 其余以新事件为准（completed → refunded/canceled 可以）。
 */
export function mergeOrderStatus(
  current: OrderStatus,
  incoming: OrderStatus
): OrderStatus {
  if (isTerminal(current) && current !== incoming) return current;
  if (incoming === "pending" && current !== "pending") return current;
  return incoming;
}

function isSameOrder(a: OrderRecord, b: OrderRecord): boolean {
  return (
    a.status === b.status &&
    a.email === b.email &&
    a.variantId === b.variantId &&
    a.completedAt === b.completedAt &&
    a.testMode === b.testMode &&
    JSON.stringify(a.custom) === JSON.stringify(b.custom)
  );
}

/** 内存订单存储（进程级单例由 getOrderStore 维护） */
export class InMemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, OrderRecord>();

  async get(orderId: string): Promise<OrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }

  async list(): Promise<OrderRecord[]> {
    return [...this.orders.values()];
  }

  async clear(): Promise<void> {
    this.orders.clear();
  }

  async upsert(incoming: OrderRecord): Promise<OrderUpsertResult> {
    const current = this.orders.get(incoming.orderId);
    if (!current) {
      this.orders.set(incoming.orderId, incoming);
      return { order: incoming, created: true, changed: true };
    }

    const status = mergeOrderStatus(current.status, incoming.status);
    const merged: OrderRecord = {
      ...current,
      email: incoming.email || current.email,
      variantId: incoming.variantId || current.variantId,
      status,
      custom:
        Object.keys(incoming.custom).length > 0
          ? { ...current.custom, ...incoming.custom }
          : current.custom,
      updatedAt: incoming.updatedAt || current.updatedAt,
      completedAt:
        status === "completed"
          ? incoming.completedAt || current.completedAt
          : current.completedAt,
      lastEventName: incoming.lastEventName || current.lastEventName,
      testMode: incoming.testMode || current.testMode,
    };

    const changed = !isSameOrder(current, merged);
    if (!changed) return { order: current, created: false, changed: false };

    this.orders.set(incoming.orderId, merged);
    return { order: merged, created: false, changed: true };
  }
}

let activeStore: OrderStore = new InMemoryOrderStore();

/** 当前订单存储（路由里统一从这里取，便于以后切 DB） */
export function getOrderStore(): OrderStore {
  return activeStore;
}

/** 注入订单存储（测试 / 切 DB 时用） */
export function setOrderStore(store: OrderStore): void {
  activeStore = store;
}

/** 重置为全新的内存存储（仅测试用） */
export function resetOrderStore(): void {
  activeStore = new InMemoryOrderStore();
}

/* ===== Lemon Squeezy webhook 事件 → OrderRecord ===== */

/** 支持的事件名：LS 新版 snake_case + 旧版点号命名（兼容历史 webhook 配置） */
export const LEMON_ORDER_EVENTS: readonly string[] = [
  "order_created",
  "order_updated",
  "order_refunded",
  "order_cancelled",
  "order_canceled",
  "order.completed",
  "order.refunded",
  "order.canceled",
  "checkout.completed",
];

const ORDER_EVENT_SET = new Set(LEMON_ORDER_EVENTS);

export function isLemonOrderEvent(eventName: string): boolean {
  return ORDER_EVENT_SET.has(eventName.trim().toLowerCase());
}

const RAW_STATUS_MAP: Record<string, OrderStatus> = {
  paid: "completed",
  completed: "completed",
  succeeded: "completed",
  refunded: "refunded",
  cancelled: "canceled",
  canceled: "canceled",
  pending: "pending",
  failed: "pending",
  unpaid: "pending",
};

/**
 * 把 LS 订单状态字段 + 事件名映射成内部状态。
 * LS 订单事件：
 *   order_created  → order.status = paid / pending …
 *   order_refunded → order.status = refunded
 *   order_cancelled→ order.status = cancelled（美式拼写也兼容）
 */
export function mapOrderStatus(raw: unknown, eventName = ""): OrderStatus {
  const event = eventName.toLowerCase();
  if (event.includes("refund")) return "refunded";
  if (event.includes("cancel")) return "canceled";

  const key = readString(raw).toLowerCase();
  const direct = RAW_STATUS_MAP[key];
  if (direct) return direct;

  // 没有 status 字段时按事件名兜底：completed / paid 才算完成，其余留 pending（宁可不放行）
  if (event.includes("completed") || event.includes("paid")) return "completed";
  return "pending";
}

export type ParsedLemonOrderEvent = {
  eventName: string;
  /** 非订单事件（或缺少订单 id）时为 null，路由应 200 忽略以防 LS 重试 */
  order: OrderRecord | null;
};

/**
 * 解析 Lemon Squeezy webhook：
 * - 事件名：优先 `X-Event-Name` header，其次 `meta.event_name`，最后旧版 `event`
 * - 订单 id：`data.id`（order_created 等事件），旧版 checkout 事件回退 `attributes.order_id`
 * - custom：`meta.custom_data`（新版）→ `attributes.custom_data` → `attributes.custom`（旧版）
 */
export function parseLemonOrderEvent(
  payload: unknown,
  headerEventName?: string | null,
  now: Date = new Date()
): ParsedLemonOrderEvent {
  const root = isRecord(payload) ? payload : {};
  const meta = isRecord(root.meta) ? root.meta : {};
  const data = isRecord(root.data) ? root.data : {};
  const attrs = isRecord(data.attributes) ? data.attributes : {};
  const firstItem = isRecord(attrs.first_order_item)
    ? attrs.first_order_item
    : {};

  const eventName = (
    headerEventName ||
    readString(meta.event_name) ||
    readString(root.event) ||
    ""
  ).trim();

  const orderId = readString(data.id) || readString(attrs.order_id);
  if (!orderId) return { eventName, order: null };

  const status = mapOrderStatus(attrs.status ?? attrs.order_status, eventName);
  const createdAt = readString(attrs.created_at) || now.toISOString();
  const updatedAt = readString(attrs.updated_at) || createdAt;
  const completedAt =
    readString(attrs.completed_at) ||
    (status === "completed" ? updatedAt : "");

  const order: OrderRecord = {
    orderId,
    variantId:
      readString(firstItem.variant_id) || readString(attrs.variant_id),
    email:
      readString(attrs.user_email) ||
      readString(attrs.email) ||
      readString(attrs.customer_email),
    status,
    custom: toCustom(meta.custom_data ?? attrs.custom_data ?? attrs.custom),
    createdAt,
    updatedAt,
    completedAt,
    lastEventName: eventName,
    testMode: meta.test_mode === true || attrs.test_mode === true,
  };

  return { eventName, order };
}

/* ===== 小工具 ===== */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return "";
}

function toCustom(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = item;
  return out;
}
