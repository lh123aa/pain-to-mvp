/**
 * 订单存储抽象 + 状态机（MVP → W3 持久化）
 * =========================================
 * 存储选择（见 getOrderStore）：
 *   - `ORDERS_DATA_DIR` 有值 → `FileOrderStore`（JSON 文件，原子写 + 进程内串行队列，
 *     跨重启保留；适合**单实例 / staging / 本地**）；
 *   - 未设置 → `InMemoryOrderStore`（进程内 Map；测试 / CI 默认，重启即失）。
 *
 * ⚠️ Vercel serverless / 多实例部署**不能**用文件存储（实例间不共享、文件系统临时）：
 *   需要 Postgres。Adapter 接口不变——实现同一个 `OrderStore` 的 `PgOrderStore`
 *   （`src/lib/order-store-pg.ts` 待接入），然后在 getOrderStore() 按 env 选择即可，
 *   路由 / 页面 / 测试都不用改。
 *
 * 接 DB 的入口（P4）：
 *   1. 新建 `src/lib/order-store-pg.ts`，实现 `OrderStore`
 *      （get / upsert / list / clear / refundOrder / deleteOrderAnalysis）；
 *   2. 在 `getOrderStore()` 里按 `process.env.DATABASE_URL` 选择实现；
 *   3. 路由 / 页面只依赖 `OrderStore` 接口，不用改。
 *
 * 状态机（W2-2 退款/删除）：
 *   pending / completed → refunded → deleted     （refunded 是终态；deleted 是绝对终态）
 *   completed → deleted                          （用户只删数据、不退款也允许）
 *   canceled 保持原有终态语义；deleted 一旦进入绝不回退，也不允许被 webhook 重放改回。
 *
 * 幂等语义：同一订单重复投递（Lemon Squeezy webhook 重试）不会产生第二条记录，
 * `upsert()` 返回 `{ created:false, changed:false }`；终态不会被迟到的旧事件改回去。
 *
 * 注意：本模块只在服务端（API route / server component）使用，不要被客户端组件 import。
 *       （它会经 order-store-file 间接依赖 node:fs，客户端引用会构建失败。）
 */

import { createFileOrderStore } from "./order-store-file";

export type OrderStatus =
  | "completed"
  | "refunded"
  | "canceled"
  | "pending"
  /** 数据分析结果已删除（隐私删除请求），不可回退 */
  | "deleted";

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
  /** 退款时间（ISO）；status=refunded 后写入 */
  refundedAt?: string;
  /** 数据删除时间（ISO）；status=deleted 后写入 */
  deletedAt?: string;
  /**
   * checkout 页生成的关联 id（`tell_<random>`，W3-2 跨设备报告链路）。
   * 通过 LS `checkout_data.custom.client_ref` 提交，webhook 的
   * `meta.custom_data.client_ref` 回传后落在这里；
   * `GET /api/order-status?ref=` 用它把「浏览器里的 checkout」和「服务端订单」对上。
   * 非 PII，可安全保留；删除报告时不清除（用于审计 / 幂等）。
   */
  clientRef?: string;
};

export type OrderUpsertResult = {
  order: OrderRecord;
  /** 该 orderId 是否首次入库 */
  created: boolean;
  /** 本次投递是否改变了订单的可观察字段（幂等重放时为 false） */
  changed: boolean;
};

/** 退款 / 删除这类订单状态变更的结果 */
export type OrderMutationResult =
  | { ok: true; order: OrderRecord; changed: boolean }
  | { ok: false; reason: "not-found" | "invalid-transition" };

export interface OrderStore {
  get(orderId: string): Promise<OrderRecord | null>;
  upsert(order: OrderRecord): Promise<OrderUpsertResult>;
  list(): Promise<OrderRecord[]>;
  /** 仅测试 / 运维用；DB 实现里等价于 truncate */
  clear(): Promise<void>;
  /**
   * 状态机 completed → refunded（幂等）。
   * - 未找到 → not-found
   * - refunded 重复调用 → ok + changed=false
   * - deleted / canceled / pending → invalid-transition
   * DB 实现必须用事务 / 条件更新保证不重复退款（例如 `UPDATE ... WHERE status='completed'`）。
   */
  refundOrder(orderId: string, at?: Date | string): Promise<OrderMutationResult>;
  /**
   * 删除分析数据 + 脱敏（email / custom 清空），状态 → deleted（幂等，终态不回退）。
   * 未找到 → not-found；已 deleted → ok + changed=false。
   * DB 实现：DELETE 关联分析数据行 + UPDATE orders SET status='deleted', email=''。
   */
  deleteOrderAnalysis(
    orderId: string,
    at?: Date | string
  ): Promise<OrderMutationResult>;
  /**
   * 可选：按 checkout 页生成的 clientRef 查订单（W3-2）。
   * InMemory / File 用 list() 兜底即可；PgOrderStore 建议加
   * `CREATE UNIQUE INDEX orders_client_ref_idx ON orders(client_ref)` 后实现本方法。
   */
  findByClientRef?(clientRef: string): Promise<OrderRecord | null>;
}

const TERMINAL_STATUSES: readonly OrderStatus[] = [
  "refunded",
  "canceled",
  "deleted",
];

function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * 状态合并规则（webhook 重放 vs 退款/删除状态机都不回退）：
 * - deleted 是绝对终态：任何事件都不能改动它；
 * - 任何状态收到 deleted 都进入 deleted（删除数据优先级最高）；
 * - refunded / canceled 终态：迟到的旧事件不能改回 completed；
 * - pending 事件不能把已完成的订单降级；
 * - 其余以新事件为准（completed → refunded 可以）。
 */
export function mergeOrderStatus(
  current: OrderStatus,
  incoming: OrderStatus
): OrderStatus {
  if (current === "deleted") return "deleted";
  if (incoming === "deleted") return "deleted";
  if (current === "refunded") return current;
  if (current === "canceled") return current;
  if (incoming === "pending" && current !== "pending") return current;
  return incoming;
}

/** refunded / canceled / deleted 都代表访问已吊销 */
export function isAccessRevokedStatus(status: OrderStatus): boolean {
  return isTerminal(status);
}

function isSameOrder(a: OrderRecord, b: OrderRecord): boolean {
  return (
    a.status === b.status &&
    a.email === b.email &&
    a.variantId === b.variantId &&
    a.completedAt === b.completedAt &&
    a.testMode === b.testMode &&
    a.refundedAt === b.refundedAt &&
    a.deletedAt === b.deletedAt &&
    a.clientRef === b.clientRef &&
    JSON.stringify(a.custom) === JSON.stringify(b.custom)
  );
}

/** 订单的 clientRef：优先顶层字段，兼容从文件存储回读后只在 custom 里的情况 */
export function getOrderClientRef(order: OrderRecord | null | undefined): string {
  if (!order) return "";
  return order.clientRef || readString(order.custom?.client_ref);
}

function toIsoString(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? value.toISOString()
      : new Date().toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed)
      ? new Date(parsed).toISOString()
      : new Date().toISOString();
  }
  return new Date().toISOString();
}

/* ===== 共享状态机实现（InMemory / File / 未来 Pg 复用，避免语义分叉） ===== */

export type UpsertTransition = {
  order: OrderRecord;
  created: boolean;
  changed: boolean;
};

/**
 * upsert 的纯逻辑：合并状态 + 合并 custom + deleted 只读保护。
 * 调用方（InMemory / File）负责持久化 changed/created 的结果。
 */
export function applyUpsertTransition(
  current: OrderRecord | null,
  incoming: OrderRecord
): UpsertTransition {
  if (!current) {
    return { order: incoming, created: true, changed: true };
  }

  // deleted 是绝对终态：数据已脱敏删除，webhook 重放不能把 PII/状态写回来
  if (current.status === "deleted") {
    return { order: current, created: false, changed: false };
  }

  const status = mergeOrderStatus(current.status, incoming.status);
  const merged: OrderRecord = {
    ...current,
    email: incoming.email || current.email,
    variantId: incoming.variantId || current.variantId,
    status,
    // clientRef 只增不减：webhook 重放缺字段时保留已有值
    clientRef:
      incoming.clientRef || getOrderClientRef(current) || undefined,
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

  if (isSameOrder(current, merged)) {
    return { order: current, created: false, changed: false };
  }
  return { order: merged, created: false, changed: true };
}

/** refundOrder 的纯逻辑（假设 current 存在；调用方先处理 not-found） */
export function applyRefundTransition(
  current: OrderRecord,
  at?: Date | string
): OrderMutationResult {
  if (current.status === "refunded") {
    // 幂等：重复退款请求不再改动
    return { ok: true, order: current, changed: false };
  }
  if (current.status !== "completed") {
    // pending 未付款 / canceled / deleted 均不可退款
    return { ok: false, reason: "invalid-transition" };
  }

  const atIso = toIsoString(at);
  return {
    ok: true,
    order: {
      ...current,
      status: "refunded",
      refundedAt: current.refundedAt || atIso,
      updatedAt: atIso,
    },
    changed: true,
  };
}

/** deleteOrderAnalysis 的纯逻辑（假设 current 存在；调用方先处理 not-found） */
export function applyDeleteTransition(
  current: OrderRecord,
  at?: Date | string
): OrderMutationResult {
  if (current.status === "deleted") {
    return { ok: true, order: current, changed: false };
  }

  const atIso = toIsoString(at);
  // 删除/脱敏：分析输入（custom）、邮箱、variant 都不再保留；只留订单骨架用于
  // 幂等判断与审计（orderId / 状态 / 时间戳）。接 DB 时同步删除关联分析行。
  return {
    ok: true,
    order: {
      ...current,
      status: "deleted",
      email: "",
      variantId: "",
      custom: {},
      updatedAt: atIso,
      deletedAt: atIso,
    },
    changed: true,
  };
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
    const current = this.orders.get(incoming.orderId) ?? null;
    const transition = applyUpsertTransition(current, incoming);
    if (transition.created || transition.changed) {
      this.orders.set(incoming.orderId, transition.order);
    }
    return {
      order: transition.order,
      created: transition.created,
      changed: transition.changed,
    };
  }

  async refundOrder(
    orderId: string,
    at?: Date | string
  ): Promise<OrderMutationResult> {
    const current = this.orders.get(orderId);
    if (!current) return { ok: false, reason: "not-found" };
    const result = applyRefundTransition(current, at);
    if (result.ok && result.changed) {
      this.orders.set(orderId, result.order);
    }
    return result;
  }

  async deleteOrderAnalysis(
    orderId: string,
    at?: Date | string
  ): Promise<OrderMutationResult> {
    const current = this.orders.get(orderId);
    if (!current) return { ok: false, reason: "not-found" };
    const result = applyDeleteTransition(current, at);
    if (result.ok && result.changed) {
      this.orders.set(orderId, result.order);
    }
    return result;
  }

  async findByClientRef(clientRef: string): Promise<OrderRecord | null> {
    const ref = clientRef.trim();
    if (!ref) return null;
    for (const order of this.orders.values()) {
      if (getOrderClientRef(order) === ref) return order;
    }
    return null;
  }
}

/* ===== 存储选择（内存 / 文件 / 注入） ===== */

export type OrderStoreKind = "memory" | "file" | "injected";

let activeStore: OrderStore | null = null;
let activeStoreKind: OrderStoreKind | null = null;

/**
 * 当前订单存储单例（路由统一从这里取）。
 *
 * 选择规则（首次调用时按 env 决定，之后复用单例）：
 *   - `ORDERS_DATA_DIR` 非空 → FileOrderStore(该目录)，JSON 持久化；
 *   - 否则 → InMemoryOrderStore（测试 / CI 默认，行为与 W2 完全一致）。
 *
 * ⚠️ file 模式适合单实例 / staging / 本地；Vercel serverless（多实例、临时文件系统）
 *    必须换 Postgres 实现（PgOrderStore，接口不变）。
 */
export function getOrderStore(): OrderStore {
  if (activeStore) return activeStore;

  const dataDir = process.env.ORDERS_DATA_DIR?.trim();
  if (dataDir) {
    activeStore = createFileOrderStore(dataDir);
    activeStoreKind = "file";
  } else {
    activeStore = new InMemoryOrderStore();
    activeStoreKind = "memory";
  }
  return activeStore;
}

/** 注入订单存储（测试 / 切 DB 时用） */
export function setOrderStore(store: OrderStore): void {
  activeStore = store;
  activeStoreKind = "injected";
}

/**
 * 重置单例（仅测试用）：清空后，下一次 getOrderStore() 重新按 env 选择
 * （CI / 现有测试没有 ORDERS_DATA_DIR → 仍然拿到全新内存存储，兼容原有行为）。
 */
export function resetOrderStore(): void {
  activeStore = null;
  activeStoreKind = null;
}

/** 当前存储类型，便于诊断 / 健康检查（首次调用会触发初始化） */
export function getOrderStoreKind(): OrderStoreKind {
  if (!activeStore) getOrderStore();
  return activeStoreKind ?? "memory";
}

/* ===== 订单状态变更（退款 / 删除）===== */

/**
 * completed → refunded（幂等）。调用方（/api/refund）负责 7 天窗口校验与
 * provider 调用；这里只做本地状态机。
 */
export async function refundOrder(
  orderId: string,
  at: Date | string = new Date()
): Promise<OrderMutationResult> {
  return getOrderStore().refundOrder(orderId, at);
}

/**
 * 删除分析数据 + 脱敏，状态 → deleted（幂等）。调用方（/api/delete-report）
 * 负责 token 校验与吊销魔链。
 */
export async function deleteOrderAnalysis(
  orderId: string,
  at: Date | string = new Date()
): Promise<OrderMutationResult> {
  return getOrderStore().deleteOrderAnalysis(orderId, at);
}

/** 访问是否已被吊销（退款 / 取消 / 删除 → true；未找到 → false） */
export async function isAccessRevoked(orderId: string): Promise<boolean> {
  const order = await getOrderStore().get(orderId);
  return !!order && isAccessRevokedStatus(order.status);
}

/**
 * 按 checkout 页生成的 clientRef 找订单（W3-2 跨设备报告链路）。
 * - 存储实现了 `findByClientRef` 就直接用（Pg 建议加唯一索引）；
 * - 否则回退 `list()` 扫描（内存 / 文件实现的小数据量足够）。
 */
export async function findOrderByClientRef(
  clientRef: string
): Promise<OrderRecord | null> {
  const ref = clientRef.trim();
  if (!ref) return null;

  const store = getOrderStore();
  if (typeof store.findByClientRef === "function") {
    const found = await store.findByClientRef(ref);
    if (found) return found;
  }

  const orders = await store.list();
  for (const order of orders) {
    if (getOrderClientRef(order) === ref) return order;
  }
  return null;
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

  // checkout_data.custom 会由 LS 原样回传到 webhook 的 meta.custom_data；
  // client_ref（W3-2）从 custom 里取出来提到顶层，便于按 ref 查订单。
  const custom = toCustom(meta.custom_data ?? attrs.custom_data ?? attrs.custom);
  const clientRef =
    readString(custom.client_ref) ||
    readString(meta.client_ref) ||
    readString(attrs.client_ref);

  const order: OrderRecord = {
    orderId,
    variantId:
      readString(firstItem.variant_id) || readString(attrs.variant_id),
    email:
      readString(attrs.user_email) ||
      readString(attrs.email) ||
      readString(attrs.customer_email),
    status,
    custom,
    createdAt,
    updatedAt,
    completedAt,
    lastEventName: eventName,
    testMode: meta.test_mode === true || attrs.test_mode === true,
    ...(clientRef ? { clientRef } : {}),
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
