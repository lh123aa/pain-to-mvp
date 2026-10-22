/**
 * FileOrderStore —— 基于 JSON 文件的 OrderStore 实现（W3-3）
 * =========================================================
 * 用途：让订单在**单实例 / staging / 本地**环境跨重启保留，便于把「webhook 落库 →
 * 退款/删除 → 报表验证」全链路在真实进程里跑通，而不用先上数据库。
 *
 * 设计要点：
 * - 文件：默认 `<dir>/orders.json`；目录不存在时首次写入自动创建。
 * - 初始化：构造时同步 load（小文件；避免首次请求时异步初始化竞态）。文件不存在 = 空库。
 * - 原子写：写 `<orders.json>.tmp` → rename 覆盖目标文件（同目录 rename 原子），
 *   进程崩溃不会留下半截 JSON。
 * - 并发：所有读写进入单例 Promise 队列，避免 read-modify-write 互相覆盖；
 *   （仅进程内串行；多进程同时写同一文件不在支持范围 —— 那需要 DB。）
 * - 损坏恢复：JSON 解析失败 / 结构不对 → 原文件重命名备份为 `<file>.corrupt-<ts>`，
 *   以空库继续，不抛错（服务不因坏文件起不来）。
 * - 不可恢复错误（目录不可读/不可写）→ 抛 `FileOrderStoreError`。
 *
 * ⚠️ 部署边界：Vercel serverless / 多实例共用不了本机文件；生产需要 Postgres。
 *    `OrderStore` 接口不变，实现 `PgOrderStore` 后在 getOrderStore() 按 env 切换即可。
 */

import { promises as fsp, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import type {
  OrderMutationResult,
  OrderRecord,
  OrderStatus,
  OrderStore,
  OrderUpsertResult,
} from "./orders";
import {
  applyDeleteTransition,
  applyRefundTransition,
  applyUpsertTransition,
} from "./orders";

export const DEFAULT_ORDERS_FILE_NAME = "orders.json";
const FILE_VERSION = 1;

export type FileOrderStoreOptions = {
  /** 文件名，默认 orders.json */
  fileName?: string;
};

/** FileOrderStore 不可恢复错误（IO 失败 / 目录不可用）；可恢复的损坏文件不抛 */
export class FileOrderStoreError extends Error {
  readonly code: string;

  constructor(
    message: string,
    options: { code?: string; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "FileOrderStoreError";
    this.code = options.code ?? "FILE_ORDER_STORE_ERROR";
  }
}

/** 内部标记：文件内容损坏（可恢复，备份后空库继续） */
class OrdersFileCorruptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "OrdersFileCorruptError";
  }
}

/**
 * JSON 文件订单存储。
 * 构造即 load；所有操作返回 Promise（写操作串行、原子落盘）。
 */
export class FileOrderStore implements OrderStore {
  readonly dir: string;
  /** 实际数据文件路径（诊断 / 测试用） */
  readonly filePath: string;

  private readonly tmpFilePath: string;
  private orders = new Map<string, OrderRecord>();
  private queue: Promise<void> = Promise.resolve();

  constructor(dir: string, options: FileOrderStoreOptions = {}) {
    const normalizedDir = dir.trim();
    if (!normalizedDir) {
      throw new FileOrderStoreError("FileOrderStore 需要非空目录");
    }
    this.dir = path.resolve(normalizedDir);
    this.filePath = path.join(
      this.dir,
      options.fileName ?? DEFAULT_ORDERS_FILE_NAME
    );
    this.tmpFilePath = `${this.filePath}.tmp`;
    this.loadSync();
  }

  async get(orderId: string): Promise<OrderRecord | null> {
    return this.enqueue(async () => this.orders.get(orderId) ?? null);
  }

  async list(): Promise<OrderRecord[]> {
    return this.enqueue(async () => [...this.orders.values()]);
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.commit(new Map());
    });
  }

  async upsert(incoming: OrderRecord): Promise<OrderUpsertResult> {
    return this.enqueue(async () => {
      const current = this.orders.get(incoming.orderId) ?? null;
      const transition = applyUpsertTransition(current, incoming);
      if (transition.created || transition.changed) {
        const next = new Map(this.orders);
        next.set(incoming.orderId, transition.order);
        await this.commit(next);
      }
      return {
        order: transition.order,
        created: transition.created,
        changed: transition.changed,
      };
    });
  }

  async refundOrder(
    orderId: string,
    at?: Date | string
  ): Promise<OrderMutationResult> {
    return this.enqueue(async () => {
      const current = this.orders.get(orderId);
      if (!current) return { ok: false, reason: "not-found" };

      const result = applyRefundTransition(current, at);
      if (result.ok && result.changed) {
        const next = new Map(this.orders);
        next.set(orderId, result.order);
        await this.commit(next);
      }
      return result;
    });
  }

  async deleteOrderAnalysis(
    orderId: string,
    at?: Date | string
  ): Promise<OrderMutationResult> {
    return this.enqueue(async () => {
      const current = this.orders.get(orderId);
      if (!current) return { ok: false, reason: "not-found" };

      const result = applyDeleteTransition(current, at);
      if (result.ok && result.changed) {
        const next = new Map(this.orders);
        next.set(orderId, result.order);
        await this.commit(next);
      }
      return result;
    });
  }

  /* ===== 内部：队列 / 加载 / 原子写 ===== */

  /**
   * 进程内串行队列：每个操作都排在上一个之后执行，保证 read-modify-write 不互相覆盖。
   * 队列自身吞掉前一个操作的失败（下一个操作仍可执行），但调用方仍会拿到自己的错误。
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** 构造时同步 load：缺失 = 空库；损坏 = 备份 + 空库；其它 IO 错误 = 抛出 */
  private loadSync(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if (isErrnoCode(err, "ENOENT")) {
        this.orders = new Map();
        return;
      }
      throw new FileOrderStoreError(
        `无法读取订单文件：${this.filePath}`,
        { code: "READ_FAILED", cause: err }
      );
    }

    try {
      this.orders = parseOrdersFile(raw);
    } catch (err) {
      const backupPath = this.backupCorruptFile();
      console.warn(
        `[order-store-file] 订单文件损坏，已备份为 ${
          backupPath ?? "(备份失败)"
        }，以空库继续：${this.filePath}`,
        err instanceof Error ? err.message : err
      );
      this.orders = new Map();
    }
  }

  /** 把损坏文件重命名备份；失败只告警（不阻塞恢复） */
  private backupCorruptFile(): string | null {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.filePath}.corrupt-${stamp}`;
    try {
      renameSync(this.filePath, backupPath);
      return backupPath;
    } catch (err) {
      console.warn(
        `[order-store-file] 备份损坏文件失败：${this.filePath}`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  /** 原子落盘；成功后内存才切换到新状态（避免磁盘失败时内存脏读） */
  private async commit(next: Map<string, OrderRecord>): Promise<void> {
    await this.persist(next);
    this.orders = next;
  }

  private async persist(next: Map<string, OrderRecord>): Promise<void> {
    const payload = serializeOrders(next);
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      await fsp.writeFile(this.tmpFilePath, payload, "utf8");
      // 同目录 rename 原子替换；跨设备 rename 才会退化，这里文件名保证同目录
      await fsp.rename(this.tmpFilePath, this.filePath);
    } catch (err) {
      throw new FileOrderStoreError(
        `无法写入订单文件：${this.filePath}`,
        { code: "WRITE_FAILED", cause: err }
      );
    }
  }
}

/** 工厂：`createFileOrderStore(process.env.ORDERS_DATA_DIR)` */
export function createFileOrderStore(
  dir: string,
  options: FileOrderStoreOptions = {}
): FileOrderStore {
  return new FileOrderStore(dir, options);
}

/* ===== 序列化 / 反序列化 ===== */

type OrdersFilePayload = {
  version: number;
  updatedAt: string;
  orders: Record<string, OrderRecord>;
};

function serializeOrders(orders: Map<string, OrderRecord>): string {
  const sorted: Record<string, OrderRecord> = {};
  for (const orderId of [...orders.keys()].sort()) {
    const record = orders.get(orderId);
    if (record) sorted[orderId] = record;
  }
  const payload: OrdersFilePayload = {
    version: FILE_VERSION,
    updatedAt: new Date().toISOString(),
    orders: sorted,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * 解析文件内容。接受两种形状（向前兼容）：
 *   { version:1, orders: { "<orderId>": OrderRecord } }   ← 当前写出的格式
 *   { orders: [OrderRecord, ...] } / [OrderRecord, ...]    ← 容错旧格式
 * 任何结构问题抛 OrdersFileCorruptError（外层备份 + 空库）。
 */
function parseOrdersFile(raw: string): Map<string, OrderRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new OrdersFileCorruptError("JSON 解析失败", { cause: err });
  }

  const entries: unknown[] = [];
  if (Array.isArray(parsed)) {
    entries.push(...parsed);
  } else if (isRecord(parsed) && Array.isArray(parsed.orders)) {
    entries.push(...parsed.orders);
  } else if (isRecord(parsed) && isRecord(parsed.orders)) {
    for (const [orderId, record] of Object.entries(parsed.orders)) {
      entries.push(isRecord(record) ? { ...record, orderId } : record);
    }
  } else {
    throw new OrdersFileCorruptError("文件结构不是订单对象/数组");
  }

  const orders = new Map<string, OrderRecord>();
  for (const entry of entries) {
    if (!isRecord(entry)) {
      throw new OrdersFileCorruptError("订单记录不是对象");
    }
    const order = normalizeOrderRecord(entry);
    if (!order) {
      throw new OrdersFileCorruptError("订单记录缺少 orderId / status");
    }
    orders.set(order.orderId, order);
  }
  return orders;
}

const VALID_STATUSES: readonly OrderStatus[] = [
  "completed",
  "refunded",
  "canceled",
  "pending",
  "deleted",
];

function normalizeOrderRecord(raw: Record<string, unknown>): OrderRecord | null {
  const orderId = readString(raw.orderId);
  const status = readString(raw.status) as OrderStatus;
  if (!orderId || !VALID_STATUSES.includes(status)) return null;

  const createdAt = readString(raw.createdAt) || new Date().toISOString();
  const updatedAt = readString(raw.updatedAt) || createdAt;
  const record: OrderRecord = {
    orderId,
    variantId: readString(raw.variantId),
    email: readString(raw.email),
    status,
    custom: isRecord(raw.custom) ? { ...raw.custom } : {},
    createdAt,
    updatedAt,
    completedAt: readString(raw.completedAt),
    lastEventName: readString(raw.lastEventName),
    testMode: raw.testMode === true,
  };

  const refundedAt = readString(raw.refundedAt);
  if (refundedAt) record.refundedAt = refundedAt;
  const deletedAt = readString(raw.deletedAt);
  if (deletedAt) record.deletedAt = deletedAt;

  return record;
}

/* ===== 小工具 ===== */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isErrnoCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === code
  );
}
