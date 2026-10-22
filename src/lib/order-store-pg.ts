/**
 * PgOrderStore —— Postgres 版订单存储（W5-2，生产 serverless 用）
 * =============================================================
 * 与 InMemoryOrderStore / FileOrderStore 实现同一个 `OrderStore` 接口，语义完全一致：
 * - upsert：`INSERT ... ON CONFLICT (order_id) DO NOTHING`，冲突时 SELECT 后条件 UPDATE；
 * - 终态不回退：UPDATE 一律带 `status <> 'deleted'`（或 `status = 'completed'`）守卫；
 * - deleted 后 webhook 重放不能写回状态/PII（应用层 applyUpsertTransition + SQL 守卫双保险）；
 * - refund 用条件更新 `WHERE status = 'completed'`，并发下不会重复退款；
 * - findByClientRef 走 `client_ref` 索引。
 *
 * 连接池：
 * - 默认按 connectionString 懒创建**进程级单例** Pool（max 5），首次 query 才真正连接；
 * - 单测 / 外部连接池可注入 `query` 或 `pool`，完全不连真库。
 *
 * 本文件由 orders.ts 的 getOrderStore() 在 DATABASE_URL 存在时**动态 import**，
 * 无 DB 的环境不会加载 `pg` 驱动。
 */

import { Pool } from "pg";
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

/* ===== 可注入的查询接口（测试用 fake，不需要真 DB） ===== */

export type PgQueryResult = {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
};

export type PgQuery = (
  text: string,
  values?: unknown[]
) => Promise<PgQueryResult>;

export type PgOrderStoreOptions = {
  /** postgres://...；未注入 query/pool 时使用（懒建进程级 Pool） */
  connectionString?: string;
  /** 直接注入 query（最高优先级；测试 / 外部连接池） */
  query?: PgQuery;
  /** 注入 Pool 兼容对象 */
  pool?: { query: PgQuery };
};

export type PgPoolLike = {
  query: PgQuery;
  end?: () => Promise<void>;
};

/* ===== 进程级连接池单例（order/report store 共用） ===== */

let sharedPool: Pool | null = null;
let sharedPoolConnectionString = "";

/** 懒创建 / 复用进程级 Pool（构造 Pool 不会立刻建立连接） */
export function getSharedPgPool(connectionString: string): Pool {
  const normalized = connectionString.trim();
  if (!sharedPool || sharedPoolConnectionString !== normalized) {
    const stalePool = sharedPool;
    sharedPool = new Pool({
      connectionString: normalized,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    sharedPoolConnectionString = normalized;
    if (stalePool) void stalePool.end().catch(() => undefined);
  }
  return sharedPool;
}

/** 关闭共享池（测试 / 优雅退出用） */
export async function closeSharedPgPool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = null;
  sharedPoolConnectionString = "";
  if (pool) await pool.end();
}

/* ===== SQL ===== */

const ORDER_COLUMNS =
  "order_id, variant_id, email, status, custom, client_ref, created_at, updated_at, completed_at, last_event_name, test_mode, refunded_at, deleted_at";

const SELECT_BY_ID = `SELECT ${ORDER_COLUMNS} FROM orders WHERE order_id = $1 LIMIT 1`;

const SELECT_BY_CLIENT_REF = `SELECT ${ORDER_COLUMNS} FROM orders WHERE client_ref = $1 LIMIT 1`;

const SELECT_ALL = `SELECT ${ORDER_COLUMNS} FROM orders ORDER BY created_at ASC, order_id ASC`;

const INSERT_ORDER = `INSERT INTO orders (${ORDER_COLUMNS}) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (order_id) DO NOTHING RETURNING ${ORDER_COLUMNS}`;

/**
 * upsert 的更新语句：只更新可合并字段，refunded_at / deleted_at / created_at / order_id
 * 不动；`status <> 'deleted'` 保证 deleted 是绝对终态（webhook 重放不能复活）。
 */
const UPDATE_ORDER = `UPDATE orders SET variant_id = $2, email = $3, status = $4, custom = $5::jsonb, client_ref = $6, updated_at = $7, completed_at = $8, last_event_name = $9, test_mode = $10 WHERE order_id = $1 AND status <> 'deleted' RETURNING ${ORDER_COLUMNS}`;

/** 退款：只在 completed 上生效（并发安全，不会重复退款） */
const REFUND_ORDER = `UPDATE orders SET status = 'refunded', refunded_at = COALESCE(refunded_at, $2), updated_at = $2 WHERE order_id = $1 AND status = 'completed' RETURNING ${ORDER_COLUMNS}`;

/** 删除数据 + 脱敏：deleted 幂等，且不会再被后续 webhook 改回 */
const DELETE_ORDER_ANALYSIS = `UPDATE orders SET status = 'deleted', email = '', variant_id = '', custom = '{}'::jsonb, updated_at = $2, deleted_at = $2 WHERE order_id = $1 AND status <> 'deleted' RETURNING ${ORDER_COLUMNS}`;

const CLEAR_ORDERS = `DELETE FROM orders`;

/* ===== 实现 ===== */

export class PgOrderStore implements OrderStore {
  private readonly runQuery: PgQuery;

  constructor(options: PgOrderStoreOptions) {
    if (options.query) {
      this.runQuery = options.query;
      return;
    }
    if (options.pool) {
      const pool = options.pool;
      this.runQuery = (text, values) => pool.query(text, values);
      return;
    }
    const connectionString = options.connectionString?.trim();
    if (!connectionString) {
      throw new Error(
        "PgOrderStore 需要 connectionString，或注入 query / pool（测试用）"
      );
    }
    this.runQuery = async (text, values) => {
      const result = await getSharedPgPool(connectionString).query(
        text,
        values as unknown[] | undefined
      );
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount,
      };
    };
  }

  async get(orderId: string): Promise<OrderRecord | null> {
    const result = await this.runQuery(SELECT_BY_ID, [orderId]);
    const row = result.rows[0];
    return row ? rowToOrder(row) : null;
  }

  async list(): Promise<OrderRecord[]> {
    const result = await this.runQuery(SELECT_ALL);
    return result.rows.map(rowToOrder);
  }

  async clear(): Promise<void> {
    await this.runQuery(CLEAR_ORDERS);
  }

  async findByClientRef(clientRef: string): Promise<OrderRecord | null> {
    const ref = clientRef.trim();
    if (!ref) return null;
    const result = await this.runQuery(SELECT_BY_CLIENT_REF, [ref]);
    const row = result.rows[0];
    return row ? rowToOrder(row) : null;
  }

  async upsert(incoming: OrderRecord): Promise<OrderUpsertResult> {
    const current = await this.selectOrder(incoming.orderId);
    if (current) return this.updateWithCurrent(current, incoming);

    // 新建：ON CONFLICT DO NOTHING；并发冲突时回退到读 + 更新
    const insertResult = await this.runQuery(
      INSERT_ORDER,
      orderInsertValues(incoming)
    );
    const insertedRow = insertResult.rows[0];
    if (insertedRow) {
      return { order: rowToOrder(insertedRow), created: true, changed: true };
    }

    const raced = await this.selectOrder(incoming.orderId);
    if (!raced) {
      throw new Error(
        `PgOrderStore.upsert 并发冲突后读不到订单 ${incoming.orderId}`
      );
    }
    return this.updateWithCurrent(raced, incoming);
  }

  async refundOrder(
    orderId: string,
    at?: Date | string
  ): Promise<OrderMutationResult> {
    const atIso = toIsoString(at);
    const result = await this.runQuery(REFUND_ORDER, [orderId, atIso]);
    const row = result.rows[0];
    if (row) return { ok: true, order: rowToOrder(row), changed: true };

    const current = await this.selectOrder(orderId);
    if (!current) return { ok: false, reason: "not-found" };
    // 幂等 / 非法状态由共享纯函数判定（refunded → ok changed=false；其余 → invalid）
    return applyRefundTransition(current, at);
  }

  async deleteOrderAnalysis(
    orderId: string,
    at?: Date | string
  ): Promise<OrderMutationResult> {
    const atIso = toIsoString(at);
    const result = await this.runQuery(DELETE_ORDER_ANALYSIS, [orderId, atIso]);
    const row = result.rows[0];
    if (row) return { ok: true, order: rowToOrder(row), changed: true };

    const current = await this.selectOrder(orderId);
    if (!current) return { ok: false, reason: "not-found" };
    return applyDeleteTransition(current, at);
  }

  /* ===== 内部 ===== */

  private async selectOrder(orderId: string): Promise<OrderRecord | null> {
    const result = await this.runQuery(SELECT_BY_ID, [orderId]);
    const row = result.rows[0];
    return row ? rowToOrder(row) : null;
  }

  private async updateWithCurrent(
    current: OrderRecord,
    incoming: OrderRecord
  ): Promise<OrderUpsertResult> {
    const transition = applyUpsertTransition(current, incoming);
    if (!transition.changed) {
      return { order: transition.order, created: false, changed: false };
    }

    const result = await this.runQuery(
      UPDATE_ORDER,
      orderUpdateValues(transition.order)
    );
    const row = result.rows[0];
    if (row) {
      return { order: rowToOrder(row), created: false, changed: true };
    }
    // 并发下被退款/删除抢写：以数据库现状为准，不再写回
    const reread = await this.selectOrder(incoming.orderId);
    return { order: reread ?? current, created: false, changed: false };
  }
}

/* ===== row <-> OrderRecord ===== */

function rowToOrder(row: Record<string, unknown>): OrderRecord {
  const order: OrderRecord = {
    orderId: asString(row.order_id),
    variantId: asString(row.variant_id),
    email: asString(row.email),
    status: asStatus(row.status),
    custom: asJsonObject(row.custom),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
    completedAt: asIsoString(row.completed_at),
    lastEventName: asString(row.last_event_name),
    testMode: row.test_mode === true,
  };
  const clientRef = asString(row.client_ref);
  if (clientRef) order.clientRef = clientRef;
  const refundedAt = asIsoString(row.refunded_at);
  if (refundedAt) order.refundedAt = refundedAt;
  const deletedAt = asIsoString(row.deleted_at);
  if (deletedAt) order.deletedAt = deletedAt;
  return order;
}

function orderInsertValues(order: OrderRecord): unknown[] {
  return [
    order.orderId,
    order.variantId,
    order.email,
    order.status,
    JSON.stringify(order.custom ?? {}),
    order.clientRef ?? null,
    order.createdAt,
    order.updatedAt,
    order.completedAt || null,
    order.lastEventName,
    order.testMode,
    order.refundedAt ?? null,
    order.deletedAt ?? null,
  ];
}

function orderUpdateValues(order: OrderRecord): unknown[] {
  return [
    order.orderId,
    order.variantId,
    order.email,
    order.status,
    JSON.stringify(order.custom ?? {}),
    order.clientRef ?? null,
    order.updatedAt,
    order.completedAt || null,
    order.lastEventName,
    order.testMode,
  ];
}

/* ===== 类型 / 值转换 ===== */

const VALID_STATUSES: readonly OrderStatus[] = [
  "completed",
  "refunded",
  "canceled",
  "pending",
  "deleted",
];

function asStatus(value: unknown): OrderStatus {
  const status = asString(value) as OrderStatus;
  return VALID_STATUSES.includes(status) ? status : "pending";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** pg 的 timestamptz 默认返回 Date；也兼容驱动设置成字符串的情况 */
function asIsoString(value: unknown): string {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  if (typeof value === "string") return value;
  return "";
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      /* 非 JSON 字符串 → 空对象 */
    }
  }
  return {};
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
