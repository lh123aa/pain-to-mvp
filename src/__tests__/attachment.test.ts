/**
 * 依恋方向 + 五维健康度 + 免费预览 + ReportFeatures 测试
 * （M1 · FR-3 依恋预览 / AC-3.2 规则单源 / §5.3 权重表 v1 / AC-4.1）
 *
 * 事实层纪律：方向只由确定性规则决定；每条信号带真实 message id 证据；
 * 证据 id 必须存在于会话中（防止报告层引用不存在的"证据"）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Conversation, ConversationMessage, MessageKind, SpeakerRole } from "@/parser";
import { conversationFromChat, createSpeakerMap, parsePastedText, parseWhatsAppTxt } from "@/parser";
import {
  ATTACHMENT_LABELS,
  DIMENSION_ORDER,
  WEIGHTS_V1,
  assessAttachment,
  buildFreePreview,
  buildHealth,
  buildReportFeatures,
  classifyDirection,
  computeMetrics,
  formatDateRange,
  gradeFromScore,
} from "@/rules";

function fixture(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${relativePath}`, import.meta.url)), "utf8");
}

type Entry = { role: SpeakerRole; at: number | null; text: string; kind?: MessageKind };

function at(year: number, month: number, day: number, hour = 12, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function plus(base: number, minutes: number): number {
  return base + minutes * 60_000;
}

function makeConversation(entries: Entry[], platform: Conversation["platform"] = "whatsapp"): Conversation {
  const messages: ConversationMessage[] = entries.map((entry, index) => {
    const kind = entry.kind ?? "text";
    return {
      id: `m${index + 1}`,
      timestamp: entry.at,
      senderId: entry.role === "user" ? "s1" : "s2",
      senderName: entry.role === "user" ? "Me" : "Partner",
      text: entry.text,
      isSystem: false,
      kind,
      hasMedia: kind === "media",
      role: entry.role,
    };
  });
  const timed = messages.filter(
    (message): message is ConversationMessage & { timestamp: number } => message.timestamp !== null,
  );
  const startedAt = timed.length > 0 ? Math.min(...timed.map((m) => m.timestamp)) : null;
  const endedAt = timed.length > 0 ? Math.max(...timed.map((m) => m.timestamp)) : null;

  const identity = (role: SpeakerRole) => {
    const own = messages.filter((m) => m.role === role);
    const ownTimed = own.filter(
      (m): m is ConversationMessage & { timestamp: number } => m.timestamp !== null,
    );
    return {
      role,
      id: role,
      names: [role === "user" ? "Me" : "Partner"],
      messageCount: own.length,
      firstTimestamp: ownTimed.length > 0 ? Math.min(...ownTimed.map((m) => m.timestamp)) : null,
      lastTimestamp: ownTimed.length > 0 ? Math.max(...ownTimed.map((m) => m.timestamp)) : null,
      anchorMessageId: own[1]?.id ?? own[0]?.id ?? null,
    };
  };

  return {
    platform,
    user: identity("user"),
    partner: identity("partner"),
    messages,
    systemMessages: [],
    meta: {
      platform,
      messageCount: messages.length,
      systemCount: 0,
      timestampedCount: timed.length,
      timestampCoverage: messages.length === 0 ? 0 : timed.length / messages.length,
      startedAt,
      endedAt,
      durationDays:
        startedAt !== null && endedAt !== null
          ? Math.round(((endedAt - startedAt) / 86_400_000) * 100) / 100
          : 0,
      dateOrder: "DMY",
      needsDateConfirmation: false,
      timestampBasis: "wall-clock-utc",
      speakerMapConfirmed: true,
    },
    issues: [],
  };
}

function fixtureConversation(file: string, user: string, partner: string): Conversation {
  const parsed = parseWhatsAppTxt(fixture(file));
  const mapped = createSpeakerMap(parsed.chat, { user, partner });
  if (mapped.status !== "confirmed") throw new Error(`speaker map not confirmed: ${mapped.code}`);
  return conversationFromChat(parsed.chat, mapped.map);
}

function messageIds(conversation: Conversation): Set<string> {
  return new Set(conversation.messages.map((message) => message.id));
}

/** 焦虑型用户 + 回避型对方（行为信号刻意拉满，用于规则方向可解释性） */
function anxiousAvoidantConversation(): Conversation {
  const day1 = at(2026, 3, 1, 22, 0);
  const day2 = at(2026, 3, 2, 23, 30);
  const day3 = at(2026, 3, 3, 22, 40);
  return makeConversation([
    { role: "user", at: day1, text: "Are you okay? I feel like something's off 😅" },
    { role: "partner", at: plus(day1, 60), text: "yeah fine" },
    { role: "user", at: plus(day1, 61), text: "You sure? You seem distant" },
    { role: "user", at: plus(day1, 62), text: "I can call if you want" },
    { role: "partner", at: plus(day1, 90), text: "not now" },
    { role: "user", at: plus(day1, 91), text: "ok" },
    { role: "user", at: day2, text: "still thinking about last night" },
    { role: "user", at: plus(day2, 1), text: "did I do something?" },
    { role: "partner", at: plus(day2, 50), text: "no, just tired" },
    { role: "user", at: plus(day2, 51), text: "ok good night 😅" },
    { role: "user", at: day3, text: "you free tomorrow?" },
    { role: "partner", at: plus(day3, 60), text: "maybe" },
    { role: "user", at: plus(day3, 61), text: "I'll take that as a yes" },
    { role: "user", at: plus(day3, 62), text: "I miss you" },
  ]);
}

/** 安全型：节奏对称、发起平衡、有修复语言 */
function secureConversation(): Conversation {
  const day1 = at(2026, 3, 1, 12, 0);
  const day2 = at(2026, 3, 2, 12, 0);
  return makeConversation([
    { role: "user", at: day1, text: "hello there" },
    { role: "partner", at: plus(day1, 5), text: "sorry, good to see you" },
    { role: "user", at: plus(day1, 10), text: "how was your day?" },
    { role: "partner", at: plus(day1, 15), text: "pretty good thanks" },
    { role: "partner", at: day2, text: "morning!" },
    { role: "user", at: plus(day2, 5), text: "sorry, morning to you" },
    { role: "partner", at: plus(day2, 10), text: "sleep well?" },
    { role: "user", at: plus(day2, 15), text: "yes I did, thanks" },
  ]);
}

describe("attachment · contract and evidence discipline", () => {
  it("produces both sides, bounded scores, labels and real evidence ids", () => {
    const conversation = fixtureConversation("whatsapp/android-24h-dmy.txt", "Sam", "Alex");
    const report = assessAttachment(conversation);
    const ids = messageIds(conversation);
    expect(report.ruleVersion).toBe("attachment_v1");

    for (const assessment of [report.user, report.partner]) {
      expect(["anxious", "avoidant", "secure", "mixed"]).toContain(assessment.direction);
      expect(ATTACHMENT_LABELS[assessment.direction].length).toBeGreaterThan(0);
      expect(assessment.label).toBe(ATTACHMENT_LABELS[assessment.direction]);
      expect(assessment.sampleSize).toBe(conversation.meta.messageCount);
      expect(assessment.confidence).toBeGreaterThanOrEqual(0);
      expect(assessment.confidence).toBeLessThanOrEqual(1);
      for (const key of ["anxious", "avoidant", "secure"] as const) {
        expect(assessment.scores[key]).toBeGreaterThanOrEqual(0);
        expect(assessment.scores[key]).toBeLessThanOrEqual(100);
      }
      expect(assessment.signals.length).toBeGreaterThanOrEqual(15);
      for (const signal of assessment.signals) {
        expect(signal.explain.length).toBeGreaterThan(0);
        expect(signal.id.length).toBeGreaterThan(0);
        expect(signal.messageIds.length).toBeLessThanOrEqual(3);
        for (const id of signal.messageIds) expect(ids.has(id)).toBe(true);
      }
      expect(assessment.signals.some((signal) => signal.messageIds.length > 0)).toBe(true);
    }
  });

  it("is deterministic (same input → identical JSON)", () => {
    const conversation = fixtureConversation("whatsapp/android-24h-dmy.txt", "Alex", "Sam");
    expect(JSON.stringify(assessAttachment(conversation))).toBe(JSON.stringify(assessAttachment(conversation)));
  });

  it("classifyDirection applies the 8-point mixed margin", () => {
    expect(classifyDirection({ anxious: 90, avoidant: 10, secure: 20 })).toBe("anxious");
    expect(classifyDirection({ anxious: 10, avoidant: 90, secure: 20 })).toBe("avoidant");
    expect(classifyDirection({ anxious: 10, avoidant: 20, secure: 90 })).toBe("secure");
    expect(classifyDirection({ anxious: 50, avoidant: 20, secure: 48 })).toBe("mixed");
    expect(classifyDirection({ anxious: 70, avoidant: 20, secure: 50 })).toBe("anxious");
    expect(classifyDirection({ anxious: 50, avoidant: 46, secure: 40 }, 4)).toBe("anxious");
  });
});

describe("attachment · direction rules on crafted behavior", () => {
  it("flags the fast/double-texting/late-night side as anxious and the slow/short side as avoidant", () => {
    const conversation = anxiousAvoidantConversation();
    const report = assessAttachment(conversation);
    expect(report.user.direction).toBe("anxious");
    expect(report.partner.direction).toBe("avoidant");
    expect(report.user.scores.anxious).toBeGreaterThan(report.user.scores.secure);
    expect(report.partner.scores.avoidant).toBeGreaterThan(report.partner.scores.secure);
  });

  it("flags a balanced/repairing conversation as secure on both sides", () => {
    const report = assessAttachment(secureConversation());
    expect(report.user.direction).toBe("secure");
    expect(report.partner.direction).toBe("secure");
    expect(report.user.scores.secure).toBeGreaterThan(80);
  });
});

describe("health · weights and five dimensions", () => {
  it("uses weights_v1 whose weights sum to 100", () => {
    const sum = DIMENSION_ORDER.reduce((total, id) => total + WEIGHTS_V1[id], 0);
    expect(sum).toBe(100);
    expect(DIMENSION_ORDER.length).toBe(5);
  });

  it("computes a bounded weighted total from five bounded dimensions", () => {
    const conversation = fixtureConversation("whatsapp/android-24h-dmy.txt", "Alex", "Sam");
    const metrics = computeMetrics(conversation);
    const health = buildHealth(conversation, metrics);

    expect(health.weightsVersion).toBe("weights_v1");
    expect(health.weightsSum).toBe(100);
    expect(health.dimensions.map((dimension) => dimension.id)).toEqual([...DIMENSION_ORDER]);

    for (const dimension of health.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(100);
      expect(dimension.confidence).toBeGreaterThanOrEqual(0);
      expect(dimension.confidence).toBeLessThanOrEqual(1);
      expect(dimension.explain.length).toBeGreaterThan(0);
      expect(dimension.metricIds.length).toBeGreaterThan(0);
    }

    const recomputed = Math.round(
      health.dimensions.reduce((total, dimension) => total + (dimension.score * dimension.weight) / 100, 0),
    );
    expect(health.totalScore).toBe(recomputed);
    expect(health.totalScore).toBeGreaterThanOrEqual(0);
    expect(health.totalScore).toBeLessThanOrEqual(100);
    expect(health.grade).toBe(gradeFromScore(health.totalScore).grade);
  });

  it("maps grade boundaries deterministically", () => {
    expect(gradeFromScore(100)).toEqual({ grade: "A", scoreLabel: "Healthy" });
    expect(gradeFromScore(80)).toEqual({ grade: "A", scoreLabel: "Healthy" });
    expect(gradeFromScore(79.9).grade).toBe("B");
    expect(gradeFromScore(60).grade).toBe("B");
    expect(gradeFromScore(59.9).grade).toBe("C");
    expect(gradeFromScore(0)).toEqual({ grade: "C", scoreLabel: "Needs attention" });
  });

  it("keeps responsiveness neutral (not fake) when there are no timestamps", () => {
    const parsed = parsePastedText(fixture("paste/two-speaker.txt"));
    const mapped = createSpeakerMap(parsed.chat, { user: "Me" });
    if (mapped.status !== "confirmed") throw new Error("expected confirmed map");
    const conversation = conversationFromChat(parsed.chat, mapped.map);
    const metrics = computeMetrics(conversation);
    const health = buildHealth(conversation, metrics);
    const responsiveness = health.dimensions.find((dimension) => dimension.id === "responsiveness");
    expect(responsiveness?.score).toBe(50);
    expect(responsiveness?.confidence).toBe(0);
  });
});

describe("free preview · timed and untimed cards (FR-3 / AC-3.3)", () => {
  it("shows three timing cards with balanced phrasing when the sides match", () => {
    const conversation = secureConversation();
    const metrics = computeMetrics(conversation);
    const preview = buildFreePreview(conversation, metrics, assessAttachment(conversation, metrics));
    expect(preview.mode).toBe("timed");
    expect(preview.cards.map((card) => card.id)).toEqual(["reply_pace_gap", "initiation", "late_night"]);
    expect(preview.cards[0]?.insight).toContain("evenly matched");
    expect(preview.replyBias).toBe(50);
    expect(preview.cards.every((card) => card.footnote.startsWith("Based on 8 messages"))).toBe(true);
  });

  it("shows replacement cards for untimed paste (AC-3.3 non-blank degradation)", () => {
    const parsed = parsePastedText(fixture("paste/two-speaker.txt"));
    const mapped = createSpeakerMap(parsed.chat, { user: "Me" });
    if (mapped.status !== "confirmed") throw new Error("expected confirmed map");
    const conversation = conversationFromChat(parsed.chat, mapped.map);
    const metrics = computeMetrics(conversation);
    const preview = buildFreePreview(conversation, metrics, assessAttachment(conversation, metrics));
    expect(preview.mode).toBe("untimed");
    expect(preview.cards.map((card) => card.id)).toEqual([
      "message_balance",
      "double_texts",
      "conversation_turns",
    ]);
    expect(preview.cards[0]?.comparison).toContain("You 5 / Partner 4");
    expect(preview.attachmentDirection.length).toBeGreaterThan(0);
  });

  it("formats date ranges from wall-clock fields", () => {
    expect(formatDateRange(at(2026, 3, 1, 9), at(2026, 3, 21, 11))).toBe("Mar 1 – Mar 21, 2026");
    expect(formatDateRange(at(2026, 3, 1), at(2026, 3, 1, 23))).toBe("Mar 1, 2026");
    expect(formatDateRange(null, null)).toBe("timestamps unavailable");
  });
});

describe("ReportFeatures · schema v1 contract", () => {
  it("builds the full feature package from a WhatsApp conversation", () => {
    const conversation = fixtureConversation("whatsapp/android-24h-dmy.txt", "Alex", "Sam");
    const features = buildReportFeatures(conversation);
    expect(features.schemaVersion).toBe("features_v1");
    expect(features.platform).toBe("whatsapp");
    expect(features.versions.weights).toBe("weights_v1");
    expect(features.versions.metrics).toBe("metrics_v1");
    expect(features.versions.attachmentRule).toBe("attachment_v1");
    expect(features.versions.lexicon).toBe("lexicon_v0-draft");

    expect(Object.keys(features.metrics).length).toBe(10);
    expect(features.sample.messageCount).toBe(42);
    expect(features.sample.timestampedCount).toBe(42);
    expect(features.sample.dateRangeLabel).toBe("Mar 1 – Mar 21, 2026");
    expect(features.sample.durationDays).toBeGreaterThan(19);

    expect(features.health.dimensions.length).toBe(5);
    expect(features.preview.mode).toBe("timed");
    expect(features.evidenceCount).toBeGreaterThan(0);

    const signals = [...features.attachment.user.signals, ...features.attachment.partner.signals];
    const uniqueIds = new Set(signals.flatMap((signal) => signal.messageIds));
    expect(features.evidenceCount).toBe(uniqueIds.size);
    for (const id of uniqueIds) expect(messageIds(conversation).has(id)).toBe(true);

    expect(features.dataQuality.needsSpeakerConfirmation).toBe(false);
    expect(features.dataQuality.needsDateConfirmation).toBe(false);
    expect(features.dataQuality.timestampCoverage).toBe(1);
    expect(features.dataQuality.confidence).toBeGreaterThan(0);
    expect(features.dataQuality.confidence).toBeLessThanOrEqual(1);
    // 42 条 < 500：诚实标注小样本（PRD 细化方案 §3.2 黄色提示）
    expect(features.dataQuality.lowSample).toBe(true);
  });

  it("is deterministic and JSON-serializable", () => {
    const conversation = fixtureConversation("whatsapp/android-24h-dmy.txt", "Sam", "Alex");
    const first = buildReportFeatures(conversation);
    const second = buildReportFeatures(conversation);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.parse(JSON.stringify(first))).toEqual(JSON.parse(JSON.stringify(second)));
  });

  it("flags small/untimed samples honestly", () => {
    const parsed = parsePastedText(fixture("paste/two-speaker.txt"));
    const mapped = createSpeakerMap(parsed.chat, { user: "Me" });
    if (mapped.status !== "confirmed") throw new Error("expected confirmed map");
    const conversation = conversationFromChat(parsed.chat, mapped.map);
    const features = buildReportFeatures(conversation);
    expect(features.preview.mode).toBe("untimed");
    expect(features.sample.timestampedCount).toBe(0);
    expect(features.dataQuality.timestampCoverage).toBe(0);
    expect(features.dataQuality.lowSample).toBe(true);
    expect(features.dataQuality.warnings.some((warning) => warning.startsWith("W-UNTIMED"))).toBe(true);
    expect(features.metrics.reply_median_latency.unavailableReason).toBe("no-timestamps");
  });

  it("survives an empty conversation without throwing", () => {
    const features = buildReportFeatures(makeConversation([]));
    expect(features.sample.messageCount).toBe(0);
    expect(features.metrics.reply_median_latency.value).toBeNull();
    expect(features.health.totalScore).toBeGreaterThanOrEqual(0);
    expect(features.health.totalScore).toBeLessThanOrEqual(100);
    expect(features.preview.cards.length).toBe(3);
    expect(features.evidenceCount).toBe(0);
  });
});
