/**
 * PostHog EU 埋点 · 最小上报器（W3-6）
 * ------------------------------------------------------------------
 * 为什么不是 posthog-js：项目没有该依赖，任务约束也不允许为此改
 * package.json。这里用原生 `fetch` 直接 POST 到 PostHog 的 `/capture/`
 * 端点，行为上等价于 SDK 的 `capture()`，但没有 SDK 的副作用：
 *   - 不注入 DOM 监听 → 天然没有 autocapture / session replay / heatmap；
 *   - 不写 cookie、不加载远程脚本、不建连接，直到第一次真正 capture；
 *   - 无 `NEXT_PUBLIC_POSTHOG_KEY` 时 `isEnabled() === false`，所有
 *     capture/pageview 直接 return（no-op，不发网络、不碰 storage）。
 *
 * PII 纪律（硬约束，逐条实现）：
 *   1. 事件属性只允许 **顶层白名单键**（`PROPERTY_RULES`）；未知键一律丢弃。
 *      —— 因而 fileName / speakerA / text / email / pasted 等永远进不来。
 *   2. 每个键只接受与其语义匹配的类型：
 *      - 布尔键只收 boolean；
 *      - 数字键只收有限数字，且必须落在定义域内（如 confidence ∈ [0,1]）；
 *      - 枚举键只收白名单字符串（如 mode = live/mock/timed/untimed/single/merge）；
 *      - 短串键（utm）只收 ≤32 字符、无空格、`[A-Za-z0-9._-]` 的 slug。
 *      任意文本/对象/数组/NaN/Infinity 全部丢弃。
 *   3. `$pageview` 的 path 先过 `sanitizePath()`：去掉 `?query` 与 `#hash`，
 *      只保留 pathname（因此 token / order_id / email 不可能被带上），并过滤
 *      非法字符、截断到 120 字符。
 *   4. distinct_id 是随机匿名 id（crypto.randomUUID），存在 sessionStorage
 *      的 `tell:analytics-id`（仅本标签页；读写失败时退回内存），不含任何 PII。
 *
 * 五节点漏斗（PRD）：现有页面 track() 事件已覆盖，映射见 `FUNNEL_EVENTS`；
 * 本模块不改任何页面调用方（唯一改动是 hooks.ts 的 track 实现 + layout 挂载）。
 */

export type PostHogFetch = typeof fetch;

export type SanitizedPropertyValue = string | number | boolean;
export type SanitizedProperties = Record<string, SanitizedPropertyValue>;

/* -------------------------------------------------------------------------------------------------
 * 环境变量与 host
 * ------------------------------------------------------------------------------------------------*/

/** PostHog EU 云端 ingestion host。env 常被写成 app 域（eu.posthog.com），这里做别名纠正。 */
export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

/** sessionStorage 里的匿名 id 键（只在本标签页有效，可随标签页关闭消失）。 */
export const ANON_ID_STORAGE_KEY = "tell:analytics-id";

const HOST_ALIASES: Readonly<Record<string, string>> = {
  "https://eu.posthog.com": "https://eu.i.posthog.com",
  "https://us.posthog.com": "https://us.i.posthog.com",
  "https://app.posthog.com": "https://us.i.posthog.com",
  "https://posthog.com": "https://us.i.posthog.com",
};

/** 归一化 host：去尾部斜杠；把 PostHog 的 app 域映射到 ingestion 域；空值用 EU 默认。 */
export function resolveHost(rawHost?: string | null): string {
  const trimmed = (rawHost ?? "").trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return DEFAULT_POSTHOG_HOST;
  const alias = HOST_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}

/** 最终上报 URL：`${host}/capture/`。 */
export function resolveCaptureUrl(rawHost?: string | null): string {
  return `${resolveHost(rawHost)}/capture/`;
}

/* -------------------------------------------------------------------------------------------------
 * 属性白名单（唯一允许上报的字段）
 * ------------------------------------------------------------------------------------------------*/

type PropertyRule =
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number; integer?: boolean }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "slug"; maxLength: number }
  | { kind: "path" };

/** 枚举值必须与页面实际传参一致；新增枚举需同时更新此表与单测。 */
const ENUMS = {
  mode: ["timed", "untimed", "mock", "live", "single", "merge"],
  kind: ["file", "paste"],
  reason: [
    "group-chat",
    "unsupported-extension",
    "file-too-large",
    "quota",
    "unavailable",
    "serialization",
    "payment-pending",
    "missing-credential",
    "expired",
    "invalid",
    "revoked",
    "not-found",
    "error",
  ],
  source: ["mock", "token", "order", "live", "missing"],
  platform: ["whatsapp", "imessage", "paste"],
  dateOrder: ["DMY", "MDY", "YMD", "unknown"],
  order: ["DMY", "MDY", "YMD"],
  grade: ["A", "B", "C"],
  storage: ["session", "local"],
  position: ["hero", "footer", "nav", "header", "mid", "inline", "sticky"],
} as const;

const PROPERTY_RULES: Readonly<Record<string, PropertyRule>> = {
  /* 枚举（短字符串） */
  mode: { kind: "enum", values: ENUMS.mode },
  kind: { kind: "enum", values: ENUMS.kind },
  reason: { kind: "enum", values: ENUMS.reason },
  source: { kind: "enum", values: ENUMS.source },
  platform: { kind: "enum", values: ENUMS.platform },
  dateOrder: { kind: "enum", values: ENUMS.dateOrder },
  order: { kind: "enum", values: ENUMS.order },
  grade: { kind: "enum", values: ENUMS.grade },
  storage: { kind: "enum", values: ENUMS.storage },
  position: { kind: "enum", values: ENUMS.position },

  /* 数字（有限、有界；计数类必须整数） */
  messages: { kind: "number", min: 0, max: 10_000_000, integer: true },
  candidates: { kind: "number", min: 0, max: 1_000, integer: true },
  senders: { kind: "number", min: 0, max: 1_000, integer: true },
  size: { kind: "number", min: 0, max: 1_000_000_000_000, integer: true },
  bytes: { kind: "number", min: 0, max: 1_000_000_000_000, integer: true },
  status: { kind: "number", min: 0, max: 599, integer: true },
  step: { kind: "number", min: 0, max: 20, integer: true },
  price: { kind: "number", min: 0, max: 100_000 },
  score: { kind: "number", min: 0, max: 100 },
  confidence: { kind: "number", min: 0, max: 1 },
  durationDays: { kind: "number", min: 0, max: 1_000_000 },

  /* 布尔 */
  ok: { kind: "boolean" },
  mock: { kind: "boolean" },
  timed: { kind: "boolean" },
  degraded: { kind: "boolean" },
  alreadyDone: { kind: "boolean" },
  hasFile: { kind: "boolean" },
  hasPaste: { kind: "boolean" },

  /* 短 slug：utm 来自 URL 查询参数，必须严格限制（任意文本/URL 一律丢弃） */
  utm: { kind: "slug", maxLength: 32 },

  /* pageview 专用：只保留 pathname */
  path: { kind: "path" },
};

/** 允许上报的属性键（文档/测试用）。 */
export const ALLOWED_PROPERTY_KEYS: readonly string[] = Object.keys(PROPERTY_RULES);

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_PATH_LENGTH = 120;

/**
 * 把 path 洗成可安全上报的 pathname：
 * - 绝对 URL 取 pathname；去掉 `?query` 与 `#hash`；
 * - 过滤掉 `[A-Za-z0-9/_\-.~]` 之外的字符（空格、@、中文、引号等）；
 * - 合并重复斜杠；截断到 120 字符；空值回落 `/`。
 * 因此 `/report?token=SECRET&order_id=ord_1` → `/report`。
 */
export function sanitizePath(rawPath: unknown): string {
  if (typeof rawPath !== "string" || rawPath.length === 0) return "/";

  let path = rawPath;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "/";
    }
  }

  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);

  path = path.trim().replace(/[^A-Za-z0-9/_\-.~]/g, "");
  path = path.replace(/\/{2,}/g, "/");
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > MAX_PATH_LENGTH) path = path.slice(0, MAX_PATH_LENGTH);
  return path.length > 0 ? path : "/";
}

function sanitizeValue(rule: PropertyRule, value: unknown): SanitizedPropertyValue | null {
  switch (rule.kind) {
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      if (rule.integer && !Number.isInteger(value)) return null;
      if (rule.min !== undefined && value < rule.min) return null;
      if (rule.max !== undefined && value > rule.max) return null;
      return value;
    }
    case "enum":
      return typeof value === "string" && rule.values.includes(value) ? value : null;
    case "slug":
      return typeof value === "string" &&
        value.length > 0 &&
        value.length <= rule.maxLength &&
        SLUG_RE.test(value)
        ? value
        : null;
    case "path":
      return typeof value === "string" ? sanitizePath(value) : null;
  }
}

/**
 * PII 白名单过滤（导出以便 hooks.track 先过滤再 capture，也便于单测）。
 * 只返回白名单键 + 合法值；任何未知键/对象/超长或含空格的文本都会被丢弃。
 */
export function sanitizeProperties(input: unknown): SanitizedProperties {
  const output: SanitizedProperties = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return output;

  for (const [key, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const rule = PROPERTY_RULES[key];
    if (!rule) continue;
    const value = sanitizeValue(rule, rawValue);
    if (value !== null) output[key] = value;
  }
  return output;
}

/* -------------------------------------------------------------------------------------------------
 * 客户端
 * ------------------------------------------------------------------------------------------------*/

export interface PostHogClientOptions {
  /** 空/缺省 → 整个客户端 disabled（no-op）。 */
  key?: string;
  /** 默认 EU ingestion host；见 resolveHost()。 */
  host?: string | null;
  /** 可注入 fetch（单测不碰真实网络）。 */
  fetchImpl?: PostHogFetch;
  /** 可注入时钟（默认 Date.now）。 */
  now?: () => number;
  /** 可注入匿名 id 生成器（默认 crypto.randomUUID）。 */
  idFactory?: () => string;
}

export interface PostHogClient {
  isEnabled(): boolean;
  capture(event: string, properties?: Record<string, unknown>): void;
  pageview(path: string): void;
}

function defaultIdFactory(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* 回退到 Math.random */
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sessionStorageArea(): Storage | null {
  try {
    const globals = globalThis as unknown as { sessionStorage?: Storage };
    return globals.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredAnonId(): string | null {
  try {
    const value = sessionStorageArea()?.getItem(ANON_ID_STORAGE_KEY);
    return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
  } catch {
    return null;
  }
}

function persistAnonId(id: string): void {
  try {
    sessionStorageArea()?.setItem(ANON_ID_STORAGE_KEY, id);
  } catch {
    /* 隐私模式/配额满：只留内存，不影响上报 */
  }
}

/**
 * 创建上报客户端。无 key 时 isEnabled()=false，capture/pageview 完全 no-op
 * （不发 fetch、不读写 sessionStorage、不生成 id）。
 */
export function createPostHogClient(options: PostHogClientOptions = {}): PostHogClient {
  const key = (options.key ?? "").trim();
  const enabled = key.length > 0;
  const captureUrl = resolveCaptureUrl(options.host);
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  const now = options.now ?? (() => Date.now());
  const idFactory = options.idFactory ?? defaultIdFactory;

  let distinctId: string | null = null;

  function getDistinctId(): string {
    if (distinctId !== null) return distinctId;
    const stored = readStoredAnonId();
    distinctId = stored ?? idFactory();
    if (stored === null) persistAnonId(distinctId);
    return distinctId;
  }

  function capture(event: string, properties: Record<string, unknown> = {}): void {
    if (!enabled || !fetchImpl) return;
    if (typeof event !== "string" || event.trim().length === 0) return;

    const payload = {
      api_key: key,
      event,
      properties: {
        ...sanitizeProperties(properties),
        // distinct_id 放在最后，调用方无法用同名属性覆盖成自己的 PII
        distinct_id: getDistinctId(),
      },
      timestamp: new Date(now()).toISOString(),
    };

    try {
      void Promise.resolve(
        fetchImpl(captureUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }),
      ).catch(() => {
        /* 网络失败绝不影响产品流程 */
      });
    } catch {
      /* 注入的 fetch 同步抛错也要吞掉 */
    }
  }

  function pageview(path: string): void {
    if (!enabled) return;
    capture("$pageview", { path: sanitizePath(path) });
  }

  return {
    isEnabled: () => enabled,
    capture,
    pageview,
  };
}

/* -------------------------------------------------------------------------------------------------
 * 模块级单例（env 驱动；init 幂等）+ hooks.track 的入口
 * ------------------------------------------------------------------------------------------------*/

let singleton: PostHogClient | null = null;

function envValue(value: string | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * 用 `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` 初始化单例。
 * 重复调用返回同一实例（幂等），不会重复建客户端/生成新 distinct_id。
 * 无 key 时返回 disabled 客户端（所有 capture 为 no-op）。
 */
export function initPostHog(overrides: PostHogClientOptions = {}): PostHogClient {
  if (singleton) return singleton;
  singleton = createPostHogClient({
    key: overrides.key ?? envValue(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    host: overrides.host ?? envValue(process.env.NEXT_PUBLIC_POSTHOG_HOST),
    fetchImpl: overrides.fetchImpl,
    now: overrides.now,
    idFactory: overrides.idFactory,
  });
  return singleton;
}

export function getPostHogClient(): PostHogClient {
  return singleton ?? initPostHog();
}

export function isPostHogEnabled(): boolean {
  return getPostHogClient().isEnabled();
}

/** 深链：过滤属性 + capture。页面统一通过 hooks.track() 调用。 */
export function capture(event: string, properties: Record<string, unknown> = {}): void {
  getPostHogClient().capture(event, sanitizeProperties(properties));
}

/** pageview：只带 path（已去 query/hash）。 */
export function capturePageView(path: string): void {
  getPostHogClient().pageview(path);
}

/** 仅测试用：清空单例，让下次 init 重新读 env。 */
export function resetPostHogForTests(): void {
  singleton = null;
}

/* -------------------------------------------------------------------------------------------------
 * 五节点漏斗映射（文档用；页面事件名保持不变）
 * ------------------------------------------------------------------------------------------------*/

/**
 * PRD 五节点漏斗 → 现有 track() 事件名。
 * 1 访问 → 2 上传/解析 → 3 免费预览 → 4 结账 → 5 报告打开。
 */
export const FUNNEL_EVENTS = {
  visit: ["landing_view", "$pageview"],
  upload: ["upload_pick", "upload_reject", "analyze_continue", "parse_ok"],
  preview: ["analyze_ready", "freecards_view"],
  checkout: ["freecards_buy_click", "checkout_view", "report_waiting", "report_invalid"],
  report: ["report_view", "report_refund", "report_delete", "report_delete_local"],
} as const;
