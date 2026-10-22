/**
 * LLM narrative layer (W5-3)
 * ==========================
 * The deterministic `buildReportV2` output is the product baseline. This
 * module optionally asks an LLM to **reword** a narrow slice of it and falls
 * back to the baseline on *any* problem (no provider, HTTP error, timeout,
 * invalid JSON, banned vocabulary, direction conflict).
 *
 * Hard boundaries:
 *   - Only `chapter.summary` and `actions[].why` may change. Scores, metrics,
 *     evidence, attachment directions, confidence, actions themselves, meta,
 *     disclaimer — all copied by reference from the rules report.
 *   - The prompt is built from an explicit fact whitelist. Raw conversation,
 *     features and evidence quotes are never sent: evidence is reduced to a
 *     count. A caller passing `{...report, conversation}` cannot leak it.
 *   - Output is strict-validated (shape, lengths) and then passes
 *     `guardNarrative()` (banned clinical terms + English + direction
 *     consistency) before it can replace anything.
 *   - One retry, then silent fallback. Never throws; the page always receives
 *     a renderable `ReportDataV2` plus `source: "rules" | "llm"`.
 */
import type { LlmFetch, LlmProvider, LlmUsage, LlmResponse } from "./llm";
import { LlmTimeoutError, estimateCostUsd, getLlmProvider } from "./llm";
import {
  FORBIDDEN_TERMS,
  guardNarrative,
  readRuleDirections,
  type ComplianceViolation,
} from "./content-guard";
import { REPORT_CHAPTER_IDS } from "./report-contract";
import type { ChapterId, ReportDataV2 } from "./report-contract";

export const NARRATIVE_MAX_SUMMARY_CHARS = 600;
export const NARRATIVE_MAX_ACTION_WHY_CHARS = 240;
export const NARRATIVE_MAX_TOKENS = 1200;
export const NARRATIVE_TEMPERATURE = 0.4;
/** 1 initial attempt + 1 retry. */
export const NARRATIVE_MAX_ATTEMPTS = 2;

export interface NarrativeRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}

export interface EnhanceNarrativeOptions {
  /** Explicit provider (tests); omitted -> `getLlmProvider()` reads env. */
  provider?: LlmProvider | null;
  /** Passed to the factory when no provider is given (injectable for tests). */
  fetchImpl?: LlmFetch;
  /** Defaults to 2 (one retry). Capped at 3. */
  maxAttempts?: number;
}

export type NarrativeFallbackReason =
  | "no-provider"
  | "provider-error"
  | "timeout"
  | "invalid-output"
  | "compliance";

export interface NarrativeResult {
  report: ReportDataV2;
  source: "rules" | "llm";
  model?: string;
  usage?: LlmUsage;
  costUsd?: number;
  attempts: number;
  fallbackReason?: NarrativeFallbackReason;
  /** Populated when `fallbackReason === "compliance"`. */
  violations?: ComplianceViolation[];
}

/* -------------------------------------------------------------------------------------------------
 * Prompt construction (explicit fact whitelist; no raw chat)
 * ------------------------------------------------------------------------------------------------*/

function chapterSummaries(report: ReportDataV2): Record<ChapterId, string> {
  const summaries = {} as Record<ChapterId, string>;
  for (const chapter of report.chapters) summaries[chapter.id] = chapter.summary;
  return summaries;
}

/**
 * Build the structured facts object sent to the model.
 *
 * Whitelist only: sample counts, headline, dimension scores, attachment
 * directions/confidence, turning-point labels, the seven actions, unknowns and
 * the current deterministic summaries. Evidence is reduced to a count (quotes
 * are excerpts of the user's chat and never leave the browser as part of the
 * narrative prompt).
 */
function buildNarrativeFacts(report: ReportDataV2): Record<string, unknown> {
  const [glance, attachment, health, turningPoints, evidence, nextSevenDays] = report.chapters;
  const directions = readRuleDirections(report);
  return {
    sample: {
      messages: report.meta.sample.messages,
      dateRange: report.meta.sample.dateRange,
      durationDays: report.meta.sample.durationDays,
      timestampedMessages: report.meta.sample.timestampedMessages,
    },
    headline: {
      score: report.headline.score,
      grade: report.headline.grade,
      scoreLabel: report.headline.scoreLabel,
      confidence: report.headline.confidence,
      confidenceLabel: report.headline.confidenceLabel,
    },
    dimensions: health.dimensions.map((dimension) => ({
      label: dimension.label,
      score: dimension.score,
      weight: dimension.weight,
      status: dimension.status,
    })),
    attachment: {
      you: {
        direction: glance.attachment.direction,
        label: glance.attachment.label,
        confidence: glance.attachment.confidence,
        note: attachment.sides[0]?.note ?? null,
      },
      partner: {
        direction: attachment.sides[1]?.direction ?? null,
        label: attachment.sides[1]?.label ?? null,
        confidence: attachment.sides[1]?.confidence ?? null,
        note: attachment.sides[1]?.note ?? null,
      },
    },
    /** Evidence quotes deliberately excluded: count only. */
    evidence: { quotedMessages: evidence.evidenceCount },
    turningPoints: turningPoints.points.map((point) => ({
      label: point.label,
      dateLabel: point.dateLabel,
    })),
    actions: nextSevenDays.actions.map((action) => ({
      day: action.day,
      action: action.action,
      why: action.why,
      targetDimension: action.targetDimension,
    })),
    dataNotEnough: report.chapters.map((chapter) => ({
      id: chapter.id,
      dataNotEnough: chapter.dataNotEnough,
    })),
    currentSummaries: chapterSummaries(report),
    whatWeDontKnow: report.whatWeDontKnow,
    rulesDirections: directions,
  };
}

function buildSystemPrompt(): string {
  return [
    "You are the narrative editor for The Tell, a self-reflection tool that describes observable message patterns.",
    "Your job is to rewrite existing report wording more naturally, in plain English, without adding or changing facts.",
    "Hard rules:",
    "- English only. No other languages, no Chinese characters.",
    `- Never use these words or concepts: ${FORBIDDEN_TERMS.join(", ")}.`,
    "- Never present the report as care, treatment, assessment, a service, or a professional opinion.",
    "- Never change scores, numbers, evidence, or attachment directions.",
    "- Keep any 'not enough data' caveat when the facts say dataNotEnough is true.",
    "- Do not quote or invent messages from the chat; the facts contain no chat text.",
    "- Return ONLY a JSON object, no markdown fences, no commentary.",
  ].join("\n");
}

function buildUserPrompt(report: ReportDataV2): string {
  const facts = buildNarrativeFacts(report);
  const outputExample = {
    chapters: {
      "at-a-glance": "2-3 sentences, max 600 characters.",
      attachment: "2-3 sentences, max 600 characters.",
      health: "2-3 sentences, max 600 characters.",
      "turning-points": "2-3 sentences, max 600 characters.",
      "evidence-confidence": "2-3 sentences, max 600 characters.",
      "next-7-days": "2-3 sentences, max 600 characters.",
    },
    actionWhy: report.chapters[5].actions.map((_action, index) => `Rationale for day ${index + 1}.`),
  };
  return [
    "Rewrite the six chapter summaries and the seven action rationales using the facts below.",
    "Keep the same meaning and the same conclusions. Shorter and clearer is better than dramatic.",
    "Directions in the facts are stamped by a rules engine; do not reverse or negate them.",
    "Required JSON shape (all six chapter ids and exactly seven actionWhy strings):",
    JSON.stringify(outputExample),
    "Report facts (JSON):",
    JSON.stringify(facts),
  ].join("\n\n");
}

/** Build the deterministic prompt for a report (pure; no network). */
export function buildNarrativeRequest(report: ReportDataV2): NarrativeRequest {
  return {
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(report),
    maxTokens: NARRATIVE_MAX_TOKENS,
    temperature: NARRATIVE_TEMPERATURE,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Output parsing / validation
 * ------------------------------------------------------------------------------------------------*/

export interface ParsedNarrativeSuccess {
  ok: true;
  chapters: Record<ChapterId, string>;
  actionWhy: string[];
  /** All replaceable strings joined, for the compliance/direction guard. */
  combinedText: string;
}

export interface ParsedNarrativeFailure {
  ok: false;
  reason:
    | "empty"
    | "invalid-json"
    | "missing-chapters"
    | "missing-summary"
    | "summary-too-long"
    | "missing-action-why"
    | "action-why-count"
    | "action-why-too-long";
}

export type ParsedNarrative = ParsedNarrativeSuccess | ParsedNarrativeFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const candidates = [withoutFence, trimmed];
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Strict validation of the model output against the current report shape.
 * Accepts markdown-fenced JSON (models like to add fences), rejects partial
 * output: all six summaries and exactly `actions.length` rationales.
 */
export function parseNarrativeOutput(raw: string, report: ReportDataV2): ParsedNarrative {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  const parsed = extractJson(raw);
  if (!isRecord(parsed)) return { ok: false, reason: "invalid-json" };
  const rawChapters = parsed.chapters;
  if (!isRecord(rawChapters)) return { ok: false, reason: "missing-chapters" };

  const chapters = {} as Record<ChapterId, string>;
  for (const id of REPORT_CHAPTER_IDS) {
    const value = rawChapters[id];
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, reason: "missing-summary" };
    }
    const summary = value.trim();
    if (Array.from(summary).length > NARRATIVE_MAX_SUMMARY_CHARS) {
      return { ok: false, reason: "summary-too-long" };
    }
    chapters[id] = summary;
  }

  const rawActionWhy = parsed.actionWhy;
  if (!Array.isArray(rawActionWhy)) return { ok: false, reason: "missing-action-why" };
  const expectedCount = report.chapters[5].actions.length;
  if (rawActionWhy.length !== expectedCount) {
    return { ok: false, reason: "action-why-count" };
  }
  const actionWhy: string[] = [];
  for (const value of rawActionWhy) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, reason: "missing-action-why" };
    }
    const why = value.trim();
    if (Array.from(why).length > NARRATIVE_MAX_ACTION_WHY_CHARS) {
      return { ok: false, reason: "action-why-too-long" };
    }
    actionWhy.push(why);
  }

  const combinedText = `${REPORT_CHAPTER_IDS.map((id) => chapters[id]).join("\n")}\n${actionWhy.join("\n")}`;
  return { ok: true, chapters, actionWhy, combinedText };
}

/* -------------------------------------------------------------------------------------------------
 * Applying the narrative immutably
 * ------------------------------------------------------------------------------------------------*/

/** Clone only the allowed fields; every other field keeps its original reference. */
export function applyNarrative(
  report: ReportDataV2,
  chapters: Record<ChapterId, string>,
  actionWhy: string[],
): ReportDataV2 {
  const [glance, attachment, health, turningPoints, evidence, nextSevenDays] = report.chapters;
  const actions = nextSevenDays.actions.map((action, index) => ({
    ...action,
    why: actionWhy[index] ?? action.why,
  }));
  const nextReport: ReportDataV2["chapters"] = [
    { ...glance, summary: chapters["at-a-glance"] },
    { ...attachment, summary: chapters.attachment },
    { ...health, summary: chapters.health },
    { ...turningPoints, summary: chapters["turning-points"] },
    { ...evidence, summary: chapters["evidence-confidence"] },
    { ...nextSevenDays, summary: chapters["next-7-days"], actions },
  ];
  return { ...report, chapters: nextReport };
}

/* -------------------------------------------------------------------------------------------------
 * Orchestration
 * ------------------------------------------------------------------------------------------------*/

function mergeUsage(total: LlmUsage | undefined, next: LlmUsage): LlmUsage {
  if (total === undefined) return { ...next };
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  };
}

function usageCost(model: string | undefined, usage: LlmUsage | undefined): number | undefined {
  if (model === undefined || usage === undefined) return undefined;
  return estimateCostUsd(model, usage);
}

/**
 * Ask the LLM to reword the report, or return the rules report unchanged.
 *
 * - No provider / disabled provider -> immediate fallback, zero network.
 * - Provider error/timeout/invalid output/compliance violation -> one retry,
 *   then fallback with `source: "rules"` and a diagnostic `fallbackReason`.
 * - Success -> `source: "llm"` with only chapter summaries + action rationales
 *   replaced (immutably).
 */
export async function enhanceNarrative(
  report: ReportDataV2,
  options: EnhanceNarrativeOptions = {},
): Promise<NarrativeResult> {
  const provider = options.provider ?? getLlmProvider({ fetchImpl: options.fetchImpl });
  if (provider === null || provider === undefined || !provider.isEnabled()) {
    return { report, source: "rules", attempts: 0, fallbackReason: "no-provider" };
  }

  const request = buildNarrativeRequest(report);
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? NARRATIVE_MAX_ATTEMPTS, 3));
  let usage: LlmUsage | undefined;
  let attempts = 0;
  let fallbackReason: NarrativeFallbackReason = "provider-error";
  let violations: ComplianceViolation[] | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    let response: LlmResponse;
    try {
      response = await provider.complete(request);
    } catch (error) {
      fallbackReason = error instanceof LlmTimeoutError ? "timeout" : "provider-error";
      continue;
    }
    usage = mergeUsage(usage, response.usage);

    const parsed = parseNarrativeOutput(response.text, report);
    if (!parsed.ok) {
      fallbackReason = "invalid-output";
      continue;
    }

    const guard = guardNarrative(report, parsed.combinedText);
    if (!guard.ok) {
      fallbackReason = "compliance";
      violations = guard.violations;
      continue;
    }

    const model = response.model || provider.model;
    return {
      report: applyNarrative(report, parsed.chapters, parsed.actionWhy),
      source: "llm",
      model,
      usage,
      costUsd: usageCost(model, usage),
      attempts,
      violations: [],
    };
  }

  return {
    report,
    source: "rules",
    model: provider.model,
    usage,
    costUsd: usageCost(provider.model, usage),
    attempts,
    fallbackReason,
    ...(violations !== undefined ? { violations } : {}),
  };
}
