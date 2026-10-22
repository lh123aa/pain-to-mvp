/**
 * 魔法链（magic link）token 的签发与验证
 * =====================================
 * 用途：用户付完款后，邮件里带一条「点开即可看报告」的链接；报告页把 token
 * 交给 `GET /api/verify-magic-link?token=...` 换订单数据。
 *
 * Token 格式（自包含，不依赖服务端 session）：
 *   v1.<base64url(payload)>.<base64url(HMAC-SHA256(secret, "v1." + base64url(payload)))>
 * payload = { orderId: string, iat: 秒级时间戳, exp: 秒级时间戳 }，默认 7 天有效。
 *
 * 密钥：MAGIC_LINK_SECRET（推荐）。未配置时依次回落：
 *   1. LEMON_SQUEEZY_WEBHOOK_SECRET（省一个 env，但会耦合两套密钥）
 *   2. 非 production 环境用固定 dev 串（本地/CI 可跑通，且会 console.warn）
 *   production 且都没配 → 签发直接抛错、验证返回 not_configured（路由 500）。
 *
 * 说明：token 未加密，只读得到 orderId + 时间戳，不放 email 等 PII。
 * 注意：本模块只在服务端使用（node:crypto），不要被客户端组件 import。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const MAGIC_LINK_VERSION = "v1";
export const MAGIC_LINK_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

const DEV_FALLBACK_SECRET = "dev-insecure-magic-link-secret";

export type MagicLinkPayload = {
  orderId: string;
  /** 签发时间（Unix 秒） */
  iat: number;
  /** 过期时间（Unix 秒） */
  exp: number;
};

export type MagicLinkVerifyResult =
  | { ok: true; payload: MagicLinkPayload }
  | {
      ok: false;
      reason:
        | "malformed"
        | "invalid_signature"
        | "expired"
        | "revoked"
        | "not_configured";
    };

export type MagicLinkTokenOptions = {
  /** 有效期（秒），默认 7 天 */
  ttlSeconds?: number;
  /** 签发基准时间，默认现在；测试可注入 */
  now?: Date | number;
  /** 显式密钥，默认按 resolveMagicLinkSecret() 解析 */
  secret?: string;
};

export type MagicLinkVerifyOptions = {
  /** 校验基准时间，默认现在；测试可注入 */
  now?: Date | number;
  /** 显式密钥，默认按 resolveMagicLinkSecret() 解析 */
  secret?: string;
  /**
   * 是否检查吊销表，默认 false（保持现有 /api/verify-magic-link 行为：
   * 吊销后由「订单状态 refunded/deleted」返回 403；token 级 401/410 映射留给后续任务）。
   * 退款 / 删除 API 内部需要“token 作废”语义时显式传 true。
   */
  checkRevocation?: boolean;
  /** 注入吊销表（默认进程内单例），测试 / 接 DB 用 */
  revocation?: MagicLinkRevocationStore;
};

/**
 * 解析签名密钥；返回 null 表示 production 下完全没配置（调用方应拒绝签发/验证）。
 */
export function resolveMagicLinkSecret(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const explicit = env.MAGIC_LINK_SECRET?.trim();
  if (explicit) return explicit;

  const fallback = env.LEMON_SQUEEZY_WEBHOOK_SECRET?.trim();
  if (fallback) return fallback;

  if (env.NODE_ENV !== "production") {
    console.warn(
      "[magic-link] MAGIC_LINK_SECRET 未配置，使用本地开发 fallback（生产环境必须配置）"
    );
    return DEV_FALLBACK_SECRET;
  }
  return null;
}

/* ===== 魔链吊销表（退款 / 删除后 token 作废）===== */

/**
 * 吊销粒度 = 订单：某订单被退款 / 删除后，它签发过的所有魔链立即失效
 * （比逐 token 记录更稳：吊销后即使旧 token 未过期也进不来）。
 *
 * 现状：进程内 Set（重启 / serverless 多实例不共享）。DB 接入口：
 *   1. 建表 `magic_link_revocations(order_id TEXT PRIMARY KEY, revoked_at TIMESTAMPTZ)`；
 *   2. 实现 MagicLinkRevocationStore 后 setMagicLinkRevocationStore() 注入；
 *   3. 路由 / 页面代码不变。
 */
export interface MagicLinkRevocationStore {
  isRevoked(orderId: string): boolean;
  revoke(orderId: string): void;
  clear(): void;
}

export class InMemoryMagicLinkRevocationStore implements MagicLinkRevocationStore {
  private readonly revoked = new Set<string>();

  isRevoked(orderId: string): boolean {
    return this.revoked.has(orderId.trim());
  }

  revoke(orderId: string): void {
    const id = orderId.trim();
    if (id) this.revoked.add(id);
  }

  clear(): void {
    this.revoked.clear();
  }
}

let activeRevocationStore: MagicLinkRevocationStore =
  new InMemoryMagicLinkRevocationStore();

export function getMagicLinkRevocationStore(): MagicLinkRevocationStore {
  return activeRevocationStore;
}

/** 注入吊销表（测试 / 接 DB 用） */
export function setMagicLinkRevocationStore(
  store: MagicLinkRevocationStore
): void {
  activeRevocationStore = store;
}

/** 重置为全新内存吊销表（仅测试用） */
export function resetMagicLinkRevocationStore(): void {
  activeRevocationStore = new InMemoryMagicLinkRevocationStore();
}

/** 吊销某订单的所有魔链（退款 / 删除成功后调用） */
export function revokeMagicLinksForOrder(orderId: string): void {
  activeRevocationStore.revoke(orderId);
}

/** 该订单的魔链是否已吊销 */
export function isMagicLinkRevoked(orderId: string): boolean {
  return activeRevocationStore.isRevoked(orderId);
}

/**
 * 签发 token。orderId 为空 / production 未配置密钥时抛错。
 */
export function issueMagicLinkToken(
  orderId: string,
  options: MagicLinkTokenOptions = {}
): string {
  const id = orderId.trim();
  if (!id) throw new Error("签发 magic link 需要非空 orderId");

  const secret = options.secret ?? resolveMagicLinkSecret();
  if (!secret) {
    throw new Error("MAGIC_LINK_SECRET 未配置（production 必须配置）");
  }

  const nowSeconds = toUnixSeconds(options.now);
  const payload: MagicLinkPayload = {
    orderId: id,
    iat: nowSeconds,
    exp: nowSeconds + (options.ttlSeconds ?? MAGIC_LINK_TTL_SECONDS),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  return `${MAGIC_LINK_VERSION}.${payloadB64}.${signPayload(payloadB64, secret)}`;
}

/**
 * 验证 token：格式 → 签名（常量时间比较）→ 过期。
 * 验证通过返回 payload（调用方再用 orderId 查订单 / 报告状态）。
 */
export function verifyMagicLinkToken(
  token: string,
  options: MagicLinkVerifyOptions = {}
): MagicLinkVerifyResult {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== MAGIC_LINK_VERSION) {
    return { ok: false, reason: "malformed" };
  }

  const payloadB64 = parts[1];
  const signature = parts[2];
  if (!payloadB64 || !signature) return { ok: false, reason: "malformed" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    );
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!isRecord(parsed)) return { ok: false, reason: "malformed" };

  const orderId = typeof parsed.orderId === "string" ? parsed.orderId.trim() : "";
  const exp = typeof parsed.exp === "number" ? parsed.exp : NaN;
  const iat = typeof parsed.iat === "number" ? parsed.iat : 0;
  if (!orderId || !Number.isFinite(exp)) return { ok: false, reason: "malformed" };

  const secret = options.secret ?? resolveMagicLinkSecret();
  if (!secret) return { ok: false, reason: "not_configured" };

  if (!safeEqual(signPayload(payloadB64, secret), signature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  if (exp <= toUnixSeconds(options.now)) {
    return { ok: false, reason: "expired" };
  }

  if (options.checkRevocation) {
    const revocation = options.revocation ?? activeRevocationStore;
    if (revocation.isRevoked(orderId)) {
      return { ok: false, reason: "revoked" };
    }
  }

  return { ok: true, payload: { orderId, iat, exp } };
}

/**
 * 带上吊销检查的验证（退款 / 删除等“必须确认 token 已作废”的场景用）。
 * 与 verifyMagicLinkToken 的区别仅在于默认 checkRevocation=true。
 */
export function verifyMagicLinkTokenWithRevocation(
  token: string,
  options: MagicLinkVerifyOptions = {}
): MagicLinkVerifyResult {
  return verifyMagicLinkToken(token, { ...options, checkRevocation: true });
}

/**
 * 组装邮件里可直接点的报告页链接（默认 /report?token=...）。
 */
export function buildMagicLinkUrl(
  token: string,
  baseUrl: string = process.env.NEXT_PUBLIC_MAGIC_BASE ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/report?token=${encodeURIComponent(token)}`;
}

/* ===== 内部工具 ===== */

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${MAGIC_LINK_VERSION}.${payloadB64}`, "utf8")
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
