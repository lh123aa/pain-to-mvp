/**
 * 规则层指标测试（M1 · FR-4 / PRD §5.1 十项指标 / AC-4.1 边界用例）
 *
 * 覆盖：每项指标的公式与边界（空会话 / 单条 / 单方 / 无时序 / emoji 云 / 时区中立）、
 * confidence 与 sampleSize、unavailableReason、配置覆盖、纯函数确定性。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Conversation, ConversationMessage, MessageKind, SpeakerRole } from "@/parser";
import { conversationFromChat, createSpeakerMap, parseWhatsAppTxt } from "@/parser";
import {
  METRIC_IDS,
  computeConversationStats,
  computeMetrics,
  resolveMetricsConfig,
  type MetricId,
  type MetricResult,
} from "@/rules";
import { hasEmoji, median, tokenizeText } from "@/rules";

type Entry = {
  role: SpeakerRole;
  /** wall-clock epoch ms；null = 无时间戳（粘贴模式）。 */
  at: number | null;
  text?: string;
  kind?: MessageKind;
};

/** 构造 wall-clock timestamp（UTC 字段 = 导出文件里的钟面时间）。 */
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
      text: entry.text ?? "",
      isSystem: false,
      kind,
      hasMedia: kind === "media",
      role: entry.role,
    };
  });

  const timed = messages.filter(
    (message): message is ConversationMessage & { timestamp: number } => message.timestamp !== null,
  );
  const startedAt = timed.length > 0 ? Math.min(...timed.map((message) => message.timestamp)) : null;
  const endedAt = timed.length > 0 ? Math.max(...timed.map((message) => message.timestamp)) : null;

  const identity = (role: SpeakerRole) => {
    const own = messages.filter((message) => message.role === role);
    const ownTimed = own.filter(
      (message): message is ConversationMessage & { timestamp: number } => message.timestamp !== null,
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

function metricById(conversation: Conversation, id: MetricId): MetricResult {
  return computeMetrics(conversation).metrics[id];
}

describe("metrics · shape and determinism", () => {
  it("returns all 10 PRD metrics with value/sampleSize/confidence/explain", () => {
    const conversation = makeConversation([
      { role: "user", at: at(2026, 3, 1, 10, 0), text: "hey" },
      { role: "partner", at: at(2026, 3, 1, 10, 5), text: "hi" },
    ]);
    const bundle = computeMetrics(conversation);
    expect(bundle.version).toBe("metrics_v1");
    expect(METRIC_IDS.length).toBe(10);

    for (const id of METRIC_IDS) {
      const metric = bundle.metrics[id];
      expect(metric.id).toBe(id);
      expect(metric.label.length).toBeGreaterThan(0);
      expect(metric.explain.length).toBeGreaterThan(0);
      expect(metric.sampleSize).toBeGreaterThanOrEqual(0);
      expect(metric.confidence).toBeGreaterThanOrEqual(0);
      expect(metric.confidence).toBeLessThanOrEqual(1);
      if (metric.value !== null) expect(Number.isFinite(metric.value)).toBe(true);
    }
  });

  it("is a pure function: two calls produce identical JSON", () => {
    const conversation = makeConversation([
      { role: "user", at: at(2026, 3, 1, 10, 0), text: "one?" },
      { role: "partner", at: at(2026, 3, 1, 10, 3), text: "two 😅" },
      { role: "user", at: at(2026, 3, 1, 10, 4), text: "three" },
      { role: "partner", at: at(2026, 3, 1, 23, 40), text: "late" },
    ]);
    const first = JSON.stringify(computeMetrics(conversation));
    const second = JSON.stringify(computeMetrics(conversation));
    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual(JSON.parse(JSON.stringify(computeMetrics(conversation))));
  });
});

describe("metrics · each of the ten", () => {
  it("reply_median_latency = median minutes between a message and the other side's reply", () => {
    const start = at(2026, 3, 1, 10, 0);
    const conversation = makeConversation([
      { role: "user", at: start, text: "a" },
      { role: "partner", at: plus(start, 2), text: "b" },
      { role: "user", at: plus(start, 6), text: "c" },
      { role: "partner", at: plus(start, 16), text: "d" },
      { role: "user", at: plus(start, 26), text: "e" },
    ]);
    const metric = metricById(conversation, "reply_median_latency");
    expect(metric.value).toBe(7);
    expect(metric.sampleSize).toBe(4);
    expect(metric.details.userMedianMinutes).toBe(7);
    expect(metric.details.partnerMedianMinutes).toBe(6);
    expect(metric.details.partnerReplySamples).toBe(2);
  });

  it("double_text_rate = follow-up messages ÷ all messages", () => {
    const start = at(2026, 3, 1, 10, 0);
    const conversation = makeConversation([
      { role: "user", at: start, text: "1" },
      { role: "user", at: plus(start, 1), text: "2" },
      { role: "partner", at: plus(start, 2), text: "3" },
      { role: "user", at: plus(start, 3), text: "4" },
      { role: "user", at: plus(start, 4), text: "5" },
      { role: "user", at: plus(start, 5), text: "6" },
      { role: "partner", at: plus(start, 6), text: "7" },
    ]);
    const metric = metricById(conversation, "double_text_rate");
    expect(metric.value).toBe(0.4286);
    expect(metric.details.userRate).toBe(0.6);
    expect(metric.details.partnerRate).toBe(0);
  });

  it("initiation_ratio = sessions started by you ÷ all sessions (gap > 6 h)", () => {
    const day1 = at(2026, 3, 1, 10, 0);
    const conversation = makeConversation([
      { role: "user", at: day1, text: "a" },
      { role: "partner", at: plus(day1, 5), text: "b" },
      { role: "partner", at: at(2026, 3, 2, 10, 0), text: "c" },
      { role: "user", at: at(2026, 3, 2, 11, 0), text: "d" },
      { role: "user", at: at(2026, 3, 3, 9, 0), text: "e" },
    ]);
    const metric = metricById(conversation, "initiation_ratio");
    expect(metric.value).toBe(0.6667);
    expect(metric.sampleSize).toBe(3);
    expect(metric.details.userSessions).toBe(2);
    expect(metric.details.partnerSessions).toBe(1);
  });

  it("length_ratio = your median characters ÷ partner's median characters", () => {
    const start = at(2026, 3, 1, 10, 0);
    const conversation = makeConversation([
      { role: "user", at: start, text: "abcdefghij" },
      { role: "partner", at: plus(start, 1), text: "abcde" },
      { role: "user", at: plus(start, 2), text: "klmnopqrst" },
      { role: "partner", at: plus(start, 3), text: "fghij" },
    ]);
    const metric = metricById(conversation, "length_ratio");
    expect(metric.value).toBe(2);
    expect(metric.details.userMedianChars).toBe(10);
    expect(metric.details.partnerMedianChars).toBe(5);
  });

  it("question_rate and emoji_rate use non-empty text messages as denominator", () => {
    const start = at(2026, 3, 1, 10, 0);
    const conversation = makeConversation([
      { role: "user", at: start, text: "hello?" },
      { role: "user", at: plus(start, 1), text: "hi 😅" },
      { role: "partner", at: plus(start, 2), text: "ok" },
      { role: "partner", at: plus(start, 3), text: "you?" },
      { role: "user", at: plus(start, 4), text: "<Media omitted>", kind: "media" },
    ]);
    expect(metricById(conversation, "question_rate").value).toBe(0.5);
    expect(metricById(conversation, "emoji_rate").value).toBe(0.25);
  });

  it("late_night_share uses the 23:00–04:59 wall-clock window", () => {
    const conversation = makeConversation([
      { role: "user", at: at(2026, 3, 1, 23, 30), text: "night" },
      { role: "partner", at: at(2026, 3, 2, 2, 0), text: "still up" },
      { role: "user", at: at(2026, 3, 2, 12, 0), text: "noon" },
    ]);
    const metric = metricById(conversation, "late_night_share");
    expect(metric.value).toBe(0.6667);
    expect(metric.details.userRate).toBe(0.5);
    expect(metric.details.partnerRate).toBe(1);
  });

  it("topic_switch_proxy buckets top terms and counts bucket changes", () => {
    const start = at(2026, 3, 1, 10, 0);
    const conversation = makeConversation([
      { role: "user", at: start, text: "pizza tonight" },
      { role: "partner", at: plus(start, 1), text: "pizza again" },
      { role: "user", at: plus(start, 2), text: "pizza place" },
      { role: "partner", at: plus(start, 3), text: "pizza good" },
      { role: "user", at: plus(start, 4), text: "work meeting" },
      { role: "partner", at: plus(start, 5), text: "work deadline" },
      { role: "user", at: plus(start, 6), text: "work stress" },
      { role: "partner", at: plus(start, 7), text: "work email" },
    ]);
    const metric = metricById(conversation, "topic_switch_proxy");
    expect(metric.proxy).toBe(true);
    expect(metric.value).toBe(0.1429);
    expect(metric.details.switches).toBe(1);
    expect(metric.details.comparablePairs).toBe(7);
    expect(metric.details.meanRunLength).toBe(4);
  });

  it("conflict_repair_freq counts lexicon hits per 1,000 text messages", () => {
    const start = at(2026, 3, 1, 10, 0);
    const conversation = makeConversation([
      { role: "user", at: start, text: "I'm sorry" },
      { role: "partner", at: plus(start, 1), text: "you angry" },
      { role: "user", at: plus(start, 2), text: "whatever" },
      { role: "partner", at: plus(start, 3), text: "hello" },
    ]);
    const metric = metricById(conversation, "conflict_repair_freq");
    expect(metric.proxy).toBe(true);
    expect(metric.value).toBe(500);
    expect(metric.details.repairPer1k).toBe(250);
    expect(metric.details.repairToConflictRatio).toBe(0.333);
  });

  it("investment_consistency rewards steady weekly volume and punishes gaps/drift", () => {
    const steadyStart = at(2026, 3, 1, 10, 0);
    const steadyEntries: Entry[] = [];
    for (let week = 0; week < 4; week += 1) {
      const base = plus(steadyStart, week * 7 * 24 * 60);
      steadyEntries.push(
        { role: "user", at: base, text: "a" },
        { role: "partner", at: plus(base, 1), text: "b" },
        { role: "user", at: plus(base, 2), text: "c" },
        { role: "partner", at: plus(base, 3), text: "d" },
      );
    }
    const steady = metricById(makeConversation(steadyEntries), "investment_consistency");
    expect(steady.value).toBe(100);
    expect(steady.details.bucketUnit).toBe("week");
    expect(steady.details.bucketCount).toBe(4);

    const erraticEntries: Entry[] = [];
    for (let index = 0; index < 8; index += 1) {
      erraticEntries.push({ role: "user", at: plus(at(2026, 3, 1, 10, 0), index), text: `burst ${index}` });
    }
    for (let index = 0; index < 8; index += 1) {
      erraticEntries.push({ role: "user", at: plus(at(2026, 3, 15, 10, 0), index), text: `burst again ${index}` });
    }
    erraticEntries.push({ role: "partner", at: at(2026, 3, 22, 10, 0), text: "one reply" });
    const erratic = metricById(makeConversation(erraticEntries), "investment_consistency");
    expect(erratic.value).not.toBeNull();
    expect(erratic.value as number).toBeLessThan(20);
    expect(steady.value as number).toBeGreaterThan(erratic.value as number);
  });
});

describe("metrics · edge cases (AC-4.1)", () => {
  it("handles an empty conversation without throwing", () => {
    const conversation = makeConversation([]);
    const bundle = computeMetrics(conversation);
    for (const id of METRIC_IDS) {
      expect(bundle.metrics[id].value).toBeNull();
      expect(bundle.metrics[id].sampleSize).toBe(0);
      expect(bundle.metrics[id].confidence).toBe(0);
    }
    expect(bundle.metrics.investment_consistency.unavailableReason).toBe("no-messages");
  });

  it("handles a single message", () => {
    const conversation = makeConversation([{ role: "user", at: at(2026, 3, 1, 10, 0), text: "hi" }]);
    const bundle = computeMetrics(conversation);
    expect(bundle.metrics.reply_median_latency.value).toBeNull();
    expect(bundle.metrics.reply_median_latency.unavailableReason).toBe("insufficient-sample");
    expect(bundle.metrics.length_ratio.value).toBeNull();
    expect(bundle.metrics.investment_consistency.value).toBeNull();
  });

  it("handles a one-sided conversation (partner never replies)", () => {
    const conversation = makeConversation([
      { role: "user", at: at(2026, 3, 1, 10, 0), text: "hi?" },
      { role: "user", at: at(2026, 3, 1, 10, 5), text: "hello?" },
      { role: "user", at: at(2026, 3, 2, 10, 0), text: "you there" },
    ]);
    const bundle = computeMetrics(conversation);
    expect(bundle.metrics.reply_median_latency.value).toBeNull();
    expect(bundle.metrics.initiation_ratio.value).toBe(1);
    expect(bundle.metrics.investment_consistency.unavailableReason).toBe("one-sided");
    expect(bundle.metrics.investment_consistency.value).toBeNull();
  });

  it("degrades timing metrics to null for untimed paste conversations", () => {
    const entries: Entry[] = [];
    const lines = [
      "pizza tonight?",
      "pizza again",
      "pizza place",
      "work meeting",
      "work deadline",
      "work stress",
      "work email",
      "pizza good",
      "work call",
      "pizza plan",
    ];
    lines.forEach((text, index) => {
      entries.push({ role: index % 2 === 0 ? "user" : "partner", at: null, text });
    });
    const conversation = makeConversation(entries, "paste");
    const bundle = computeMetrics(conversation);

    expect(bundle.metrics.reply_median_latency.value).toBeNull();
    expect(bundle.metrics.reply_median_latency.unavailableReason).toBe("no-timestamps");
    expect(bundle.metrics.initiation_ratio.unavailableReason).toBe("no-timestamps");
    expect(bundle.metrics.late_night_share.unavailableReason).toBe("no-timestamps");
    expect(bundle.metrics.investment_consistency.unavailableReason).toBe("no-timestamps");
    // 无时序替代卡需要的指标仍可用
    expect(bundle.metrics.double_text_rate.value).not.toBeNull();
    expect(bundle.metrics.length_ratio.value).not.toBeNull();
    expect(bundle.metrics.question_rate.value).not.toBeNull();
    expect(bundle.metrics.conflict_repair_freq.value).not.toBeNull();
    expect(bundle.metrics.topic_switch_proxy.value).not.toBeNull();
  });

  it("survives emoji clouds and mixed scripts", () => {
    const conversation = makeConversation([
      { role: "user", at: at(2026, 3, 1, 10, 0), text: "😅😂🥲❤️💀" },
      { role: "partner", at: at(2026, 3, 1, 10, 1), text: "中文 mixed with English 🎉" },
      { role: "user", at: at(2026, 3, 1, 10, 2), text: "https://example.com/x?y=1" },
    ]);
    const bundle = computeMetrics(conversation);
    expect(bundle.metrics.emoji_rate.value).toBeGreaterThan(0);
    expect(bundle.metrics.emoji_rate.value).toBeLessThanOrEqual(1);
  });

  it("applies config overrides without mutating defaults", () => {
    const start = at(2026, 3, 1, 10, 0);
    const conversation = makeConversation([
      { role: "user", at: start, text: "a" },
      { role: "partner", at: plus(start, 45), text: "b" },
      { role: "user", at: plus(start, 90), text: "c" },
    ]);
    const defaultInitiation = metricById(conversation, "initiation_ratio");
    expect(defaultInitiation.value).toBeNull();
    expect(defaultInitiation.unavailableReason).toBe("insufficient-sample");

    const shortGap = computeMetrics(conversation, { sessionGapMinutes: 30 });
    expect(shortGap.metrics.initiation_ratio.sampleSize).toBe(3);

    const window = makeConversation([
      { role: "user", at: at(2026, 3, 1, 2, 0), text: "night" },
      { role: "partner", at: at(2026, 3, 1, 23, 30), text: "late" },
    ]);
    expect(computeMetrics(window).metrics.late_night_share.value).toBe(1);
    expect(computeMetrics(window, { lateNightStartHour: 0, lateNightEndHour: 6 }).metrics.late_night_share.value).toBe(
      0.5,
    );
    expect(resolveMetricsConfig().sessionGapMs).toBe(6 * 60 * 60 * 1000);
  });

  it("exposes stats used by the attachment/health layers", () => {
    const conversation = makeConversation([
      { role: "user", at: at(2026, 3, 1, 10, 0), text: "hello?" },
      { role: "partner", at: at(2026, 3, 1, 10, 5), text: "hi" },
    ]);
    const stats = computeConversationStats(conversation);
    expect(stats.totalMessages).toBe(2);
    expect(stats.sessionCount).toBe(1);
    expect(stats.user.medianChars).toBe(6);
    expect(stats.partner.medianChars).toBe(2);
    expect(stats.overallMedianReplyMinutes).toBe(5);
  });
});

describe("metrics · helpers", () => {
  it("median handles odd/even/empty arrays", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("tokenizeText splits on punctuation and keeps stopwords for the stats layer to filter", () => {
    expect(tokenizeText("Pizza, tonight!")).toEqual(["pizza", "tonight"]);
    expect(tokenizeText("the pizza")).toEqual(["the", "pizza"]);
  });

  it("hasEmoji detects common emoji and ignores plain text", () => {
    expect(hasEmoji("hi 😅")).toBe(true);
    expect(hasEmoji("❤️")).toBe(true);
    expect(hasEmoji("plain text")).toBe(false);
  });
});

/* -------------------------------------------------------------------------------------------------
 * fixture 驱动的规则层边界（task-12）：时间边界 fixture 不能只是"文件摆着"，要真的喂进指标层
 * ------------------------------------------------------------------------------------------------*/

function fixtureText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${relativePath}`, import.meta.url)), "utf8");
}

function fixtureConversation(relativePath: string, user: string, partner: string): Conversation {
  const parsed = parseWhatsAppTxt(fixtureText(relativePath));
  const mapped = createSpeakerMap(parsed.chat, { user, partner });
  if (mapped.status !== "confirmed") throw new Error(`speaker map not confirmed: ${mapped.code}`);
  return conversationFromChat(parsed.chat, mapped.map);
}

describe("fixtures · time boundaries feed the metrics layer", () => {
  it("exactly 6 h stays one session; > 6 h starts a new one; out-of-order gaps are ignored", () => {
    const conversation = fixtureConversation("whatsapp/clock-anomalies.txt", "Alex", "Sam");
    const stats = computeConversationStats(conversation);
    const metrics = computeMetrics(conversation);

    // 10:00 → 16:00 = exactly 6 h → same session；16:01 → … → 22:02 > 6 h → new session。
    expect(stats.sessionCount).toBe(2);
    // 回复样本：Sam 的 360 min（恰好 6h 仍是回复）+ Alex 的 1 min；乱序的负间隔被忽略。
    expect(metrics.metrics.reply_median_latency.sampleSize).toBe(2);
    expect(metrics.metrics.reply_median_latency.details.userMedianMinutes).toBe(1);
    expect(metrics.metrics.reply_median_latency.details.partnerMedianMinutes).toBe(360);
    expect(metrics.metrics.reply_median_latency.value).toBe(180.5);
  });

  it("late-night window counts 23:00 and 04:59 but not 22:59 / 05:00", () => {
    const conversation = fixtureConversation("whatsapp/late-night-window.txt", "Alex", "Sam");
    const metrics = computeMetrics(conversation);
    expect(metrics.metrics.late_night_share.value).toBe(0.5); // 2 of 4
    expect(metrics.metrics.late_night_share.details.userRate).toBe(0.5);
    expect(metrics.metrics.late_night_share.details.partnerRate).toBe(0.5);
  });

  it("cross-year + leap-day fixture keeps wall-clock dates and positive intervals", () => {
    const conversation = fixtureConversation("whatsapp/year-boundary-leap.txt", "Riley", "Jordan");
    expect(conversation.meta.messageCount).toBe(4);
    expect(conversation.meta.startedAt).toBe(Date.UTC(2023, 11, 31, 23, 59));
    expect(conversation.meta.endedAt).toBe(Date.UTC(2024, 1, 29, 12, 1));
    const metrics = computeMetrics(conversation);
    expect(metrics.metrics.reply_median_latency.sampleSize).toBe(2);
    expect(metrics.metrics.reply_median_latency.value).toBe(1.5);
  });

  it("midnight crossing keeps a positive 6-second reply gap", () => {
    const conversation = fixtureConversation("whatsapp/midnight-crossing.txt", "Alex", "Sam");
    const metrics = computeMetrics(conversation);
    expect(metrics.metrics.reply_median_latency.details.partnerMedianMinutes).toBe(0.1); // 6 s
    expect(conversation.meta.startedAt).toBe(Date.UTC(2025, 10, 15, 23, 59, 59));
    expect(conversation.meta.endedAt).toBe(Date.UTC(2025, 10, 16, 23, 59));
  });
});
