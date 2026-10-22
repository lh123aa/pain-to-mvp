/**
 * llm.ts tests (W5-3).
 *
 * Everything is offline: a fake `fetch` is injected. The provider contract is
 * intentionally tiny (OpenAI-compatible `/chat/completions`), so these tests
 * pin the wire shape, timeout/error taxonomy, the env factory and the
 * centralized cost estimate.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LLM_TIMEOUT_MS,
  LLM_PRICING,
  LlmHttpError,
  LlmNotConfiguredError,
  LlmParseError,
  LlmTimeoutError,
  NullLlmProvider,
  OpenAiCompatibleProvider,
  estimateCostUsd,
  getLlmProvider,
  type LlmFetch,
  type LlmFetchResponse,
  type LlmUsage,
} from "@/lib/llm";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

type Responder = () => LlmFetchResponse | Promise<LlmFetchResponse>;

function makeFakeFetch(responses: Responder[]): { impl: LlmFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const remaining = [...responses];
  const impl: LlmFetch = async (url, init) => {
    calls.push({ url, init });
    const responder = remaining.shift();
    if (responder === undefined) throw new Error(`unexpected fetch call: ${url}`);
    return responder();
  };
  return { impl, calls };
}

function jsonResponder(status: number, body: unknown): Responder {
  return () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function chatResponse(content: string, usage: Record<string, number> = {}): Responder {
  return jsonResponder(200, {
    model: "gpt-4o-mini-2024-07-18",
    choices: [{ message: { role: "assistant", content } }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      ...usage,
    },
  });
}

function usage(promptTokens: number, completionTokens: number): LlmUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function providerWith(responses: Responder[], overrides: { timeoutMs?: number } = {}) {
  const fake = makeFakeFetch(responses);
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://llm.example/v1/",
    apiKey: "test-key",
    model: "gpt-4o-mini",
    timeoutMs: overrides.timeoutMs ?? 1000,
    fetchImpl: fake.impl,
  });
  return { provider, ...fake };
}

function parsedBody(call: FetchCall | undefined): Record<string, unknown> {
  const raw = call?.init?.body;
  if (typeof raw !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("getLlmProvider factory", () => {
  it("returns the disabled Null provider when no key is configured", async () => {
    const provider = getLlmProvider({ env: {} });
    expect(provider).toBeInstanceOf(NullLlmProvider);
    expect(provider.isEnabled()).toBe(false);
    await expect(
      provider.complete({ prompt: "hello" }),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });

  it("stays disabled when a base URL/model is set but the key is missing", () => {
    const provider = getLlmProvider({
      env: { LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "gpt-4o-mini" },
    });
    expect(provider.isEnabled()).toBe(false);
  });

  it("builds an enabled provider from env (URL, model, timeout) and calls chat/completions", async () => {
    const fake = makeFakeFetch([chatResponse("Hello from the model")]);
    const provider = getLlmProvider({
      env: {
        LLM_API_KEY: "env-key",
        LLM_BASE_URL: "https://env.example/v1",
        LLM_MODEL: "gpt-4.1-mini",
        LLM_TIMEOUT_MS: "5000",
      },
      fetchImpl: fake.impl,
    });
    expect(provider.isEnabled()).toBe(true);
    expect(provider.model).toBe("gpt-4.1-mini");

    const response = await provider.complete({
      system: "System instruction",
      prompt: "Rewrite this report.",
      maxTokens: 300,
      temperature: 0.2,
    });
    expect(response.text).toBe("Hello from the model");
    expect(fake.calls[0]?.url).toBe("https://env.example/v1/chat/completions");
    expect(fake.calls[0]?.init?.method).toBe("POST");

    const body = parsedBody(fake.calls[0]);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.max_tokens).toBe(300);
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toEqual([
      { role: "system", content: "System instruction" },
      { role: "user", content: "Rewrite this report." },
    ]);
    const headers = fake.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer env-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("lets explicit factory options win over env", async () => {
    const fake = makeFakeFetch([chatResponse("ok")]);
    const provider = getLlmProvider({
      env: { LLM_API_KEY: "env-key", LLM_MODEL: "gpt-4o-mini", LLM_BASE_URL: "https://env/v1" },
      apiKey: "explicit-key",
      model: "gpt-4o",
      baseUrl: "https://explicit/v1",
      fetchImpl: fake.impl,
    });
    await provider.complete({ prompt: "hi" });
    expect(fake.calls[0]?.url).toBe("https://explicit/v1/chat/completions");
    expect(parsedBody(fake.calls[0]).model).toBe("gpt-4o");
  });
});

describe("OpenAiCompatibleProvider.complete", () => {
  it("returns trimmed text + normalized usage", async () => {
    const { provider } = providerWith([
      jsonResponder(200, {
        model: "gpt-4o-mini-2024-07-18",
        choices: [{ message: { content: "  enhanced copy  " } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      }),
    ]);
    const response = await provider.complete({ prompt: "p" });
    expect(response.text).toBe("enhanced copy");
    expect(response.usage).toEqual(usage(10, 4));
    expect(response.model).toBe("gpt-4o-mini-2024-07-18");
  });

  it("falls back to prompt+completion when total_tokens is missing", async () => {
    const { provider } = providerWith([
      jsonResponder(200, {
        choices: [{ message: { content: "x" } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }),
    ]);
    expect((await provider.complete({ prompt: "p" })).usage).toEqual(usage(7, 3));
  });

  it("maps HTTP failures to LlmHttpError with retryability", async () => {
    const serverError = providerWith([jsonResponder(500, {})]).provider;
    const error = await serverError.complete({ prompt: "p" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(LlmHttpError);
    if (!(error instanceof LlmHttpError)) throw new Error("expected LlmHttpError");
    expect(error.status).toBe(500);
    expect(error.retryable).toBe(true);

    const unauthorized = providerWith([jsonResponder(401, {})]).provider;
    const authError = await unauthorized.complete({ prompt: "p" }).catch((err: unknown) => err);
    expect(authError instanceof LlmHttpError && authError.retryable).toBe(false);
  });

  it("maps invalid JSON / missing content to LlmParseError", async () => {
    const badJson: LlmFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    const provider = new OpenAiCompatibleProvider({ apiKey: "k", fetchImpl: badJson });
    await expect(provider.complete({ prompt: "p" })).rejects.toBeInstanceOf(LlmParseError);

    const noContent = providerWith([jsonResponder(200, { choices: [] })]).provider;
    await expect(noContent.complete({ prompt: "p" })).rejects.toBeInstanceOf(LlmParseError);
  });

  it("aborts with LlmTimeoutError when the provider hangs", async () => {
    const hanging: LlmFetch = () => new Promise<LlmFetchResponse>(() => {});
    const provider = new OpenAiCompatibleProvider({
      apiKey: "k",
      timeoutMs: 5,
      fetchImpl: hanging,
    });
    await expect(provider.complete({ prompt: "p" })).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it("throws LlmNotConfiguredError when complete is called without a key", async () => {
    const provider = new OpenAiCompatibleProvider({ apiKey: "" });
    expect(provider.isEnabled()).toBe(false);
    await expect(provider.complete({ prompt: "p" })).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });
});

describe("estimateCostUsd", () => {
  it("uses the centralized price table for known models", () => {
    const mini = LLM_PRICING["gpt-4o-mini"];
    expect(mini).toBeDefined();
    if (mini === undefined) throw new Error("missing price");
    const oneMillionEach = usage(1_000_000, 1_000_000);
    expect(estimateCostUsd("gpt-4o-mini", oneMillionEach)).toBeCloseTo(
      mini.inputPer1M + mini.outputPer1M,
      6,
    );
  });

  it("matches dated model snapshots to their base price", () => {
    expect(estimateCostUsd("gpt-4o-mini-2024-07-18", usage(1_000_000, 1_000_000))).toBe(
      estimateCostUsd("gpt-4o-mini", usage(1_000_000, 1_000_000)),
    );
  });

  it("returns 0 for zero/negative/NaN token counts and unknown models are covered", () => {
    expect(estimateCostUsd("gpt-4o-mini", usage(0, 0))).toBe(0);
    expect(estimateCostUsd("gpt-4o-mini", usage(-5, Number.NaN))).toBe(0);
    const unknown = estimateCostUsd("some-future-model", usage(1_000_000, 1_000_000));
    expect(Number.isFinite(unknown)).toBe(true);
    expect(unknown).toBeGreaterThan(0);
  });

  it("rounds to 6 decimals", () => {
    const value = estimateCostUsd("gpt-4o-mini", usage(1, 0));
    expect(value).toBe(0);
  });
});

describe("constants", () => {
  it("exposes a sane default timeout", () => {
    expect(DEFAULT_LLM_TIMEOUT_MS).toBeGreaterThan(1000);
  });
});
