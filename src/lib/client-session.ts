/**
 * 客户端会话存储契约（W2-1b · 隐私架构：原文不出浏览器）
 * ----------------------------------------------------------
 * 数据流：
 *   /analyze（浏览器内解析）→ 本模块 save → /report/preview（免费三卡）
 *   → /checkout（支付）→ /report（六章报告，读同一份本地特征）
 *
 * 三个键，位置与字段名是跨页契约，**不得改名**：
 *   1. `tell:features:v1`（sessionStorage 主，localStorage 兜底）：
 *      { schemaVersion: 1, features: ReportFeatures, conversation: Conversation,
 *        speakers: { user, partner }, fileName, createdAt }
 *      —— 只存「规则层算出的特征」+「归一化会话」（报告页引用证据 messageId 用）；
 *         **绝不存原始导出全文**。
 *      体积 > 3 MB 时自动降级为 features + 证据所需的最小 conversation（见
 *      `minimalConversationFor`），并返回 degraded=true 供 UI 提示。
 *   2. `tell:lastInput`：{ fileName, dateRangeLabel, messageCount }，预览页展示用。
 *   3. `tell:input`（旧键，仅兼容现有 /checkout）：{ fileName, speakerA, speakerB, pasted:"" }
 *      —— 只写元数据，pasted 永远为空字符串，不落任何聊天原文。
 *
 * 容错纪律：
 *   - 所有读写都 try/catch：坏 JSON、版本不符、Storage 被禁用、配额超限一律
 *     返回 null / ok=false，**绝不向上抛**（错误态由页面以人话展示）。
 *   - sessionStorage 优先（关标签页即消失）；写失败再尝试 localStorage（兜底）。
 *   - 读取时逐个存储区尝试，前一个区的坏数据不会挡住后一个区的有效数据。
 */
import type { Conversation } from "@/parser";
import { FEATURES_SCHEMA_VERSION } from "@/rules";
import type { ReportFeatures } from "@/rules";

/** 特征 + 归一化会话的主键（跨页契约，禁止改名）。 */
export const FEATURES_STORAGE_KEY = "tell:features:v1";
/** 上传元信息键，供预览页在特征缺失时仍能说清"你刚才试过什么"。 */
export const LAST_INPUT_STORAGE_KEY = "tell:lastInput";
/** 旧 /checkout 读取的键；本模块只写入去敏元数据。 */
export const LEGACY_CHECKOUT_INPUT_KEY = "tell:input";

/** 本契约的版本号；loadSession 对不匹配的版本返回 null。 */
export const SESSION_SCHEMA_VERSION = 1 as const;

/** 3 MB：超过则降级为"特征 + 证据所需的最小 conversation"。 */
export const MAX_SESSION_BYTES = 3 * 1024 * 1024;

export type StorageArea = "session" | "local";

export interface StoredSpeakers {
  user: string;
  partner: string;
}

/** `tell:features:v1` 的值形状（跨页契约，字段名不可改）。 */
export interface ClientSession {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  features: ReportFeatures;
  conversation: Conversation;
  speakers: StoredSpeakers;
  fileName: string;
  /**
   * ISO 时间戳（分析完成时刻）。`/report` 读取后直接作为报告的 `generatedAt`，
   * 因此必须是字符串、可被 `buildReportV2` 原样渲染（与 report-contract.ts 对齐）。
   */
  createdAt: string;
  /**
   * ISO 过期时间（createdAt + 2h，PRD §7 本地数据边界）。
   * 旧版本记录没有该字段；读取时按 createdAt + TTL 兼容计算并清理。
   */
  expiresAt?: string;
}

/** 本地会话保留时长：PRD §7「localStorage 2h」。 */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** `tell:lastInput` 的值形状。 */
export interface LastInputMeta {
  fileName: string;
  dateRangeLabel: string;
  messageCount: number;
  /** 可选：与 features 同 TTL；旧记录缺失时按无过期处理。 */
  expiresAt?: string;
}

export interface SessionSaveInput {
  features: ReportFeatures;
  conversation: Conversation;
  fileName: string;
  /** 省略时用 conversation 里的名字推导（You / Them 兜底）。 */
  speakers?: StoredSpeakers;
}

export type SaveFailureReason = "unavailable" | "quota" | "serialization";

export interface SaveSessionResult {
  ok: boolean;
  /** true = 因体积/配额只存了简化版 conversation（报告证据会变少）。 */
  degraded: boolean;
  /** 实际写入的 JSON 字节数。 */
  bytes: number;
  /** 写入成功的存储区；失败为 null。 */
  storage: StorageArea | null;
  /** ok=false 时的原因。 */
  reason?: SaveFailureReason;
}

export interface CheckoutInputMeta {
  fileName: string;
  speakerA: string;
  speakerB: string;
}

const STORAGE_AREAS: readonly StorageArea[] = ["session", "local"];

/* -------------------------------------------------------------------------------------------------
 * Storage 访问（所有异常就地吞掉）
 * ------------------------------------------------------------------------------------------------*/

interface StorageGlobals {
  sessionStorage?: Storage;
  localStorage?: Storage;
}

function areaStorage(area: StorageArea): Storage | null {
  try {
    const globals = globalThis as unknown as StorageGlobals;
    const storage = area === "session" ? globals.sessionStorage : globals.localStorage;
    return storage ?? null;
  } catch {
    // 浏览器隐私模式下访问 localStorage 属性本身就可能抛 SecurityError
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; code?: number };
  if (candidate.name === "QuotaExceededError" || candidate.name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return true;
  }
  return candidate.code === 22 || candidate.code === 1014;
}

interface WriteOutcome {
  area: StorageArea | null;
  quota: boolean;
}

function writeRaw(key: string, value: string): WriteOutcome {
  let quota = false;
  for (const area of STORAGE_AREAS) {
    try {
      const storage = areaStorage(area);
      if (!storage) continue;
      storage.setItem(key, value);
      return { area, quota };
    } catch (error) {
      if (isQuotaError(error)) quota = true;
    }
  }
  return { area: null, quota };
}

function removeRaw(key: string): void {
  for (const area of STORAGE_AREAS) {
    try {
      const storage = areaStorage(area);
      if (storage) storage.removeItem(key);
    } catch {
      // 删除失败不影响主流程
    }
  }
}

function readParsed<T>(key: string, parse: (raw: string) => T | null): T | null {
  for (const area of STORAGE_AREAS) {
    let raw: string | null;
    try {
      const storage = areaStorage(area);
      if (!storage) continue;
      raw = storage.getItem(key);
    } catch {
      continue;
    }
    if (raw === null) continue;
    const value = parse(raw);
    if (value !== null) return value;
  }
  return null;
}

function stringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  // 极端兜底：UTF-16 上限估算（只会让降级更早触发，不会漏判）
  return value.length * 3;
}

/* -------------------------------------------------------------------------------------------------
 * 构建 / 校验
 * ------------------------------------------------------------------------------------------------*/

function joinNames(names: string[], fallback: string): string {
  const cleaned = names.map((name) => name.trim()).filter((name) => name.length > 0);
  return cleaned.length > 0 ? cleaned.join(" / ") : fallback;
}

/** conversation 里的角色名 → 展示用字符串（报告页/结账页只需要这两个名字）。 */
export function speakersFromConversation(conversation: Conversation): StoredSpeakers {
  return {
    user: joinNames(conversation.user.names, "You"),
    partner: joinNames(conversation.partner.names, "Them"),
  };
}

function buildSessionRecord(
  input: SessionSaveInput,
  createdAt: string,
  expiresAt: string,
): ClientSession {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    features: input.features,
    conversation: input.conversation,
    speakers: input.speakers ?? speakersFromConversation(input.conversation),
    fileName: input.fileName,
    createdAt,
    expiresAt,
  };
}

/**
 * 证据所需的最小 conversation：
 * - 只保留 features.attachment 的信号引用到的 messageId（报告层引用的就是这些）；
 * - 一个信号都没有时保留前 20 条，避免报告页完全无文可引；
 * - user/partner 身份、meta、issues 原样保留，统计口径不变。
 */
function minimalConversationFor(
  features: ReportFeatures,
  conversation: Conversation,
): Conversation {
  const evidenceIds = new Set<string>();
  const sides = [features.attachment?.user, features.attachment?.partner];
  for (const side of sides) {
    for (const signal of side?.signals ?? []) {
      for (const messageId of signal.messageIds ?? []) evidenceIds.add(messageId);
    }
  }

  let messages = conversation.messages.filter((message) => evidenceIds.has(message.id));
  if (messages.length === 0) messages = conversation.messages.slice(0, 20);

  return {
    ...conversation,
    messages,
    // 系统消息（加密声明等）不参与证据引用，降级时直接丢掉。
    systemMessages: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredSession(value: unknown): value is ClientSession {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SESSION_SCHEMA_VERSION) return false;
  if (typeof value.fileName !== "string") return false;
  if (typeof value.createdAt !== "string") return false;

  const speakers = value.speakers;
  if (
    !isRecord(speakers) ||
    typeof speakers.user !== "string" ||
    typeof speakers.partner !== "string"
  ) {
    return false;
  }

  const features = value.features;
  if (!isRecord(features) || features.schemaVersion !== FEATURES_SCHEMA_VERSION) return false;
  // 预览页要渲染 features.preview.cards；报告页要 features.health.dimensions /
  // attachment / metrics / sample。这里做浅层形状校验，坏数据直接退化成"无数据"态。
  if (!isRecord(features.preview) || !Array.isArray(features.preview.cards)) return false;
  if (!isRecord(features.health) || !Array.isArray(features.health.dimensions)) return false;
  if (!isRecord(features.attachment) || !isRecord(features.attachment.user)) return false;
  if (!isRecord(features.attachment.partner)) return false;
  if (!isRecord(features.metrics) || !isRecord(features.sample)) return false;

  const conversation = value.conversation;
  if (!isRecord(conversation) || !Array.isArray(conversation.messages)) return false;
  if (!isRecord(conversation.meta)) return false;
  if (!isRecord(conversation.user) || !isRecord(conversation.partner)) return false;

  return true;
}

function isLastInput(value: unknown): value is LastInputMeta {
  if (!isRecord(value)) return false;
  return (
    typeof value.fileName === "string" &&
    typeof value.dateRangeLabel === "string" &&
    typeof value.messageCount === "number"
  );
}

function parseStoredSession(raw: string): ClientSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isStoredSession(parsed) ? parsed : null;
}

function parseStoredLastInput(raw: string): LastInputMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isLastInput(parsed) ? parsed : null;
}

/* -------------------------------------------------------------------------------------------------
 * 公共 API
 * ------------------------------------------------------------------------------------------------*/

/** 估算完整会话（未降级）的序列化体积，供上传页提前提示。序列化失败返回 0。 */
export function estimateSessionBytes(input: SessionSaveInput): number {
  // 固定 ISO 时间戳占位（同样 24 字符），估算值与实际写入体积只差亚字节。
  const stamp = new Date(0).toISOString();
  const json = stringify(buildSessionRecord(input, stamp, stamp));
  return json === null ? 0 : utf8Bytes(json);
}

/**
 * 保存会话。
 * - 体积 > MAX_SESSION_BYTES → 自动降级为最小 conversation；
 * - sessionStorage 写失败（配额/禁用）→ 尝试 localStorage，必要时再降级；
 * - 永不抛异常；ok=false 时页面应展示"本地存储不可用"的人话错误态。
 */
export function saveSession(
  input: SessionSaveInput,
  options: { now?: Date; ttlMs?: number } = {},
): SaveSessionResult {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  let record = buildSessionRecord(input, createdAt, expiresAt);
  let json = stringify(record);
  if (json === null) {
    return { ok: false, degraded: false, bytes: 0, storage: null, reason: "serialization" };
  }

  let bytes = utf8Bytes(json);
  let degraded = false;

  if (bytes > MAX_SESSION_BYTES) {
    record = { ...record, conversation: minimalConversationFor(input.features, input.conversation) };
    const compact = stringify(record);
    if (compact !== null) {
      json = compact;
      bytes = utf8Bytes(compact);
      degraded = true;
    }
  }

  let outcome = writeRaw(FEATURES_STORAGE_KEY, json);

  // 存储配额可能比 3 MB 更小：写失败时再降一级（只留证据消息），然后重试一次。
  if (outcome.area === null && !degraded) {
    record = { ...record, conversation: minimalConversationFor(input.features, input.conversation) };
    const compact = stringify(record);
    if (compact !== null) {
      json = compact;
      bytes = utf8Bytes(compact);
      degraded = true;
      outcome = writeRaw(FEATURES_STORAGE_KEY, json);
    }
  }

  if (outcome.area === null) {
    return {
      ok: false,
      degraded,
      bytes,
      storage: null,
      reason: outcome.quota ? "quota" : "unavailable",
    };
  }

  return { ok: true, degraded, bytes, storage: outcome.area };
}

/** 读取会话；版本不符 / 坏 JSON / Storage 不可用 / 过期 → null（过期会顺便清理）。 */
export function loadSession(options: { now?: number } = {}): ClientSession | null {
  const session = readParsed(FEATURES_STORAGE_KEY, parseStoredSession);
  if (session === null) return null;
  if (isSessionExpired(session, options.now ?? Date.now())) {
    removeRaw(FEATURES_STORAGE_KEY);
    return null;
  }
  return session;
}

/** 过期判定：优先 expiresAt；旧记录回落 createdAt + TTL。 */
export function sessionExpiresAt(session: Pick<ClientSession, "createdAt" | "expiresAt">): number | null {
  if (session.expiresAt) {
    const parsed = Date.parse(session.expiresAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const created = Date.parse(session.createdAt);
  if (Number.isFinite(created)) return created + SESSION_TTL_MS;
  return null;
}

function isSessionExpired(
  session: Pick<ClientSession, "createdAt" | "expiresAt">,
  now: number,
): boolean {
  const expiry = sessionExpiresAt(session);
  return expiry !== null && now > expiry;
}

/** 主动清理已过期的本地会话（启动/测试可用）；返回是否清理了 features。 */
export function purgeExpiredSessions(options: { now?: number } = {}): boolean {
  const now = options.now ?? Date.now();
  const session = readParsed(FEATURES_STORAGE_KEY, parseStoredSession);
  if (session === null) return false;
  if (!isSessionExpired(session, now)) return false;
  removeRaw(FEATURES_STORAGE_KEY);
  return true;
}

/** 清空本会话的所有本地数据（特征、lastInput、旧结账元数据）。 */
export function clearSession(): void {
  removeRaw(FEATURES_STORAGE_KEY);
  removeRaw(LAST_INPUT_STORAGE_KEY);
  removeRaw(LEGACY_CHECKOUT_INPUT_KEY);
}

/** 写上传元信息；失败返回 false（不阻塞主流程）。 */
export function saveLastInput(
  input: LastInputMeta,
  options: { now?: Date; ttlMs?: number } = {},
): boolean {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const json = stringify({
    ...input,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
  if (json === null) return false;
  return writeRaw(LAST_INPUT_STORAGE_KEY, json).area !== null;
}

/** 读上传元信息；坏 JSON / 缺字段 / 过期 → null（过期会清理）。 */
export function loadLastInput(options: { now?: number } = {}): LastInputMeta | null {
  const value = readParsed(LAST_INPUT_STORAGE_KEY, parseStoredLastInput);
  if (value === null) return null;
  if (value.expiresAt) {
    const expiry = Date.parse(value.expiresAt);
    if (Number.isFinite(expiry) && (options.now ?? Date.now()) > expiry) {
      removeRaw(LAST_INPUT_STORAGE_KEY);
      return null;
    }
  }
  return value;
}

/**
 * 兼容既有 /checkout 与 /api/checkout：只写文件名 + 双方昵称，pasted 恒为空串。
 * 旧实现会把粘贴原文塞进这个键；新链路不再这么做（隐私）。
 */
export function saveCheckoutInput(input: CheckoutInputMeta): boolean {
  const json = stringify({
    fileName: input.fileName,
    speakerA: input.speakerA,
    speakerB: input.speakerB,
    pasted: "",
  });
  if (json === null) return false;
  try {
    const storage = areaStorage("local");
    if (!storage) return false;
    storage.setItem(LEGACY_CHECKOUT_INPUT_KEY, json);
    return true;
  } catch {
    return false;
  }
}
