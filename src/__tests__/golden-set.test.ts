/**
 * Golden set v1 — 10 synthetic conversations as the quality baseline for the
 * deterministic report pipeline (`parse → features → buildReportV2`).
 *
 * What this test pins:
 * - each fixture produces the attachment directions declared in both the file
 *   header (`# expected-direction:`) and the manifest below (drift guard);
 * - the weighted health score stays inside the declared band;
 * - confidence is reported (never invented) and matches the feature layer;
 * - all six chapters are present and non-empty, evidence ids/quotes are real
 *   prefixes of real messages, and no banned clinical vocabulary leaks;
 * - two builds of the same case are byte-identical (deterministic baseline);
 * - the print/PDF stylesheet exists and keeps scores + evidence + chapter
 *   break rules (W5-5 requirement).
 *
 * Fixtures live in `fixtures/golden/*.txt`; they are 100% synthetic (no real
 * conversations, names are placeholders). The per-case notes for reviewers live
 * in `狗头军师/eval/GOLDEN-SET-v1.md` + `eval/GOLDEN-RUBRIC.md`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  conversationFromChat,
  createSpeakerMap,
  parseWhatsAppTxt,
  type Conversation,
} from "@/parser";
import {
  buildReportFeatures,
  type AttachmentDirection,
  type ReportFeatures,
} from "@/rules";
import { buildReportV2 } from "@/lib/report-engine";
import {
  MAX_EVIDENCE_ITEMS,
  MAX_EVIDENCE_QUOTE_CHARS,
  REPORT_CHAPTER_IDS,
  containsCjk,
  type ReportDataV2,
} from "@/lib/report-contract";

const GOLDEN_DIR = fileURLToPath(new URL("../../fixtures/golden/", import.meta.url));
const REPORT_PAGE = fileURLToPath(new URL("../app/report/page.tsx", import.meta.url));
const PRINT_CSS = fileURLToPath(new URL("../app/report/print.css", import.meta.url));

const FORBIDDEN_TERMS = [
  "therapist",
  "therapy",
  "counseling",
  "counselling",
  "diagnosis",
  "diagnose",
  "clinical",
  "mental health",
];

interface GoldenCase {
  file: string;
  label: string;
  userDirections: AttachmentDirection[];
  partnerDirections: AttachmentDirection[];
  scoreRange: [number, number];
  /** true = expected to be treated as a sparse sample by the engine. */
  sparse?: boolean;
  /** Extra case-specific calibration assertions. */
  check?: (built: Built) => void;
}

interface Built {
  source: string;
  conversation: Conversation;
  features: ReportFeatures;
  report: ReportDataV2;
}

/** Manifest is the single review baseline; headers in the fixtures must match. */
const GOLDEN_CASES: GoldenCase[] = [
  {
    file: "g01-healthy-secure.txt",
    label: "healthy / secure-leaning",
    userDirections: ["secure"],
    partnerDirections: ["secure"],
    scoreRange: [85, 100],
    check: ({ features }) => {
      for (const dimension of features.health.dimensions) {
        expect(dimension.score, `dimension ${dimension.id}`).toBeGreaterThanOrEqual(80);
      }
      expect(features.metrics.conflict_repair_freq.details.conflictCount).toBe(0);
      expect(num(features.metrics.conflict_repair_freq.details.repairCount)).toBeGreaterThan(0);
    },
  },
  {
    file: "g02-anxious-chasing.txt",
    label: "anxious shift / chasing",
    userDirections: ["anxious", "mixed"],
    partnerDirections: ["avoidant", "mixed", "secure"],
    scoreRange: [50, 78],
    check: ({ conversation, features }) => {
      const reply = features.metrics.reply_median_latency.details;
      expect(num(reply.userMedianMinutes)).toBeLessThan(num(reply.partnerMedianMinutes) as number);
      expect(conversation.user.messageCount).toBeGreaterThan(conversation.partner.messageCount);
      expect(num(features.metrics.double_text_rate.details.userRate)).toBeGreaterThan(
        num(features.metrics.double_text_rate.details.partnerRate) as number,
      );
      expect(num(features.metrics.question_rate.details.userRate)).toBeGreaterThan(
        num(features.metrics.question_rate.details.partnerRate) as number,
      );
    },
  },
  {
    file: "g03-avoidant-withdrawing.txt",
    label: "avoidant shift / withdrawing",
    userDirections: ["avoidant", "mixed"],
    partnerDirections: ["anxious", "mixed"],
    scoreRange: [45, 72],
    check: ({ conversation, features }) => {
      const reply = features.metrics.reply_median_latency.details;
      expect(num(reply.userMedianMinutes)).toBeGreaterThan(
        num(reply.partnerMedianMinutes) as number,
      );
      expect(conversation.user.messageCount).toBeLessThan(conversation.partner.messageCount);
      expect(num(features.metrics.question_rate.details.userRate)).toBeLessThan(
        num(features.metrics.question_rate.details.partnerRate) as number,
      );
    },
  },
  {
    file: "g04-conflict-repaired.txt",
    label: "conflict present but explicitly repaired",
    userDirections: ["secure", "mixed"],
    partnerDirections: ["secure", "mixed"],
    scoreRange: [65, 88],
    check: ({ features }) => {
      const conflict = features.metrics.conflict_repair_freq;
      const conflictCount = num(conflict.details.conflictCount) as number;
      const repairCount = num(conflict.details.repairCount) as number;
      expect(conflictCount).toBeGreaterThan(0);
      expect(repairCount).toBeGreaterThan(conflictCount);
      expect(num(conflict.details.repairToConflictRatio)).toBeGreaterThanOrEqual(0.6);
      expect(dimensionScore(features, "conflict_repair")).toBeGreaterThanOrEqual(20);
      expect(dimensionScore(features, "conflict_repair")).toBeLessThanOrEqual(60);
    },
  },
  {
    file: "g05-investment-imbalance.txt",
    label: "investment imbalance (one side carries the chat)",
    userDirections: ["anxious", "mixed"],
    partnerDirections: ["avoidant", "mixed"],
    scoreRange: [42, 68],
    check: ({ conversation, features }) => {
      expect(conversation.user.messageCount).toBeGreaterThan(conversation.partner.messageCount * 2);
      const reply = features.metrics.reply_median_latency.details;
      expect(num(reply.userMedianMinutes)).toBeLessThan(num(reply.partnerMedianMinutes) as number);
      const initiation = features.metrics.initiation_ratio.details;
      expect(num(initiation.userSessions)).toBeGreaterThan(num(initiation.partnerSessions) as number);
    },
  },
  {
    file: "g06-late-night.txt",
    label: "late-night cluster",
    userDirections: ["anxious", "mixed"],
    partnerDirections: ["avoidant", "mixed"],
    scoreRange: [55, 82],
    check: ({ features }) => {
      expect(features.metrics.late_night_share.value).toBeGreaterThanOrEqual(0.9);
      const lateCard = features.preview.cards.find((card) => card.id === "late_night");
      expect(lateCard?.value).not.toBeNull();
      expect(lateCard?.value as number).toBeGreaterThan(0);
      expect(features.metrics.reply_median_latency.details.userMedianMinutes).toBeLessThan(
        features.metrics.reply_median_latency.details.partnerMedianMinutes as number,
      );
    },
  },
  {
    file: "g07-short-sample.txt",
    label: "short sample / low confidence",
    userDirections: ["secure", "anxious", "avoidant", "mixed"],
    partnerDirections: ["secure", "anxious", "avoidant", "mixed"],
    scoreRange: [20, 92],
    sparse: true,
    check: ({ features, report }) => {
      expect(report.headline.confidence).toBeLessThan(0.3);
      expect(features.dataQuality.lowSample).toBe(true);
      const notEnough = report.chapters.filter((chapter) => chapter.dataNotEnough);
      expect(notEnough.length).toBeGreaterThanOrEqual(2);
    },
  },
  {
    file: "g08-one-sided.txt",
    label: "one-sided dominance",
    userDirections: ["anxious", "mixed"],
    partnerDirections: ["avoidant", "mixed"],
    scoreRange: [38, 65],
    check: ({ conversation }) => {
      expect(conversation.user.messageCount).toBeGreaterThanOrEqual(
        conversation.partner.messageCount * 3,
      );
    },
  },
  {
    file: "g09-emoji-heavy.txt",
    label: "emoji-heavy warmth",
    userDirections: ["secure", "mixed"],
    partnerDirections: ["secure", "mixed"],
    scoreRange: [85, 100],
    check: ({ features }) => {
      expect(features.metrics.emoji_rate.value).toBeGreaterThanOrEqual(0.9);
      expect(dimensionScore(features, "atmosphere")).toBeGreaterThanOrEqual(90);
    },
  },
  {
    file: "g10-conflict-unrepaired.txt",
    label: "conflict without repair",
    userDirections: ["anxious", "mixed"],
    partnerDirections: ["avoidant", "mixed", "secure"],
    scoreRange: [30, 68],
    check: ({ features }) => {
      const conflict = features.metrics.conflict_repair_freq;
      expect(num(conflict.details.conflictCount)).toBeGreaterThanOrEqual(8);
      expect(num(conflict.details.repairCount)).toBe(0);
      expect(num(conflict.details.repairToConflictRatio)).toBe(0);
      expect(dimensionScore(features, "conflict_repair")).toBeLessThanOrEqual(10);
      expect(features.health.totalScore).toBeLessThan(50);
    },
  },
];

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------------------------------*/

function num(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`expected a finite number, received ${String(value)}`);
}

function dimensionScore(features: ReportFeatures, id: string): number {
  const dimension = features.health.dimensions.find((item) => item.id === id);
  if (dimension === undefined) throw new Error(`missing dimension ${id}`);
  return dimension.score;
}

function fixturePath(file: string): string {
  return `${GOLDEN_DIR}${file}`;
}

function readSource(file: string): string {
  return readFileSync(fixturePath(file), "utf8");
}

function headerMap(source: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    if (!line.startsWith("#")) continue;
    const match = /^#\s*([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (match === null) continue;
    map[(match[1] as string).toLowerCase()] = (match[2] as string).trim();
  }
  return map;
}

function directionsFromHeader(value: string): { user: string[]; partner: string[] } {
  const match = /^user=([a-z|]+)\s+partner=([a-z|]+)$/.exec(value.trim());
  if (match === null) throw new Error(`bad expected-direction header: ${value}`);
  return {
    user: (match[1] as string).split("|"),
    partner: (match[2] as string).split("|"),
  };
}

function rangeFromHeader(value: string): [number, number] {
  const match = /^(\d+)-(\d+)$/.exec(value.trim());
  if (match === null) throw new Error(`bad expected-health-score header: ${value}`);
  return [Number(match[1]), Number(match[2])];
}

function buildCase(goldenCase: GoldenCase, dateOrder = "DMY" as const): Built {
  const source = readSource(goldenCase.file);
  const parsed = parseWhatsAppTxt(source, { dateOrder });
  expect(parsed.ok, `${goldenCase.file}: parse should succeed`).toBe(true);
  expect(parsed.chat.meta.tier).toBe("standard");

  const mapping = createSpeakerMap(parsed.chat, { user: "Alex", partner: "Sam" });
  if (mapping.status !== "confirmed") {
    throw new Error(`${goldenCase.file}: speaker mapping needs confirmation: ${mapping.message}`);
  }
  const conversation = conversationFromChat(parsed.chat, mapping.map);
  const features = buildReportFeatures(conversation);
  const report = buildReportV2(features, conversation);
  return { source, conversation, features, report };
}

function assertCommon(built: Built, goldenCase: GoldenCase): void {
  const { conversation, features, report } = built;

  // --- header + manifest drift guard -------------------------------------------
  const header = headerMap(built.source);
  expect(header.case).toBe(goldenCase.file.replace(/\.txt$/, ""));
  expect(header.synthetic).toContain("true");
  expect(header.platform).toContain("whatsapp");
  expect(header.asserts?.length ?? 0).toBeGreaterThan(0);
  const headerDirections = directionsFromHeader(header["expected-direction"] ?? "");
  expect(headerDirections.user).toEqual(goldenCase.userDirections);
  expect(headerDirections.partner).toEqual(goldenCase.partnerDirections);
  expect(rangeFromHeader(header["expected-health-score"] ?? "")).toEqual(goldenCase.scoreRange);

  // --- speaker lock / sample accounting ---------------------------------------
  expect(conversation.user.messageCount + conversation.partner.messageCount).toBe(
    features.sample.messageCount,
  );
  expect(features.sample.messageCount).toBeGreaterThan(0);

  // --- direction labels --------------------------------------------------------
  expect(goldenCase.userDirections).toContain(features.attachment.user.direction);
  expect(goldenCase.partnerDirections).toContain(features.attachment.partner.direction);
  for (const direction of [
    features.attachment.user.direction,
    features.attachment.partner.direction,
  ]) {
    expect(["anxious", "avoidant", "secure", "mixed"]).toContain(direction);
  }

  // --- health score band + weight integrity ------------------------------------
  expect(features.health.totalScore).toBeGreaterThanOrEqual(goldenCase.scoreRange[0]);
  expect(features.health.totalScore).toBeLessThanOrEqual(goldenCase.scoreRange[1]);
  expect(report.headline.score).toBe(features.health.totalScore);
  expect(report.headline.grade).toBe(features.health.grade);
  expect(features.health.weightsSum).toBe(100);
  expect(features.health.dimensions).toHaveLength(5);

  // --- confidence is copied, bounded, never invented ---------------------------
  expect(report.headline.confidence).toBe(features.dataQuality.confidence);
  expect(report.headline.confidence).toBeGreaterThan(0);
  expect(report.headline.confidence).toBeLessThanOrEqual(1);
  expect(["low", "moderate", "high"]).toContain(report.headline.confidenceLabel);
  expect(report.dataQuality.confidence).toBe(features.dataQuality.confidence);
  expect(report.dataQuality.lowSample).toBe(features.dataQuality.lowSample);

  // --- six chapters, fixed order, non-empty -----------------------------------
  expect(report.chapters).toHaveLength(6);
  expect(report.chapters.map((chapter) => chapter.id)).toEqual([...REPORT_CHAPTER_IDS]);
  for (const chapter of report.chapters) {
    expect(chapter.title.trim().length).toBeGreaterThan(0);
    expect(chapter.summary.trim().length).toBeGreaterThan(0);
  }
  const [glance, attachment, health, , evidenceChapter, plan] = report.chapters;
  expect(glance.dimensions).toHaveLength(5);
  expect(attachment.sides).toHaveLength(2);
  expect(health.dimensions).toHaveLength(5);
  expect(health.metrics).toHaveLength(10);
  expect(evidenceChapter.quotes.length).toBe(report.evidence.length);
  expect(plan.actions.length).toBeGreaterThan(0);
  if (goldenCase.sparse !== true) {
    expect(plan.actions).toHaveLength(7);
    expect(glance.dataNotEnough).toBe(false);
  }

  // --- evidence references real messages, quotes are real prefixes ------------
  const messageById = new Map(conversation.messages.map((message) => [message.id, message]));
  expect(report.evidence.length).toBeLessThanOrEqual(MAX_EVIDENCE_ITEMS);
  for (const item of report.evidence) {
    expect(messageById.has(item.messageId), `unknown evidence id ${item.messageId}`).toBe(true);
    const message = messageById.get(item.messageId);
    expect(message?.text.startsWith(item.quote), `quote is not a prefix for ${item.messageId}`).toBe(
      true,
    );
    expect(Array.from(item.quote).length).toBeLessThanOrEqual(MAX_EVIDENCE_QUOTE_CHARS);
    expect(REPORT_CHAPTER_IDS).toContain(item.chapterId);
  }
  for (const quote of evidenceChapter.quotes) {
    expect(messageById.has(quote.messageId)).toBe(true);
  }
  for (const cited of evidenceChapter.citedMessageIds) {
    expect(messageById.has(cited)).toBe(true);
  }
  expect(evidenceChapter.evidenceCount).toBeGreaterThanOrEqual(0);

  // --- English-only copy, zero banned clinical vocabulary ---------------------
  const serialized = JSON.stringify(report);
  expect(containsCjk(serialized)).toBe(false);
  const lower = serialized.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    expect(lower.includes(term), `${goldenCase.file} must not contain "${term}"`).toBe(false);
  }

  // --- deterministic: two builds are byte-identical ---------------------------
  const rebuilt = buildReportV2(features, conversation);
  expect(JSON.stringify(rebuilt)).toBe(serialized);
  expect(rebuilt.meta.generatedAt).toBe(report.meta.generatedAt);
}

/* -------------------------------------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------------------------------------*/

describe("golden set · inventory", () => {
  it("has exactly 10 synthetic fixtures with unique headers", () => {
    const files = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith(".txt"))
      .sort();
    expect(files).toHaveLength(10);
    expect(files).toEqual(GOLDEN_CASES.map((goldenCase) => goldenCase.file));
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) {
      const header = headerMap(readSource(file));
      expect(header.case, `${file} should declare # case:`).toBe(file.replace(/\.txt$/, ""));
      expect(header["expected-direction"]).toMatch(/^user=[a-z|]+\s+partner=[a-z|]+$/);
      expect(header["expected-health-score"]).toMatch(/^\d+-\d+$/);
    }
  });
});

for (const goldenCase of GOLDEN_CASES) {
  describe(`golden · ${goldenCase.file}`, () => {
    it(`${goldenCase.label}: directions, score band, confidence, six chapters, evidence, banned words`, () => {
      const built = buildCase(goldenCase);
      assertCommon(built, goldenCase);
      goldenCase.check?.(built);
    });
  });
}

describe("golden set · summary table", () => {
  it("prints the 10-row baseline table (file / label / directions / score / confidence)", () => {
    const rows = GOLDEN_CASES.map((goldenCase) => {
      const built = buildCase(goldenCase);
      const { features, report } = built;
      return {
        case: goldenCase.file.replace(/\.txt$/, ""),
        label: goldenCase.label,
        messages: features.sample.messageCount,
        user: `${features.attachment.user.direction} (${features.attachment.user.scores.secure} secure / ${features.attachment.user.scores.anxious} anxious / ${features.attachment.user.scores.avoidant} avoidant)`,
        partner: features.attachment.partner.direction,
        score: report.headline.score,
        grade: report.headline.grade,
        confidence: report.headline.confidence,
        evidence: report.evidence.length,
      };
    });
    console.table(rows);
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(Number.isFinite(Number(row.score))).toBe(true);
      expect(Number.isFinite(Number(row.confidence))).toBe(true);
    }
  });
});

describe("print / PDF stylesheet (W5-5)", () => {
  it("print.css defines A4, hides chrome/actions, prevents chapter breaks and keeps scores/evidence", () => {
    const css = readFileSync(PRINT_CSS, "utf8");
    expect(css).toContain("@media print");
    expect(css).toContain("size: A4");
    expect(css).toContain("break-inside: avoid");
    expect(css).toContain("page-break-inside: avoid");
    expect(css).toContain("break-after: avoid");
    expect(css).toContain("print-color-adjust: exact");
    // hide app chrome + interactive action area
    expect(css).toContain(".top");
    expect(css).toContain("footer");
    expect(css).toContain(".report-actions");
    // score + evidence must remain visible
    for (const selector of [".report-score", ".grade-chip", ".risk-card"]) {
      expect(css).toContain(selector);
    }
    // the stylesheet is actually wired into the report route
    const page = readFileSync(REPORT_PAGE, "utf8");
    expect(page).toContain('import "./print.css"');
    expect(page).toContain("report-print");
  });
});
