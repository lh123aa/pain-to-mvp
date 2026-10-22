/**
 * PgReportStore —— Postgres 版跨设备报告存储（W5-2）
 * =================================================
 * 与 InMemoryReportStore / FileReportStore 实现同一个 `ReportStore`：
 * - save：`INSERT ... ON CONFLICT (order_id) DO UPDATE` 幂等覆盖；created_at 保留首次保存时间；
 * - get：只返回 `expires_at > now()` 的记录（90 天 TTL）；
 * - deleteReport：隐私删除用；
 * - list / clear：运维 / 测试。
 *
 * 连接池：复用 order-store-pg.ts 的进程级 `getSharedPgPool()`（单例）；
 * 单测可注入 `query` / `pool`，不连真库。
 *
 * 本文件由 report-store.ts 的 getReportStore() 在 DATABASE_URL 存在时**动态 import**。
 */

import type { ReportDataV2 } from "./report-contract";
import {
  REPORT_TTL_MS,
  validateReportPayload,
  type ReportStore,
  type StoredReport,
} from "./report-store";
import {
  getSharedPgPool,
  type PgQuery,
  type PgQueryResult,
} from "./order-store-pg";

export type { PgQuery, PgQueryResult } from "./order-store-pg";

export type PgReportStoreOptions = {
  connectionString?: string;
  query?: PgQuery;
  pool?: { query: PgQuery };
};

const REPORT_COLUMNS = "order_id, data, created_at, saved_at, expires_at";

const SELECT_REPORT = `SELECT ${REPORT_COLUMNS} FROM reports WHERE order_id = $1 AND expires_at > now() LIMIT 1`;

const SELECT_REPORTS = `SELECT ${REPORT_COLUMNS} FROM reports WHERE expires_at > now() ORDER BY saved_at ASC, order_id ASC`;

/** 幂等覆盖：created_at 不被 EXCLUDED 覆盖（保留首次保存时间） */
const UPSERT_REPORT = `INSERT INTO reports (${REPORT_COLUMNS}) VALUES ($1, $2::jsonb, $3, $4, $5) ON CONFLICT (order_id) DO UPDATE SET data = EXCLUDED.data, saved_at = EXCLUDED.saved_at, expires_at = EXCLUDED.expires_at RETURNING ${REPORT_COLUMNS}`;

const DELETE_REPORT = `DELETE FROM reports WHERE order_id = $1`;

const CLEAR_REPORTS = `DELETE FROM reports`;

export class PgReportStore implements ReportStore {
  private readonly runQuery: PgQuery;

  constructor(options: PgReportStoreOptions) {
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
        "PgReportStore 需要 connectionString，或注入 query / pool（测试用）"
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

  async get(orderId: string): Promise<StoredReport | null> {
    const result = await this.runQuery(SELECT_REPORT, [orderId]);
    const row = result.rows[0];
    return row ? rowToStoredReport(row) : null;
  }

  async save(
    orderId: string,
    report: ReportDataV2,
    options: { now?: Date | number } = {}
  ): Promise<StoredReport> {
    const now = toDate(options.now);
    const savedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + REPORT_TTL_MS).toISOString();

    const result = await this.runQuery(UPSERT_REPORT, [
      orderId,
      JSON.stringify(report),
      savedAt,
      savedAt,
      expiresAt,
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new Error(`PgReportStore.save 未返回记录：${orderId}`);
    }
    const stored = rowToStoredReport(row);
    if (!stored) {
      throw new Error(`PgReportStore.save 返回的报告不合法：${orderId}`);
    }
    return stored;
  }

  async deleteReport(orderId: string): Promise<boolean> {
    const result: PgQueryResult = await this.runQuery(DELETE_REPORT, [orderId]);
    const count = result.rowCount ?? result.rows.length;
    return count > 0;
  }

  async list(): Promise<StoredReport[]> {
    const result = await this.runQuery(SELECT_REPORTS);
    return result.rows
      .map(rowToStoredReport)
      .filter((stored): stored is StoredReport => stored !== null);
  }

  async clear(): Promise<void> {
    await this.runQuery(CLEAR_REPORTS);
  }
}

/* ===== row <-> StoredReport ===== */

function rowToStoredReport(row: Record<string, unknown>): StoredReport | null {
  const orderId = asString(row.order_id);
  if (!orderId) return null;

  let value: unknown = row.data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const validation = validateReportPayload(value);
  if (!validation.ok) return null;

  const createdAt = asIsoString(row.created_at);
  const savedAt = asIsoString(row.saved_at);
  const expiresAt = asIsoString(row.expires_at);
  if (!createdAt || !savedAt || !expiresAt) return null;

  return {
    orderId,
    report: validation.report,
    createdAt,
    savedAt,
    expiresAt,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asIsoString(value: unknown): string {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  if (typeof value === "string") return value;
  return "";
}

function toDate(value: Date | number | undefined): Date {
  if (value === undefined) return new Date();
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : new Date();
  }
  return Number.isFinite(value) ? new Date(value) : new Date();
}
