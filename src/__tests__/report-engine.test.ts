/**
 * Report engine tests (`report_v2`).
 *
 * The engine is the only place where rule-layer numbers become user-facing
 * English, so these tests pin the promises that matter:
 * - the six ADR-0005 chapters exist and are non-empty;
 * - every score is copied verbatim from `features.health`;
 * - every evidence messageId exists in the conversation, every quote is a real
 *   prefix of a real message and never longer than 200 characters;
 * - two builds of the same input are byte-identical (no clock, no randomness);
 * - banned clinical vocabulary and Chinese characters never leak into output;
 * - empty / low-sample conversations produce explicit "Not enough data" copy
 *   instead of throwing or inventing a confident read.
 *
 * Fixtures are the synthetic WhatsApp exports in `fixtures/whatsapp/`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  conversationFromChat,
  createSpeakerMap,
  parseWhatsAppTxt,
  type Conversation,
  type ConversationMessage,
  type ConversationMeta,
  type SpeakerIdentity,
  type SpeakerRole,
} from "@/parser";
import { buildReportFeatures, type ReportFeatures } from "@/rules";
import { buildReportV2 } from "@/lib/report-engine";
import {
  MAX_EVIDENCE_ITEMS,
  MAX_EVIDENCE_QUOTE_CHARS,
  REPORT_CHAPTER_IDS,
  containsCjk,
  type ReportDataV2,
} from "@/lib/report-contract";

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

interface FixtureCase {
  file: string;
  user: string;
  partner: string;
  dateOrder?: "DMY" | "MDY" | "YMD";
}

const FIXTURES: FixtureCase[] = [
  { file: "android-24h-dmy.txt", user: "Alex", partner: "Sam" },
  { file: "ios-12h-mdy.txt", user: "Riley", partner: "Jordan" },
  { file: "european-dots-crlf.txt", user: "Lena", partner: "Ming", dateOrder: "DMY" },
];

function fixtureText(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/whatsapp/${file}`, import.meta.url)), "utf8");
}

function conversationFromFixture(testCase: FixtureCase): Conversation {
  const parsed = parseWhatsAppTxt(
    fixtureText(testCase.file),
    testCase.dateOrder === undefined ? {} : { dateOrder: testCase.dateOrder },
  );
  expect(parsed.ok).toBe(true);
  const map = createSpeakerMap(parsed.chat, { user: testCase.user, partner: testCase.partner });
  if (map.status !== "confirmed") {
    throw new Error(`fixture ${testCase.file} needs speaker confirmation: ${map.message}`);
  }
  return conversationFromChat(parsed.chat, map.map);
}

interface Built {
  conversation: Conversation;
  features: ReportFeatures;
  report: ReportDataV2;
}

function build(testCase: FixtureCase): Built {
  const conversation = conversationFromFixture(testCase);
  const features = buildReportFeatures(conversation);
  const report = buildReportV2(features, conversation);
  return { conversation, features, report };
}

function serialized(report: ReportDataV2): string {
  return JSON.stringify(report);
}

function expectEnglishOnly(report: ReportDataV2): void {
  const text = serialized(report);
  expect(containsCjk(text)).toBe(false);
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    expect(lower.includes(term), `report must not contain "${term}"`).toBe(false);
  }
}

function messageById(conversation: Conversation, id: string): ConversationMessage | undefined {
  return conversation.messages.find((message) => message.id === id);
}

describe("buildReportV2 · six chapter contract", () => {
  it("renders all six chapters with non-empty content for a real fixture", () => {
    const { features, report } = build(FIXTURES[0] as FixtureCase);

    expect(report.meta.schemaVersion).toBe("report_v2");
    expect(report.meta.weightsVersion).toBe(features.versions.weights);
    expect(report.meta.metricsVersion).toBe(features.versions.metrics);
    expect(report.meta.attachmentRuleVersion).toBe(features.versions.attachmentRule);
    expect(report.meta.sample.messages).toBe(features.sample.messageCount);
    expect(report.meta.sample.dateRange).toBe(features.sample.dateRangeLabel);
    expect(report.meta.sample.durationDays).toBe(features.sample.durationDays);
    expect(report.meta.sample.timestampedMessages).toBe(features.sample.timestampedCount);
    expect(report.meta.generatedAt.length).toBeGreaterThan(0);

    expect(report.chapters).toHaveLength(6);
    expect(report.chapters.map((chapter) => chapter.id)).toEqual([...REPORT_CHAPTER_IDS]);
    expect(report.chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const chapter of report.chapters) {
      expect(chapter.title.length).toBeGreaterThan(0);
      expect(chapter.summary.length).toBeGreaterThan(0);
    }

    const glance = report.chapters[0];
    expect(glance.dimensions).toHaveLength(5);
    expect(glance.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0)).toBe(100);
    expect(glance.attachment.label.length).toBeGreaterThan(0);

    const attachment = report.chapters[1];
    expect(attachment.sides).toHaveLength(2);
    expect(attachment.sides[0]?.heading).toBe("You");
    expect(attachment.sides[1]?.heading).toBe("Your partner");
    expect(attachment.sides[0]?.topSignals.length).toBeGreaterThan(0);

    const health = report.chapters[2];
    expect(health.dimensions).toHaveLength(5);
    expect(health.metrics).toHaveLength(10);

    const next = report.chapters[5];
    expect(next.actions).toHaveLength(7);
    expect(next.actions.map((action) => action.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(next.actions.map((action) => action.action)).size).toBe(7);
    for (const action of next.actions) {
      expect(action.action.length).toBeGreaterThan(0);
      expect(action.why.length).toBeGreaterThan(0);
      expect(action.dayLabel).toBe(`Day ${action.day}`);
    }

    expect(report.disclaimer.length).toBeGreaterThan(0);
    expect(report.whatWeDontKnow.length).toBeGreaterThan(0);
    expect(report.dataQuality.confidence).toBe(features.dataQuality.confidence);
  });

  it("copies the score, grade and label directly from features.health", () => {
    for (const testCase of FIXTURES) {
      const { features, report } = build(testCase);
      expect(report.headline.score).toBe(features.health.totalScore);
      expect(report.headline.grade).toBe(features.health.grade);
      expect(report.headline.scoreLabel).toBe(features.health.scoreLabel);
      expect(report.headline.oneLineSummary.length).toBeGreaterThan(0);
      expect(report.chapters[0].dimensions.map((dimension) => dimension.score)).toEqual(
        features.health.dimensions.map((dimension) => dimension.score),
      );
    }
  });
});

describe("buildReportV2 · evidence integrity", () => {
  it("only cites real messages with real, bounded quotes", () => {
    for (const testCase of FIXTURES) {
      const { conversation, report } = build(testCase);
      const realIds = new Set(conversation.messages.map((message) => message.id));

      expect(report.evidence.length).toBeLessThanOrEqual(MAX_EVIDENCE_ITEMS);
      for (const item of report.evidence) {
        expect(realIds.has(item.messageId), `${item.messageId} must exist`).toBe(true);
        expect(REPORT_CHAPTER_IDS).toContain(item.chapterId);
        expect(Array.from(item.quote).length).toBeLessThanOrEqual(MAX_EVIDENCE_QUOTE_CHARS);
        const message = messageById(conversation, item.messageId);
        expect(message).toBeDefined();
        expect(message?.text.startsWith(item.quote)).toBe(true);
        expect(item.timestamp).toBe(message?.timestamp ?? null);
      }

      const evidenceChapter = report.chapters[4];
      expect(evidenceChapter.evidenceCount).toBe(report.evidence.length);
      expect(evidenceChapter.citedMessageIds).toEqual(report.evidence.map((item) => item.messageId));
      expect(evidenceChapter.quotes).toHaveLength(report.evidence.length);
      expect(evidenceChapter.whatWeDontKnow).toEqual(report.whatWeDontKnow);
      for (const quote of evidenceChapter.quotes) {
        expect(realIds.has(quote.messageId)).toBe(true);
      }
    }
  });

  it("has at least one piece of evidence for the long fixture", () => {
    const { report } = build(FIXTURES[0] as FixtureCase);
    expect(report.evidence.length).toBeGreaterThan(0);
    expect(report.chapters[4].dataNotEnough).toBe(false);
  });
});

describe("buildReportV2 · determinism", () => {
  it("is byte-identical across two builds of the same input", () => {
    for (const testCase of FIXTURES) {
      const { conversation, features } = build(testCase);
      const first = buildReportV2(features, conversation);
      const second = buildReportV2(features, conversation);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.meta.generatedAt).toBe(second.meta.generatedAt);
    }
  });

  it("uses the injected generatedAt instead of reading the clock", () => {
    const { conversation, features } = build(FIXTURES[0] as FixtureCase);
    const report = buildReportV2(features, conversation, { generatedAt: "2026-03-15T10:00:00.000Z" });
    expect(report.meta.generatedAt).toBe("2026-03-15T10:00:00.000Z");
  });
});

describe("buildReportV2 · copy discipline", () => {
  it("contains no banned clinical vocabulary and no Chinese characters", () => {
    for (const testCase of FIXTURES) {
      const { report } = build(testCase);
      expectEnglishOnly(report);
    }
  });
});

describe("buildReportV2 · low and empty samples", () => {
  const LOW_SAMPLE_TEXT = [
    "[01/03/2026, 09:12:03] Alex: Morning! Did you sleep okay?",
    "[01/03/2026, 09:20:41] Sam: Better than yesterday",
    "[01/03/2026, 10:05:00] Alex: Coffee later?",
    "[01/03/2026, 10:20:15] Sam: Yes please.",
  ].join("\n");

  function lowSampleConversation(): Conversation {
    const parsed = parseWhatsAppTxt(LOW_SAMPLE_TEXT);
    expect(parsed.ok).toBe(true);
    const map = createSpeakerMap(parsed.chat, { user: "Alex", partner: "Sam" });
    if (map.status !== "confirmed") throw new Error("low-sample fixture needs mapping");
    return conversationFromChat(parsed.chat, map.map);
  }

  function emptyConversation(): Conversation {
    const identity = (role: SpeakerRole): SpeakerIdentity => ({
      role,
      id: role,
      names: [],
      messageCount: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      anchorMessageId: null,
    });
    const meta: ConversationMeta = {
      platform: "whatsapp",
      messageCount: 0,
      systemCount: 0,
      timestampedCount: 0,
      timestampCoverage: 0,
      startedAt: null,
      endedAt: null,
      durationDays: 0,
      dateOrder: "unknown",
      needsDateConfirmation: false,
      timestampBasis: "wall-clock-utc",
      speakerMapConfirmed: true,
    };
    return {
      platform: "whatsapp",
      user: identity("user"),
      partner: identity("partner"),
      messages: [],
      systemMessages: [],
      meta,
      issues: [],
    };
  }

  it("says 'Not enough data' for a low-sample conversation without crashing", () => {
    const conversation = lowSampleConversation();
    const features = buildReportFeatures(conversation);
    const report = buildReportV2(features, conversation);
    const text = serialized(report).toLowerCase();

    expect(report.chapters).toHaveLength(6);
    expect(text).toContain("not enough data");
    expect(report.chapters[3].dataNotEnough).toBe(true);
    expect(report.chapters[5].actions).toHaveLength(7);
    expectEnglishOnly(report);
  });

  it("says 'Not enough data' for an empty conversation without crashing", () => {
    const conversation = emptyConversation();
    const features = buildReportFeatures(conversation);
    const report = buildReportV2(features, conversation);
    const text = serialized(report).toLowerCase();

    expect(report.chapters).toHaveLength(6);
    expect(report.headline.score).toBe(features.health.totalScore);
    expect(report.evidence).toHaveLength(0);
    expect(report.chapters[4].dataNotEnough).toBe(true);
    expect(report.whatWeDontKnow.length).toBeGreaterThan(0);
    expect(text).toContain("not enough data");
    expect(report.chapters[5].actions).toHaveLength(7);
    expectEnglishOnly(report);
  });
});

describe("buildReportV2 · 7-day plan is data-driven", () => {
  function syntheticImbalancedConversation(): Conversation {
    const messages: ConversationMessage[] = [];
    const base = Date.UTC(2026, 0, 1, 18, 0, 0);
    let index = 0;
    const push = (timestamp: number, role: SpeakerRole, text: string) => {
      index += 1;
      messages.push({
        id: `m${index}`,
        timestamp,
        role,
        senderId: role === "user" ? "s1" : "s2",
        senderName: role === "user" ? "Alex" : "Sam",
        text,
        kind: "text",
      });
    };
    for (let day = 0; day < 10; day += 1) {
      const start = base + day * 86_400_000;
      push(start, "user", "Hey, how was your day? I want to hear about mine too");
      push(start + 5 * 60_000, "partner", "Good");
      push(start + 10 * 60_000, "user", "Work was long and I have a lot to say about the meeting today");
      push(start + 12 * 60_000, "user", "Anyway, did you eat?");
    }
    const userMessages = messages.filter((message) => message.role === "user");
    const partnerMessages = messages.filter((message) => message.role === "partner");
    const first = messages[0] as ConversationMessage;
    const last = messages[messages.length - 1] as ConversationMessage;
    const identity = (
      role: SpeakerRole,
      names: string[],
      count: number,
    ): SpeakerIdentity => ({
      role,
      id: role,
      names,
      messageCount: count,
      firstTimestamp: first.timestamp,
      lastTimestamp: last.timestamp,
      anchorMessageId: first.id,
    });
    const meta: ConversationMeta = {
      platform: "whatsapp",
      messageCount: messages.length,
      systemCount: 0,
      timestampedCount: messages.length,
      timestampCoverage: 1,
      startedAt: first.timestamp,
      endedAt: last.timestamp,
      durationDays: 9,
      dateOrder: "DMY",
      needsDateConfirmation: false,
      timestampBasis: "wall-clock-utc",
      speakerMapConfirmed: true,
    };
    return {
      platform: "whatsapp",
      user: identity("user", ["Alex"], userMessages.length),
      partner: identity("partner", ["Sam"], partnerMessages.length),
      messages,
      systemMessages: [],
      meta,
      issues: [],
    };
  }

  it("targets the weak dimension of an imbalanced conversation instead of a fixed template", () => {
    const conversation = syntheticImbalancedConversation();
    const features = buildReportFeatures(conversation);
    const report = buildReportV2(features, conversation);
    const next = report.chapters[5];

    expect(next.actions).toHaveLength(7);
    expect(next.focusDimensions).toContain("reciprocity");
    expect(next.actions.some((action) => action.targetDimension === "reciprocity")).toBe(true);
    expect(next.actions.map((action) => action.action).join(" ")).toContain(
      "Let them start the next conversation",
    );
    expect(next.actions.some((action) => action.why.includes("/100"))).toBe(true);
    expect(next.dataNotEnough).toBe(false);
  });
});
