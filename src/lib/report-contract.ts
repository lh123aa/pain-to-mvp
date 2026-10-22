/**
 * Report contract v2 (`report_v2`) - the data contract between the deterministic
 * report engine (`buildReportV2`) and the `/report` page.
 *
 * Why a v2 contract:
 * - v1 (`lib/demo-report.ts`) is a synthesized placeholder: flat fields, no
 *   provenance, no way to say "we don't know". ADR-0005 asks for a
 *   checkup-style report: score + chapters + evidence + explicit unknowns.
 * - The report is built **entirely in the browser** from locally stored
 *   features (`tell:features:v1`); the raw conversation never leaves the
 *   device, so the page needs a serializable, versioned payload that can be
 *   rendered straight from sessionStorage.
 *
 * Copy discipline for this module:
 * - All user-facing strings are English (product faces US/EU users).
 * - No clinical / therapy vocabulary anywhere (see the regression test
 *   `report-contract.test.ts` for the exact forbidden terms).
 * - The disclaimer lives here so every renderer uses the same wording.
 *
 * This file is types + constants + a defensive validator only. It has no
 * side effects, no DOM access and no `Date.now()` - building the actual
 * report is `lib/report-engine.ts`.
 */
import type { Conversation } from "../parser/types";
import type { AttachmentDirection, AttachmentScores } from "../rules/attachment";
import type { DimensionId, ReportFeatures } from "../rules/health";
import type { MetricId, MetricUnit, UnavailableReason } from "../rules/metrics";

/** Contract version of the report payload itself. */
export const REPORT_SCHEMA_VERSION = "report_v2" as const;

/**
 * sessionStorage key written by `/analyze` (task W2-1b, `lib/client-session.ts`)
 * and read by `/report`. Do not rename: the analysis and the report share it.
 */
export const REPORT_STORAGE_KEY = "tell:features:v1" as const;

/** Version inside the `tell:features:v1` envelope. */
export const REPORT_STORAGE_SCHEMA_VERSION = 1 as const;

/** Evidence quotes may never exceed this many Unicode code points. */
export const MAX_EVIDENCE_QUOTE_CHARS = 200;

/** Upper bound of quoted messages in a report (counted across all chapters). */
export const MAX_EVIDENCE_ITEMS = 12;

/**
 * Product-level disclaimer, rendered at the bottom of the report. Kept short,
 * honest and free of clinical vocabulary.
 */
export const REPORT_DISCLAIMER =
  "The Tell describes observable message patterns in the conversation you uploaded. " +
  "It does not measure feelings, intentions, or anyone's inner state, and it is not a " +
  "substitute for professional advice or care. Use it as a mirror, not a verdict.";

/** Used when the engine cannot derive anything more specific. */
export const FALLBACK_WHAT_WE_DONT_KNOW: readonly string[] = [
  "We cannot know what either of you was feeling - only what the messages show.",
  "We do not see conversations outside this export, or anything said offline.",
  "Tone is inferred from words, punctuation and timing; sarcasm and inside jokes can read wrong.",
];

/** Chapter ids, in reading order. */
export const REPORT_CHAPTER_IDS = [
  "at-a-glance",
  "attachment",
  "health",
  "turning-points",
  "evidence-confidence",
  "next-7-days",
] as const;

export type ChapterId = (typeof REPORT_CHAPTER_IDS)[number];

export type ConfidenceLabel = "low" | "moderate" | "high";

export type DimensionStatus = "strength" | "steady" | "needs-attention";

export type ActionSource = "risk" | "weakness" | "maintenance" | "low-sample";

export interface ReportSample {
  /** Non-system messages in the analyzed conversation. */
  messages: number;
  /** Human-readable wall-clock date range, e.g. "Mar 1 - Mar 14, 2026". */
  dateRange: string;
  /** Span in days (0 when there are no timestamps). */
  durationDays: number;
  /** Messages that carry a timestamp. */
  timestampedMessages: number;
}

export interface ReportMeta {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  /** Weight table version used for the five dimensions (e.g. "weights_v1"). */
  weightsVersion: string;
  /** Metric definitions version (e.g. "metrics_v1"). */
  metricsVersion: string;
  /** Attachment rule version (e.g. "attachment_v1"). */
  attachmentRuleVersion: string;
  /**
   * ISO timestamp, injected by the caller. The engine never reads the clock:
   * when nothing is injected it derives this from the conversation's last
   * timestamp so repeated builds stay byte-identical.
   */
  generatedAt: string;
  sample: ReportSample;
}

export interface ReportHeadline {
  /** 0-100, copied verbatim from `features.health.totalScore`. */
  score: number;
  grade: "A" | "B" | "C";
  scoreLabel: string;
  /** One sentence that works on its own (email, share card, print header). */
  oneLineSummary: string;
  /** Overall data confidence 0..1 (copied from `features.dataQuality.confidence`). */
  confidence: number;
  confidenceLabel: ConfidenceLabel;
}

export interface GlanceDimension {
  id: DimensionId;
  label: string;
  score: number;
  weight: number;
  confidence: number;
}

export interface AttachmentGlance {
  direction: AttachmentDirection;
  label: string;
  confidence: number;
}

/** Chapter 1 - the whole report in one screen. */
export interface AtAGlanceChapter {
  id: "at-a-glance";
  number: 1;
  title: string;
  summary: string;
  /** Five weighted health dimensions. */
  dimensions: GlanceDimension[];
  /** The sixth lens: the user's attachment direction. */
  attachment: AttachmentGlance;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  dataNotEnough: boolean;
}

export interface AttachmentSignalView {
  id: string;
  label: string;
  direction: AttachmentDirection;
  /** 0..1 normalized strength of this signal. */
  strength: number;
  /** Weighted contribution to the direction score (0..25). */
  contribution: number;
  /** Plain-English description of what the signal measured. */
  explain: string;
  /** Real message ids backing this signal (may be empty for summary signals). */
  evidenceIds: string[];
}

export interface AttachmentSideView {
  role: "user" | "partner";
  /** Display heading, e.g. "You" or "Your partner". */
  heading: string;
  direction: AttachmentDirection;
  label: string;
  confidence: number;
  scores: AttachmentScores;
  topSignals: AttachmentSignalView[];
  /** Caveats specific to this side (low confidence, one-sided chat, ...). */
  note: string;
}

/** Chapter 2 - both sides' behavioral direction, with signals. */
export interface AttachmentChapter {
  id: "attachment";
  number: 2;
  title: string;
  summary: string;
  sides: [AttachmentSideView, AttachmentSideView];
  dataNotEnough: boolean;
}

export interface DimensionReading {
  id: DimensionId;
  label: string;
  score: number;
  weight: number;
  confidence: number;
  status: DimensionStatus;
  /** One or two sentences explaining what the score means in this conversation. */
  reading: string;
  metricIds: MetricId[];
}

export interface MetricReading {
  id: MetricId;
  label: string;
  value: number | null;
  unit: MetricUnit;
  /** Pre-formatted value for display ("Not measured" when null). */
  displayValue: string;
  confidence: number;
  sampleSize: number;
  /** Plain-English interpretation of the number, or why it is missing. */
  reading: string;
  unavailableReason: UnavailableReason | null;
  proxy: boolean;
}

/** Chapter 3 - the five dimensions plus all ten metric readings. */
export interface CommunicationHealthChapter {
  id: "health";
  number: 3;
  title: string;
  summary: string;
  dimensions: DimensionReading[];
  metrics: MetricReading[];
  dataNotEnough: boolean;
}

export interface TurningPoint {
  id: string;
  label: string;
  detail: string;
  timestamp: number | null;
  /** Wall-clock formatted date ("Mar 5" / "timestamps unavailable"). */
  dateLabel: string;
  /** Real message ids that anchor the point. */
  evidenceIds: string[];
}

/** Chapter 4 - moments the timeline itself supports. */
export interface TurningPointsChapter {
  id: "turning-points";
  number: 4;
  title: string;
  summary: string;
  points: TurningPoint[];
  dataNotEnough: boolean;
}

export interface ReportEvidence {
  messageId: string;
  /** Prefix of the real message text, at most `MAX_EVIDENCE_QUOTE_CHARS` code points. */
  quote: string;
  timestamp: number | null;
  /** Which chapter this quote supports. */
  chapterId: ChapterId;
}

export interface EvidenceQuote {
  messageId: string;
  quote: string;
  dateLabel: string;
  chapterId: ChapterId;
}

/** Chapter 5 - what the report stands on and what it cannot see. */
export interface EvidenceConfidenceChapter {
  id: "evidence-confidence";
  number: 5;
  title: string;
  summary: string;
  evidenceCount: number;
  citedMessageIds: string[];
  quotes: EvidenceQuote[];
  whatWeDontKnow: string[];
  limitations: string[];
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  dataNotEnough: boolean;
}

export interface ActionItem {
  /** 1..7; rendered as "Day 1" ... "Day 7". */
  day: number;
  dayLabel: string;
  action: string;
  /** Why this action was chosen for this conversation. */
  why: string;
  targetDimension: DimensionId | null;
  source: ActionSource;
}

/** Chapter 6 - seven concrete actions, selected from the weakest signals. */
export interface NextSevenDaysChapter {
  id: "next-7-days";
  number: 6;
  title: string;
  summary: string;
  focusDimensions: DimensionId[];
  actions: ActionItem[];
  dataNotEnough: boolean;
}

export type ReportChapter =
  | AtAGlanceChapter
  | AttachmentChapter
  | CommunicationHealthChapter
  | TurningPointsChapter
  | EvidenceConfidenceChapter
  | NextSevenDaysChapter;

export interface ReportDataQuality {
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  lowSample: boolean;
  timestampCoverage: number;
  needsDateConfirmation: boolean;
  /** Parser warnings, already user-facing English. */
  warnings: string[];
}

/**
 * The complete report. Six chapters in fixed reading order; `evidence` is the
 * flat, renderable list referenced by chapters 2/3/4/5.
 */
export interface ReportDataV2 {
  meta: ReportMeta;
  headline: ReportHeadline;
  chapters: [
    AtAGlanceChapter,
    AttachmentChapter,
    CommunicationHealthChapter,
    TurningPointsChapter,
    EvidenceConfidenceChapter,
    NextSevenDaysChapter,
  ];
  evidence: ReportEvidence[];
  disclaimer: string;
  whatWeDontKnow: string[];
  dataQuality: ReportDataQuality;
}

/* -------------------------------------------------------------------------------------------------
 * sessionStorage envelope written by /analyze (read by /report)
 * ------------------------------------------------------------------------------------------------*/

export interface StoredReportInput {
  schemaVersion: typeof REPORT_STORAGE_SCHEMA_VERSION;
  features: ReportFeatures;
  conversation: Conversation;
  speakers: { user: string; partner: string };
  fileName: string;
  /** ISO timestamp recorded when the analysis finished (stable generatedAt source). */
  createdAt: string;
}

const CJK_TEST = /[\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u31c0-\u31ef\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/u;

/** True when a string contains CJK characters. Report copy must stay English. */
export function containsCjk(value: string): boolean {
  return CJK_TEST.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Defensive shape check for the `tell:features:v1` envelope.
 *
 * It is deliberately shallow: the heavy validation already happened in
 * `/analyze` (parse + speaker lock + feature build). Here we only reject
 * payloads that cannot be rendered (wrong version, missing conversation,
 * missing features) so a corrupted sessionStorage entry degrades to the
 * fallback path instead of crashing the report.
 */
export function isStoredReportInput(value: unknown): value is StoredReportInput {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== REPORT_STORAGE_SCHEMA_VERSION) return false;
  if (typeof value.fileName !== "string") return false;
  if (typeof value.createdAt !== "string") return false;

  const speakers = value.speakers;
  if (!isRecord(speakers) || typeof speakers.user !== "string" || typeof speakers.partner !== "string") {
    return false;
  }

  const features = value.features;
  if (!isRecord(features) || features.schemaVersion !== "features_v1") return false;
  if (!isRecord(features.health) || !Array.isArray(features.health.dimensions)) return false;
  if (!isRecord(features.attachment) || !isRecord(features.metrics) || !isRecord(features.sample)) {
    return false;
  }

  const conversation = value.conversation;
  if (!isRecord(conversation)) return false;
  if (!Array.isArray(conversation.messages)) return false;
  if (!isRecord(conversation.meta)) return false;
  if (!isRecord(conversation.user) || !isRecord(conversation.partner)) return false;

  return true;
}
