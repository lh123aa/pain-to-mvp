/**
 * 跨设备报告存储（W3-2）
 * ======================
 * 方案 A：报告**在浏览器里生成**（原文不出设备），只把生成好的 `ReportDataV2`
 * （含 ≤200 字符的证据引用，不含原文/完整会话）上传到服务端，按订单落库；
 * 之后用户在任何设备点魔链都能读到同一份报告。
 *
 * 本模块包含：
 *   1. `ReportStore` 接口 + `InMemoryReportStore`（测试 / CI 默认）；
 *   2. 存储选择 `getReportStore()`：`DATABASE_URL` 有值 → PgReportStore（见
 *      report-store-pg.ts，懒加载 pg）；否则 `REPORT_DATA_DIR` 有值 → FileReportStore
 *      （见 report-store-file.ts）；否则内存；
 *   3. report-upload HMAC token：`/api/order-status` 在订单 completed 时签发 24h
 *      `scope=report-upload` token，`POST /api/report` 用它证明「我有这个订单的
 *      上传权」；
 *   4. 报告 payload 校验（schemaVersion / 体积 ≤1MB / 引用 ≤200 字 / 不含原文）。
 *
 * 过期策略：保存后 90 天过期（每次幂等覆盖都刷新 expiresAt）；过期记录读取时按
 * 「不存在」处理并惰性删除。
 *
 * ⚠️ file 模式只适合单实例/staging；serverless 生产必须 `DATABASE_URL`（PgReportStore，
 *    `reports` 表见 src/lib/sql/schema.sql）。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MAX_EVIDENCE_QUOTE_CHARS,
  REPORT_CHAPTER_IDS,
  REPORT_SCHEMA_VERSION,
} from "./report-contract";
import type { ReportDataV2 } from "./report-contract";
import { createFileReportStore } from "./report-store-file";

/** 报告保留 90 天（从最近一次保存算） */
export const REPORT_TTL_DAYS = 90;
export const REPORT_TTL_MS = REPORT_TTL_DAYS * 24 * 60 * 60 * 1000;

/** 单份报告 JSON 上限：1 MB */
export const MAX_REPORT_BYTES = 1024 * 1024;

/** POST /api/report 的原始 body 上限（报告 JSON + token + JSON 包装的余量） */
export const MAX_REPORT_REQUEST_BYTES = MAX_REPORT_BYTES + 64 * 1024;

/** 落库的报告记录 */
export type StoredReport = {
  orderId: string;
  report: ReportDataV2;
  /** 首次保存时间（ISO）；覆盖保存时保留 */
  createdAt: string;
  /** 最近一次保存/覆盖时间（ISO） */
  savedAt: string;
  /** 过期时间（ISO）= savedAt + 90 天 */
  expiresAt: string;
};

export interface ReportStore {
  /** 取未过期报告；过期按不存在处理（实现可惰性删除） */
  get(orderId: string): Promise<StoredReport | null>;
  /** 幂等覆盖保存（同一订单只保留一份最新报告），返回落库记录 */
  save(
    orderId: string,
    report: ReportDataV2,
    options?: { now?: Date | number }
  ): Promise<StoredReport>;
  /** 删除报告（幂等），返回是否真的删掉了记录 */
  deleteReport(orderId: string): Promise<boolean>;
  /** 列出未过期报告（运维 / 测试用） */
  list(): Promise<StoredReport[]>;
  clear(): Promise<void>;
}

export type ReportStoreClock = () => Date;

/* ===== 共享的保存 / 过期逻辑（内存 / 文件实现复用） ===== */

function toDate(value: Date | number | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : fallback;
  }
  return Number.isFinite(value) ? new Date(value) : fallback;
}

/** 记录是否已过期（非法时间按过期处理，避免脏数据永久驻留） */
export function isStoredReportExpired(
  stored: Pick<StoredReport, "expiresAt">,
  now: Date = new Date()
): boolean {
  const expiresMs = Date.parse(stored.expiresAt);
  if (!Number.isFinite(expiresMs)) return true;
  return expiresMs <= now.getTime();
}

/**
 * 构造要落库的记录：createdAt 保留首次保存时间（若旧记录未过期），
 * savedAt / expiresAt 按本次保存刷新。
 */
export function buildStoredReport(
  orderId: string,
  report: ReportDataV2,
  now: Date,
  existing?: StoredReport | null
): StoredReport {
  const iso = now.toISOString();
  const keepCreatedAt =
    existing && !isStoredReportExpired(existing, now)
      ? existing.createdAt
      : iso;
  return {
    orderId,
    report,
    createdAt: keepCreatedAt,
    savedAt: iso,
    expiresAt: new Date(now.getTime() + REPORT_TTL_MS).toISOString(),
  };
}

/** 内存报告存储（进程内；测试 / CI 默认） */
export class InMemoryReportStore implements ReportStore {
  private readonly reports = new Map<string, StoredReport>();
  private readonly clock: ReportStoreClock;

  constructor(options: { now?: ReportStoreClock } = {}) {
    this.clock = options.now ?? (() => new Date());
  }

  async get(orderId: string): Promise<StoredReport | null> {
    const stored = this.reports.get(orderId);
    if (!stored) return null;
    if (isStoredReportExpired(stored, this.clock())) {
      this.reports.delete(orderId);
      return null;
    }
    return stored;
  }

  async save(
    orderId: string,
    report: ReportDataV2,
    options: { now?: Date | number } = {}
  ): Promise<StoredReport> {
    const now = toDate(options.now, this.clock());
    const existing = this.reports.get(orderId) ?? null;
    const stored = buildStoredReport(orderId, report, now, existing);
    this.reports.set(orderId, stored);
    return stored;
  }

  async deleteReport(orderId: string): Promise<boolean> {
    return this.reports.delete(orderId);
  }

  async list(): Promise<StoredReport[]> {
    const now = this.clock();
    return [...this.reports.values()].filter(
      (stored) => !isStoredReportExpired(stored, now)
    );
  }

  async clear(): Promise<void> {
    this.reports.clear();
  }
}

/* ===== 存储选择（内存 / 文件 / Postgres / 注入） ===== */

export type ReportStoreKind = "memory" | "file" | "postgres" | "injected";

let activeStore: ReportStore | null = null;
let activeStoreKind: ReportStoreKind | null = null;

/**
 * Postgres 分支懒代理：getReportStore() 保持同步；pg 实现只在 DATABASE_URL
 * 存在时动态 import，首次调用方法时才加载模块/连接池。
 */
function createLazyPgReportStore(connectionString: string): ReportStore {
  let instance: Promise<ReportStore> | null = null;
  const resolveStore = (): Promise<ReportStore> => {
    if (!instance) {
      instance = import("./report-store-pg").then(
        ({ PgReportStore }) => new PgReportStore({ connectionString })
      );
    }
    return instance;
  };

  return {
    get: async (orderId) => (await resolveStore()).get(orderId),
    save: async (orderId, report, options) =>
      (await resolveStore()).save(orderId, report, options),
    deleteReport: async (orderId) => (await resolveStore()).deleteReport(orderId),
    list: async () => (await resolveStore()).list(),
    clear: async () => (await resolveStore()).clear(),
  };
}

/**
 * 当前报告存储单例。
 *   1. `DATABASE_URL` 非空 → PgReportStore（生产 serverless，懒加载 pg）；
 *   2. `REPORT_DATA_DIR` 非空 → FileReportStore(该目录)（单实例/staging）；
 *   3. 否则 → InMemoryReportStore（测试 / CI 默认）。
 */
export function getReportStore(): ReportStore {
  if (activeStore) return activeStore;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    activeStore = createLazyPgReportStore(databaseUrl);
    activeStoreKind = "postgres";
    return activeStore;
  }

  const dataDir = process.env.REPORT_DATA_DIR?.trim();
  if (dataDir) {
    activeStore = createFileReportStore(dataDir);
    activeStoreKind = "file";
  } else {
    activeStore = new InMemoryReportStore();
    activeStoreKind = "memory";
  }
  return activeStore;
}

/** 注入报告存储（测试 / 切 DB 用） */
export function setReportStore(store: ReportStore): void {
  activeStore = store;
  activeStoreKind = "injected";
}

/** 重置单例（仅测试用）：下次 getReportStore() 重新按 env 选择 */
export function resetReportStore(): void {
  activeStore = null;
  activeStoreKind = null;
}

/** 当前存储类型，便于诊断 / 健康检查 */
export function getReportStoreKind(): ReportStoreKind {
  if (!activeStore) getReportStore();
  return activeStoreKind ?? "memory";
}

/* ===== 报告 payload 校验（POST /api/report 用） ===== */

export type ReportValidationFailure =
  | "shape"
  | "quote-too-long"
  | "raw-conversation"
  | "too-large";

export type ReportValidationResult =
  | { ok: true; report: ReportDataV2 }
  | { ok: false; reason: ReportValidationFailure };

/**
 * 防御性校验：只接受「已生成的 ReportDataV2」。
 * - `meta.schemaVersion === "report_v2"`，6 章齐全；
 * - 证据引用 ≤ 200 字符（隐私 + 体积约束）；
 * - 顶层不能携带原文/完整会话字段；
 * - 序列化后 ≤ 1 MB。
 */
export function validateReportPayload(value: unknown): ReportValidationResult {
  if (!isRecord(value)) return { ok: false, reason: "shape" };

  const meta = value.meta;
  if (!isRecord(meta) || meta.schemaVersion !== REPORT_SCHEMA_VERSION) {
    return { ok: false, reason: "shape" };
  }
  if (!isRecord(value.headline)) return { ok: false, reason: "shape" };
  if (
    !Array.isArray(value.chapters) ||
    value.chapters.length !== REPORT_CHAPTER_IDS.length
  ) {
    return { ok: false, reason: "shape" };
  }
  if (!Array.isArray(value.evidence)) return { ok: false, reason: "shape" };
  if (typeof value.disclaimer !== "string") {
    return { ok: false, reason: "shape" };
  }
  if (!Array.isArray(value.whatWeDontKnow)) {
    return { ok: false, reason: "shape" };
  }
  if (!isRecord(value.dataQuality)) return { ok: false, reason: "shape" };

  // 拒绝任何原文/完整会话字段混入（契约：只存生成结果 + 短引用）
  for (const forbidden of ["conversation", "messages", "rawConversation", "raw"]) {
    if (forbidden in value) return { ok: false, reason: "raw-conversation" };
  }

  for (const item of value.evidence) {
    if (!isRecord(item) || typeof item.quote !== "string") {
      return { ok: false, reason: "shape" };
    }
    if ([...item.quote].length > MAX_EVIDENCE_QUOTE_CHARS) {
      return { ok: false, reason: "quote-too-long" };
    }
  }

  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return { ok: false, reason: "shape" };
  }
  if (bytes > MAX_REPORT_BYTES) return { ok: false, reason: "too-large" };

  return { ok: true, report: value as unknown as ReportDataV2 };
}

/* ===== report-upload token（24h，scope=report-upload） ===== */

export const REPORT_UPLOAD_SCOPE = "report-upload";
export const REPORT_UPLOAD_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * 上传 token 用独立版本前缀（`ru1`）而不是魔链的 `v1`：
 * 防止「浏览器拿到的 uploadToken」被当作魔链 token 重放到 GET /api/report。
 * （magic-link 模块不在 W3-2 写作用域，无法在那边加 scope 拒绝。）
 */
const UPLOAD_TOKEN_VERSION = "ru1";
const DEV_FALLBACK_SECRET = "dev-insecure-report-upload-secret";

export type ReportUploadPayload = {
  scope: typeof REPORT_UPLOAD_SCOPE;
  orderId: string;
  /** 签发时间（Unix 秒） */
  iat: number;
  /** 过期时间（Unix 秒） */
  exp: number;
};

export type ReportUploadVerifyResult =
  | { ok: true; payload: ReportUploadPayload }
  | {
      ok: false;
      reason:
        | "malformed"
        | "invalid_signature"
        | "expired"
        | "wrong_scope"
        | "not_configured";
    };

export type ReportUploadTokenOptions = {
  ttlSeconds?: number;
  now?: Date | number;
  secret?: string;
};

export type ReportUploadVerifyOptions = {
  now?: Date | number;
  secret?: string;
};

/**
 * 上传 token 的密钥：REPORT_UPLOAD_SECRET → MAGIC_LINK_SECRET → 非 production
 * 的 dev fallback。production 都没配 → null（路由返回 500）。
 */
export function resolveReportUploadSecret(
  env: Record<string, string | undefined> = process.env
): string | null {
  const explicit = env.REPORT_UPLOAD_SECRET?.trim();
  if (explicit) return explicit;

  const magic = env.MAGIC_LINK_SECRET?.trim();
  if (magic) return magic;

  if (env.NODE_ENV !== "production") return DEV_FALLBACK_SECRET;
  return null;
}

/** 签发 24h report-upload token（订单 completed 时由 /api/order-status 调） */
export function issueReportUploadToken(
  orderId: string,
  options: ReportUploadTokenOptions = {}
): string {
  const id = orderId.trim();
  if (!id) throw new Error("签发 report-upload token 需要非空 orderId");

  const secret = options.secret ?? resolveReportUploadSecret();
  if (!secret) {
    throw new Error("REPORT_UPLOAD_SECRET / MAGIC_LINK_SECRET 未配置（production 必须配置）");
  }

  const nowSeconds = toUnixSeconds(options.now);
  const payload: ReportUploadPayload = {
    scope: REPORT_UPLOAD_SCOPE,
    orderId: id,
    iat: nowSeconds,
    exp: nowSeconds + (options.ttlSeconds ?? REPORT_UPLOAD_TOKEN_TTL_SECONDS),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  return `${UPLOAD_TOKEN_VERSION}.${payloadB64}.${signUploadPayload(payloadB64, secret)}`;
}

/** 验证 report-upload token：格式 → 签名 → 过期 → scope */
export function verifyReportUploadToken(
  token: string,
  options: ReportUploadVerifyOptions = {}
): ReportUploadVerifyResult {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== UPLOAD_TOKEN_VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const payloadB64 = parts[1];
  const signature = parts[2];
  if (!payloadB64 || !signature) return { ok: false, reason: "malformed" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "malformed" };

  const orderId = typeof parsed.orderId === "string" ? parsed.orderId.trim() : "";
  const exp = typeof parsed.exp === "number" ? parsed.exp : NaN;
  const iat = typeof parsed.iat === "number" ? parsed.iat : 0;
  if (!orderId || !Number.isFinite(exp)) {
    return { ok: false, reason: "malformed" };
  }

  const secret = options.secret ?? resolveReportUploadSecret();
  if (!secret) return { ok: false, reason: "not_configured" };

  if (!safeEqual(signUploadPayload(payloadB64, secret), signature)) {
    return { ok: false, reason: "invalid_signature" };
  }
  if (exp <= toUnixSeconds(options.now)) {
    return { ok: false, reason: "expired" };
  }
  if (parsed.scope !== REPORT_UPLOAD_SCOPE) {
    return { ok: false, reason: "wrong_scope" };
  }

  return {
    ok: true,
    payload: { scope: REPORT_UPLOAD_SCOPE, orderId, iat, exp },
  };
}

/* ===== 内部工具 ===== */

function signUploadPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${UPLOAD_TOKEN_VERSION}.${payloadB64}`, "utf8")
    .digest("base64url");
}

function safeEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function toUnixSeconds(value: Date | number | undefined): number {
  if (value === undefined) return Math.floor(Date.now() / 1000);
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
