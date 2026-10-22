/**
 * LLM provider abstraction (W5-3)
 * ==============================
 * The narrative layer is **optional**: the deterministic report engine is the
 * product's source of truth and must keep working with no API key, no network
 * and no extra dependencies. This module defines the smallest useful provider
 * surface for that:
 *
 *   - `LlmProvider.complete(request) -> { text, usage }`
 *   - `OpenAiCompatibleProvider` — any OpenAI-compatible `/chat/completions`
 *     endpoint (OpenAI, Azure-style proxies, local vLLM...), configured from
 *     `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS`.
 *   - `NullLlmProvider` — `isEnabled() === false`; `complete()` rejects, so the
 *     narrative layer falls back to the rules report without a network call.
 *   - `getLlmProvider()` — factory returning Null when no key is configured.
 *   - `estimateCostUsd()` — coarse price table for observability/budgeting.
 *
 * No SDK, no new dependency: plain `fetch`, injectable for tests. No `Date.now`
 * is needed here; timeouts use `setTimeout` inside `complete()`.
 */

export const DEFAULT_LLM_MODEL = "gpt-4o-mini";
export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_LLM_TIMEOUT_MS = 12_000;
export const DEFAULT_LLM_MAX_TOKENS = 900;
export const DEFAULT_LLM_TEMPERATURE = 0.4;

/**
 * Price table in USD per 1M tokens.
 *
 * VALUES ARE COARSE AND MUST BE RE-VERIFIED BEFORE LAUNCH:
 * TODO(pricing): reconcile with the provider's current price list and the
 * invoice once the account is real (prices change; regional/VAT differences
 * are not modelled here). This is for internal cost observability only, never
 * for charging users.
 *
 * Source: OpenAI public list prices as of 2025-04 (approximate, do not bill on).
 */
export interface LlmModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  source: string;
}

export const LLM_PRICING: Readonly<Record<string, LlmModelPricing>> = {
  "gpt-4o-mini": {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    source: "OpenAI list price 2024-10 (verify before launch)",
  },
  "gpt-4.1-mini": {
    inputPer1M: 0.4,
    outputPer1M: 1.6,
    source: "OpenAI list price 2025-04 (verify before launch)",
  },
  "gpt-4o": {
    inputPer1M: 2.5,
    outputPer1M: 10,
    source: "OpenAI list price 2024-10 (verify before launch)",
  },
};

/** Fallback used for unknown models so cost estimates never return NaN. */
export const FALLBACK_PRICING_MODEL = DEFAULT_LLM_MODEL;

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmRequest {
  /** Optional system instruction. */
  system?: string;
  /** User prompt. Must contain only generated-report facts, never raw chat. */
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Per-call timeout override in ms. */
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  usage: LlmUsage;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  isEnabled(): boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Minimal `Response` surface so tests can inject a plain object. */
export interface LlmFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type LlmFetch = (url: string, init?: RequestInit) => Promise<LlmFetchResponse>;

/* -------------------------------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------------------------------*/

export type LlmErrorCode = "not-configured" | "timeout" | "http" | "parse";

export class LlmError extends Error {
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}

export class LlmNotConfiguredError extends LlmError {
  constructor(message = "LLM provider is not configured") {
    super("not-configured", message);
    this.name = "LlmNotConfiguredError";
  }
}

export class LlmTimeoutError extends LlmError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("timeout", `LLM request timed out after ${timeoutMs}ms`);
    this.name = "LlmTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class LlmHttpError extends LlmError {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, message = `LLM request failed with HTTP ${status}`) {
    super("http", message);
    this.name = "LlmHttpError";
    this.status = status;
    // 5xx and 429 are worth one retry; 4xx auth/shape errors are not.
    this.retryable = status >= 500 || status === 429;
  }
}

export class LlmParseError extends LlmError {
  constructor(message = "LLM response could not be parsed") {
    super("parse", message);
    this.name = "LlmParseError";
  }
}

/* -------------------------------------------------------------------------------------------------
 * Tiny helpers
 * ------------------------------------------------------------------------------------------------*/

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function resolveTimeoutMs(raw: string | number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_LLM_TIMEOUT_MS;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function clampTokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeUsage(raw: unknown): LlmUsage {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const promptTokens = clampTokens(record.prompt_tokens ?? record.promptTokens);
  const completionTokens = clampTokens(record.completion_tokens ?? record.completionTokens);
  const reportedTotal = clampTokens(record.total_tokens ?? record.totalTokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: reportedTotal > 0 ? reportedTotal : promptTokens + completionTokens,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Null provider
 * ------------------------------------------------------------------------------------------------*/

/** Always-disabled provider: the rules report is used verbatim. */
export class NullLlmProvider implements LlmProvider {
  readonly name = "null";
  readonly model = "none";

  isEnabled(): boolean {
    return false;
  }

  async complete(): Promise<LlmResponse> {
    throw new LlmNotConfiguredError("No LLM provider is configured");
  }
}

/* -------------------------------------------------------------------------------------------------
 * OpenAI-compatible provider
 * ------------------------------------------------------------------------------------------------*/

export interface OpenAiCompatibleConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: LlmFetch;
  /** Path appended to baseUrl; override only for non-standard gateways. */
  chatPath?: string;
}

/**
 * Minimal OpenAI-compatible chat-completions client.
 *
 * Request: `POST {baseUrl}/chat/completions` with
 * `{ model, messages, temperature, max_tokens }` and a Bearer token.
 * Response: `choices[0].message.content` + `usage.prompt_tokens/completion_tokens`.
 * Errors are surfaced as `LlmError` subclasses so the narrative layer can
 * decide whether a retry is worthwhile.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai-compatible";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: LlmFetch;
  private readonly chatPath: string;

  constructor(config: OpenAiCompatibleConfig = {}) {
    this.baseUrl = firstNonEmpty(config.baseUrl) ?? DEFAULT_LLM_BASE_URL;
    this.apiKey = firstNonEmpty(config.apiKey) ?? "";
    this.model = firstNonEmpty(config.model) ?? DEFAULT_LLM_MODEL;
    this.timeoutMs = resolveTimeoutMs(config.timeoutMs);
    this.chatPath = firstNonEmpty(config.chatPath) ?? "/chat/completions";
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  isEnabled(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.isEnabled()) {
      throw new LlmNotConfiguredError(`LLM_API_KEY is not set (model ${this.model})`);
    }

    const timeoutMs = resolveTimeoutMs(request.timeoutMs ?? this.timeoutMs);
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (typeof request.system === "string" && request.system.trim().length > 0) {
      messages.push({ role: "system", content: request.system.trim() });
    }
    messages.push({ role: "user", content: request.prompt });

    const body = {
      model: this.model,
      messages,
      temperature: request.temperature ?? DEFAULT_LLM_TEMPERATURE,
      max_tokens: request.maxTokens ?? DEFAULT_LLM_MAX_TOKENS,
    };

    const controller =
      typeof AbortController === "undefined" ? null : new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: LlmFetchResponse;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(new LlmTimeoutError(timeoutMs));
        }, timeoutMs);
      });
      response = await Promise.race([
        this.fetchImpl(joinUrl(this.baseUrl, this.chatPath), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller?.signal,
        }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (!response.ok) {
      throw new LlmHttpError(response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LlmParseError("LLM response body was not valid JSON");
    }
    const record =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)
        : {};
    const choices = Array.isArray(record.choices) ? record.choices : [];
    const firstChoice =
      typeof choices[0] === "object" && choices[0] !== null
        ? (choices[0] as Record<string, unknown>)
        : {};
    const message =
      typeof firstChoice.message === "object" && firstChoice.message !== null
        ? (firstChoice.message as Record<string, unknown>)
        : {};
    const content = message.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new LlmParseError("LLM response did not contain message content");
    }

    return {
      text: content.trim(),
      usage: normalizeUsage(record.usage),
      model: typeof record.model === "string" && record.model.trim() ? record.model.trim() : this.model,
    };
  }
}

/* -------------------------------------------------------------------------------------------------
 * Factory
 * ------------------------------------------------------------------------------------------------*/

export interface LlmFactoryOptions {
  /** Injectable env for tests; defaults to process.env when available. */
  env?: Record<string, string | undefined>;
  fetchImpl?: LlmFetch;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

function currentEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

/**
 * Build the configured provider, or `NullLlmProvider` when `LLM_API_KEY` is
 * missing. The narrative layer checks `isEnabled()` first, so a deployment
 * without a key performs zero network requests and returns the rules report.
 */
export function getLlmProvider(options: LlmFactoryOptions = {}): LlmProvider {
  const env = options.env ?? currentEnv();
  const apiKey = firstNonEmpty(options.apiKey, env.LLM_API_KEY);
  if (apiKey === undefined) return new NullLlmProvider();

  return new OpenAiCompatibleProvider({
    baseUrl: firstNonEmpty(options.baseUrl, env.LLM_BASE_URL),
    apiKey,
    model: firstNonEmpty(options.model, env.LLM_MODEL),
    timeoutMs: options.timeoutMs ?? resolveTimeoutMs(env.LLM_TIMEOUT_MS),
    fetchImpl: options.fetchImpl,
  });
}

/* -------------------------------------------------------------------------------------------------
 * Cost estimation
 * ------------------------------------------------------------------------------------------------*/

function pricingFor(model: string): LlmModelPricing {
  const normalized = model.trim().toLowerCase();
  const exact = LLM_PRICING[normalized];
  if (exact !== undefined) return exact;
  // Snapshot suffixes: "gpt-4o-mini-2024-07-18" -> "gpt-4o-mini".
  let bestKey: string | null = null;
  for (const key of Object.keys(LLM_PRICING)) {
    if (normalized === key || normalized.startsWith(`${key}-`)) {
      if (bestKey === null || key.length > bestKey.length) bestKey = key;
    }
  }
  if (bestKey !== null) return LLM_PRICING[bestKey] as LlmModelPricing;
  return LLM_PRICING[FALLBACK_PRICING_MODEL] as LlmModelPricing;
}

/**
 * Rough USD cost for one call, from the centralized price table.
 * Unknown models fall back to `FALLBACK_PRICING_MODEL`; negative/NaN token
 * counts are clamped to 0 so this never returns NaN or a negative number.
 */
export function estimateCostUsd(model: string, usage: LlmUsage): number {
  const pricing = pricingFor(model);
  const record = usage as unknown as Record<string, unknown>;
  const promptTokens = clampTokens(record?.promptTokens);
  const completionTokens = clampTokens(record?.completionTokens);
  const cost =
    (promptTokens / 1_000_000) * pricing.inputPer1M +
    (completionTokens / 1_000_000) * pricing.outputPer1M;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
