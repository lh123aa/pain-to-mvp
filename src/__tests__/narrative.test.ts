/**
 * report-narrative tests (W5-3).
 *
 * The deterministic report is the baseline, so every test here asserts either
 * "unchanged fallback" or "only the allowed fields changed". The LLM transport
 * is a fake fetch injected through `OpenAiCompatibleProvider`; no network.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  NullLlmProvider,
  OpenAiCompatibleProvider,
  type LlmFetch,
  type LlmFetchResponse,
} from "@/lib/llm";
import {
  NARRATIVE_MAX_ACTION_WHY_CHARS,
  NARRATIVE_MAX_ATTEMPTS,
  NARRATIVE_MAX_SUMMARY_CHARS,
  applyNarrative,
  buildNarrativeRequest,
  enhanceNarrative,
  parseNarrativeOutput,
} from "@/lib/report-narrative";
import {
  REPORT_CHAPTER_IDS,
  type ChapterId,
  type ReportDataV2,
} from "@/lib/report-contract";
import { buildReportV2 } from "@/lib/report-engine";
import {
  conversationFromChat,
  createSpeakerMap,
  parseWhatsAppTxt,
} from "@/parser";
import { buildReportFeatures } from "@/rules";
import type { AttachmentDirection } from "@/rules/attachment";

type Responder = () => LlmFetchResponse | Promise<LlmFetchResponse>;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function buildFixtureReport(): ReportDataV2 {
  const text = readFileSync(
    fileURLToPath(new URL("../../fixtures/whatsapp/android-24h-dmy.txt", import.meta.url)),
    "utf8",
  );
  const parsed = parseWhatsAppTxt(text);
  if (!parsed.ok) throw new Error("fixture failed to parse");
  const map = createSpeakerMap(parsed.chat, { user: "Alex", partner: "Sam" });
  if (map.status !== "confirmed") throw new Error("fixture speaker map failed");
  const conversation = conversationFromChat(parsed.chat, map.map);
  return buildReportV2(buildReportFeatures(conversation), conversation, {
    generatedAt: "2026-03-15T10:00:00.000Z",
  });
}

const REPORT = buildFixtureReport();

function fakeProvider(responses: Responder[], timeoutMs = 500) {
  const calls: FetchCall[] = [];
  const remaining = [...responses];
  const impl: LlmFetch = async (url, init) => {
    calls.push({ url, init });
    const responder = remaining.shift();
    if (responder === undefined) throw new Error(`unexpected fetch call: ${url}`);
    return responder();
  };
  return {
    calls,
    provider: new OpenAiCompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://llm.test/v1",
      model: "gpt-4o-mini",
      timeoutMs,
      fetchImpl: impl,
    }),
  };
}

function chatResponder(content: string): Responder {
  return () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "gpt-4o-mini",
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    }),
  });
}

function errorResponder(status: number): Responder {
  return () => ({ ok: false, status, json: async () => ({ error: "nope" }) });
}

function hangingResponder(): Responder {
  return () => new Promise<LlmFetchResponse>(() => {});
}

function goodOutput(
  report: ReportDataV2,
  overrides: Partial<Record<ChapterId, string>> = {},
  actionWhyOverride?: string[],
): string {
  const chapters: Record<string, string> = {};
  for (const id of REPORT_CHAPTER_IDS) {
    chapters[id] = overrides[id] ?? `Rewritten ${id} summary for this conversation.`;
  }
  const actionWhy = report.chapters[5].actions.map(
    (_action, index) => actionWhyOverride?.[index] ?? `Clearer rationale for day ${index + 1}.`,
  );
  return JSON.stringify({ chapters, actionWhy });
}

function withDirections(
  report: ReportDataV2,
  user: AttachmentDirection,
  partner: AttachmentDirection,
): ReportDataV2 {
  const [glance, attachment, health, turningPoints, evidence, nextSevenDays] = report.chapters;
  const sides = [
    { ...attachment.sides[0], direction: user },
    { ...attachment.sides[1], direction: partner },
  ] as [typeof attachment.sides[0], typeof attachment.sides[1]];
  const chapters: ReportDataV2["chapters"] = [
    { ...glance, attachment: { ...glance.attachment, direction: user } },
    { ...attachment, sides },
    health,
    turningPoints,
    evidence,
    nextSevenDays,
  ];
  return { ...report, chapters };
}

describe("buildNarrativeRequest", () => {
  it("sends structured report facts and the expected JSON shape", () => {
    const request = buildNarrativeRequest(REPORT);
    expect(request.system.length).toBeGreaterThan(100);
    expect(request.prompt).toContain(String(REPORT.headline.score));
    expect(request.prompt).toContain("actionWhy");
    for (const id of REPORT_CHAPTER_IDS) expect(request.prompt).toContain(id);
    expect(request.maxTokens).toBeGreaterThan(0);
    expect(request.temperature).toBeGreaterThan(0);
  });

  it("never includes chat text: extra conversation/features/evidence fields are dropped", () => {
    const quote = REPORT.evidence[0]?.quote ?? "";
    const dirty = {
      ...REPORT,
      conversation: { messages: [{ id: "m1", text: "SECRET_CHAT_TEXT" }] },
      features: { secret: "SECRET_FEATURE" },
      rawConversation: "SECRET_RAW",
      evidence: [
        ...REPORT.evidence,
        { messageId: "m9", quote: "SECRET_EVIDENCE_QUOTE", timestamp: 1, chapterId: "at-a-glance" },
      ],
    } as unknown as ReportDataV2;

    const serialized = JSON.stringify(buildNarrativeRequest(dirty));
    expect(serialized.includes("SECRET_CHAT_TEXT")).toBe(false);
    expect(serialized.includes("SECRET_FEATURE")).toBe(false);
    expect(serialized.includes("SECRET_RAW")).toBe(false);
    expect(serialized.includes("SECRET_EVIDENCE_QUOTE")).toBe(false);
    expect(serialized.includes('"quote"')).toBe(false);
    if (quote.length > 10) expect(serialized.includes(quote)).toBe(false);
  });
});

describe("enhanceNarrative · fallback", () => {
  it("returns the rules report untouched with no provider", async () => {
    const result = await enhanceNarrative(REPORT, { provider: new NullLlmProvider() });
    expect(result.source).toBe("rules");
    expect(result.report).toBe(REPORT);
    expect(result.attempts).toBe(0);
    expect(result.fallbackReason).toBe("no-provider");
  });

  it("retries once on HTTP failures and then falls back", async () => {
    const { provider, calls } = fakeProvider([errorResponder(500), errorResponder(503)]);
    const result = await enhanceNarrative(REPORT, { provider });
    expect(result.source).toBe("rules");
    expect(result.report).toBe(REPORT);
    expect(result.attempts).toBe(NARRATIVE_MAX_ATTEMPTS);
    expect(result.fallbackReason).toBe("provider-error");
    expect(calls).toHaveLength(2);
  });

  it("recovers when the retry succeeds", async () => {
    const { provider, calls } = fakeProvider([errorResponder(500), chatResponder(goodOutput(REPORT))]);
    const result = await enhanceNarrative(REPORT, { provider });
    expect(result.source).toBe("llm");
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("maps timeouts to the timeout reason after one retry", async () => {
    const { provider, calls } = fakeProvider([hangingResponder(), hangingResponder()], 5);
    const result = await enhanceNarrative(REPORT, { provider });
    expect(result.source).toBe("rules");
    expect(result.fallbackReason).toBe("timeout");
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("rejects invalid model output and falls back", async () => {
    const { provider } = fakeProvider([chatResponder("not json at all"), chatResponder("still not json")]);
    const result = await enhanceNarrative(REPORT, { provider });
    expect(result.source).toBe("rules");
    expect(result.report).toBe(REPORT);
    expect(result.fallbackReason).toBe("invalid-output");
  });

  it("rejects banned clinical vocabulary in the generated copy", async () => {
    const bad = goodOutput(REPORT, { "at-a-glance": "This is basically therapy for your texting." });
    const { provider } = fakeProvider([chatResponder(bad), chatResponder(bad)]);
    const result = await enhanceNarrative(REPORT, { provider });
    expect(result.source).toBe("rules");
    expect(result.report).toBe(REPORT);
    expect(result.fallbackReason).toBe("compliance");
    expect(result.violations?.some((violation) => violation.code === "banned-term")).toBe(true);
  });

  it("rejects copy that reverses the rules-layer direction", async () => {
    const forced = withDirections(REPORT, "anxious", "avoidant");
    const bad = goodOutput(forced, {
      "at-a-glance": "You read as secure-leaning, which explains the calm pace.",
    });
    const { provider } = fakeProvider([chatResponder(bad), chatResponder(bad)]);
    const result = await enhanceNarrative(forced, { provider });
    expect(result.source).toBe("rules");
    expect(result.report).toBe(forced);
    expect(result.fallbackReason).toBe("compliance");
    expect(
      result.violations?.some((violation) => violation.code === "direction-conflict"),
    ).toBe(true);
  });
});

describe("enhanceNarrative · success only replaces allowed fields", () => {
  it("rewrites chapter summaries and action rationales immutably", async () => {
    const glanceSummary = "A clearer summary of your shared rhythm and repair.";
    const { provider } = fakeProvider([
      chatResponder(goodOutput(REPORT, { "at-a-glance": glanceSummary }, ["Because balance matters."])),
    ]);
    const result = await enhanceNarrative(REPORT, { provider });

    expect(result.source).toBe("llm");
    expect(result.attempts).toBe(1);
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 40, totalTokens: 140 });
    expect(result.costUsd).toBeGreaterThan(0);

    const enhanced = result.report;
    expect(enhanced).not.toBe(REPORT);
    expect(enhanced.chapters[0].summary).toBe(glanceSummary);
    expect(enhanced.chapters[5].actions[0]?.why).toBe("Because balance matters.");

    // Allowed fields changed; every other field is copied verbatim by reference.
    expect(enhanced.meta).toBe(REPORT.meta);
    expect(enhanced.headline).toBe(REPORT.headline);
    expect(enhanced.evidence).toBe(REPORT.evidence);
    expect(enhanced.disclaimer).toBe(REPORT.disclaimer);
    expect(enhanced.whatWeDontKnow).toBe(REPORT.whatWeDontKnow);
    expect(enhanced.dataQuality).toBe(REPORT.dataQuality);
    expect(enhanced.chapters[1].sides).toBe(REPORT.chapters[1].sides);
    expect(enhanced.chapters[1].dataNotEnough).toBe(REPORT.chapters[1].dataNotEnough);
    expect(enhanced.chapters[2].dimensions).toBe(REPORT.chapters[2].dimensions);
    expect(enhanced.chapters[2].metrics).toBe(REPORT.chapters[2].metrics);
    expect(enhanced.chapters[3].points).toBe(REPORT.chapters[3].points);
    expect(enhanced.chapters[4].quotes).toBe(REPORT.chapters[4].quotes);
    expect(enhanced.chapters[5].focusDimensions).toBe(REPORT.chapters[5].focusDimensions);
    expect(enhanced.chapters[5].actions.map((action) => action.action)).toEqual(
      REPORT.chapters[5].actions.map((action) => action.action),
    );
    expect(enhanced.chapters[5].actions.map((action) => action.day)).toEqual(
      REPORT.chapters[5].actions.map((action) => action.day),
    );
    expect(enhanced.chapters[5].actions.map((action) => action.targetDimension)).toEqual(
      REPORT.chapters[5].actions.map((action) => action.targetDimension),
    );

    // The input report was not mutated.
    expect(REPORT.chapters[0].summary).not.toBe(glanceSummary);
    expect(REPORT.chapters[5].actions[0]?.why).not.toBe("Because balance matters.");
  });
});

describe("parseNarrativeOutput", () => {
  it("accepts fenced JSON", () => {
    const parsed = parseNarrativeOutput("```json\n" + goodOutput(REPORT) + "\n```", REPORT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected parse success");
    expect(Object.keys(parsed.chapters).sort()).toEqual([...REPORT_CHAPTER_IDS].sort());
    expect(parsed.actionWhy).toHaveLength(REPORT.chapters[5].actions.length);
  });

  it("rejects missing chapters, wrong action count and oversized copy", () => {
    const missing = parseNarrativeOutput(
      JSON.stringify({ chapters: { "at-a-glance": "Only one chapter." }, actionWhy: [] }),
      REPORT,
    );
    expect(missing).toEqual({ ok: false, reason: "missing-summary" });

    const wrongCount = parseNarrativeOutput(
      JSON.stringify({
        chapters: Object.fromEntries(REPORT_CHAPTER_IDS.map((id) => [id, `Summary ${id}.`])),
        actionWhy: ["one", "two"],
      }),
      REPORT,
    );
    expect(wrongCount).toEqual({ ok: false, reason: "action-why-count" });

    const longSummary = parseNarrativeOutput(
      goodOutput(REPORT, {
        "at-a-glance": "x".repeat(NARRATIVE_MAX_SUMMARY_CHARS + 1),
      }),
      REPORT,
    );
    expect(longSummary).toEqual({ ok: false, reason: "summary-too-long" });

    const longWhy = parseNarrativeOutput(
      goodOutput(REPORT, {}, ["y".repeat(NARRATIVE_MAX_ACTION_WHY_CHARS + 1)]),
      REPORT,
    );
    expect(longWhy).toEqual({ ok: false, reason: "action-why-too-long" });
  });
});

describe("applyNarrative", () => {
  it("returns a new report object without touching the input", () => {
    const summaries = Object.fromEntries(
      REPORT_CHAPTER_IDS.map((id) => [id, `Summary ${id}.`]),
    ) as Record<ChapterId, string>;
    const whys = REPORT.chapters[5].actions.map((_action, index) => `Why ${index + 1}.`);
    const enhanced = applyNarrative(REPORT, summaries, whys);

    expect(enhanced).not.toBe(REPORT);
    expect(enhanced.chapters[0].summary).toBe("Summary at-a-glance.");
    expect(enhanced.chapters[5].actions[3]?.why).toBe("Why 4.");
    expect(REPORT.chapters[0].summary).not.toBe("Summary at-a-glance.");
    expect(enhanced.evidence).toBe(REPORT.evidence);
  });
});
