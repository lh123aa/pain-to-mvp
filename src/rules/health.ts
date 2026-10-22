/**
 * 五维健康度 + 免费三卡 + 报告特征包（M1 · FR-3 / FR-4 / §5.3 权重表 v1）
 *
 * - 五维权重**直接读权重表 v1 默认值**（互惠 25 / 响应 20 / 氛围 15 / 冲突修复 25 / 投入一致性 15，
 *   和 = 100）。权重表变更必须走 ADR（PRD §5.3），因此这里把权重集中成 `WEIGHTS_V1` 常量，
 *   并在输出里带 `weightsVersion: "weights_v1"`；M2 报告须注明所用版本。
 * - 维度分 0-100，加权总分 = Σ(dim × weight)/100；grade A≥80 / B≥60 / C<60。
 * - 免费预览卡严格按 PRD FR-3：有时间戳 = 三卡（回复节奏差 / 主动发起率 / 夜间占比）；
 *   无时序（粘贴）= 替代卡（消息量比 / double-text 率 / 回合长度，AC-3.3）。
 *   洞察句方向中性、差值 <15% 自动切平衡版（细化方案 §5.2），不评估、不诊断。
 * - 输出 ReportFeatures 是「特征 schema v1」的唯一入口：规则层 → 服务端/报告层的数据契约。
 *   PRD AC-4.1 要求的 JSON Schema 单测在 metrics/attachment 测试里以形状 + 边界用例承载。
 */
import type { Conversation } from "../parser/types";
import { ATTACHMENT_LABELS, ATTACHMENT_RULE_VERSION, assessAttachment } from "./attachment";
import type { AttachmentReport } from "./attachment";
import { LEXICON_VERSION } from "./lexicons";
import {
  METRICS_VERSION,
  clamp01,
  computeConversationStats,
  computeMetrics,
  roundTo,
  wallClock,
} from "./metrics";
import type { ConversationStats, MetricId, MetricResult, MetricsBundle } from "./metrics";

export const WEIGHTS_VERSION = "weights_v1";
export const FEATURES_SCHEMA_VERSION = "features_v1";

export type DimensionId =
  | "reciprocity"
  | "responsiveness"
  | "atmosphere"
  | "conflict_repair"
  | "investment_consistency";

/** 五维权重表 v1 默认值（documentation/权重表-v1.md；和必须 = 100）。 */
export const WEIGHTS_V1: Readonly<Record<DimensionId, number>> = {
  reciprocity: 25,
  responsiveness: 20,
  atmosphere: 15,
  conflict_repair: 25,
  investment_consistency: 15,
};

export const DIMENSION_LABELS: Readonly<Record<DimensionId, string>> = {
  reciprocity: "Reciprocity",
  responsiveness: "Responsiveness",
  atmosphere: "Atmosphere",
  conflict_repair: "Conflict repair",
  investment_consistency: "Investment consistency",
};

export const DIMENSION_ORDER: readonly DimensionId[] = [
  "reciprocity",
  "responsiveness",
  "atmosphere",
  "conflict_repair",
  "investment_consistency",
];

export interface DimensionScore {
  id: DimensionId;
  label: string;
  weight: number;
  /** 0-100 */
  score: number;
  confidence: number;
  explain: string;
  metricIds: MetricId[];
}

export type Grade = "A" | "B" | "C";

export interface HealthAssessment {
  totalScore: number;
  grade: Grade;
  scoreLabel: string;
  dimensions: DimensionScore[];
  weightsVersion: typeof WEIGHTS_VERSION;
  /** 权重和（出口门判据：必须 100）。 */
  weightsSum: number;
}

export function gradeFromScore(totalScore: number): { grade: Grade; scoreLabel: string } {
  if (totalScore >= 80) return { grade: "A", scoreLabel: "Healthy" };
  if (totalScore >= 60) return { grade: "B", scoreLabel: "Fair" };
  return { grade: "C", scoreLabel: "Needs attention" };
}

function numberDetail(metric: MetricResult | undefined, key: string): number | null {
  const value = metric?.details[key];
  return typeof value === "number" ? value : null;
}

function confidenceFromMessages(messages: number, reliableAt = 300): number {
  if (messages <= 0) return 0;
  return roundTo(Math.sqrt(Math.min(1, messages / reliableAt)), 2);
}

function balance(a: number, b: number): number {
  const total = a + b;
  if (total <= 0) return 0.5;
  return 1 - Math.abs(a - b) / total;
}

/** 五维评分（确定性加权；无数据维度返回中性 50 + confidence 0，绝不伪造高分）。 */
export function buildHealth(
  conversation: Conversation,
  metrics: MetricsBundle,
  stats: ConversationStats = computeConversationStats(conversation),
): HealthAssessment {
  const { user, partner } = stats;
  const totalMessages = stats.totalMessages;
  const confidenceBase = confidenceFromMessages(totalMessages);

  // 互惠：消息量 / 发起 / 长度 / 问句 四个平衡度。
  const volumeBalance = balance(user.messageCount, partner.messageCount);
  const initiationBalance =
    stats.sessionCount > 0 ? balance(user.initiationCount, partner.initiationCount) : 0.5;
  const userMedianLength = numberDetail(metrics.metrics.length_ratio, "userMedianChars");
  const partnerMedianLength = numberDetail(metrics.metrics.length_ratio, "partnerMedianChars");
  const lengthBalance =
    userMedianLength !== null && partnerMedianLength !== null
      ? balance(userMedianLength, partnerMedianLength)
      : 0.5;
  const userQuestionRate = numberDetail(metrics.metrics.question_rate, "userRate");
  const partnerQuestionRate = numberDetail(metrics.metrics.question_rate, "partnerRate");
  const questionBalance =
    userQuestionRate !== null && partnerQuestionRate !== null
      ? balance(userQuestionRate, partnerQuestionRate)
      : 0.5;
  const reciprocity = roundTo(
    clamp01(0.4 * volumeBalance + 0.25 * initiationBalance + 0.2 * lengthBalance + 0.15 * questionBalance) *
      100,
    0,
  );

  // 响应：整体速度 + 双方对称性 + 15 分钟内回复覆盖。
  const replyMetric = metrics.metrics.reply_median_latency;
  const overallReply = replyMetric.value;
  const replySamples = replyMetric.sampleSize;
  let responsiveness = 50;
  let responsivenessExplain =
    "Median reply time and its symmetry between both sides (lower latency and closer symmetry score higher).";
  if (overallReply !== null) {
    const absolute = clamp01(1 - overallReply / 720); // 12 小时视作 0 分
    const userReply = numberDetail(replyMetric, "userMedianMinutes");
    const partnerReply = numberDetail(replyMetric, "partnerMedianMinutes");
    const symmetry =
      userReply !== null && partnerReply !== null
        ? 1 - clamp01(Math.abs(userReply - partnerReply) / Math.max(userReply, partnerReply, 1))
        : 0.5;
    const within15 = numberDetail(replyMetric, "shareWithin15Min") ?? 0.5;
    responsiveness = roundTo(clamp01(0.45 * absolute + 0.4 * symmetry + 0.15 * within15) * 100, 0);
  } else {
    responsivenessExplain =
      "Unavailable without timestamps (paste mode): this dimension stays neutral at 50 with confidence 0.";
  }

  // 氛围：emoji 温度 + 正负词倾向 + 修复词占比。
  const emojiRate = metrics.metrics.emoji_rate.value;
  const emojiNorm = emojiRate === null ? 0.5 : clamp01(emojiRate / 0.4);
  const positive = user.positiveCount + partner.positiveCount;
  const negative = user.negativeCount + partner.negativeCount;
  const positivity = clamp01(0.5 + (positive - negative) / (2 * (positive + negative + 1)));
  const repairRatio = numberDetail(metrics.metrics.conflict_repair_freq, "repairToConflictRatio");
  const atmosphere = roundTo(
    clamp01(0.35 * emojiNorm + 0.35 * positivity + 0.3 * (repairRatio ?? 0.5)) * 100,
    0,
  );

  // 冲突修复：冲突词频越低越好 + 修复行为占比越高越好。
  const conflictPer1k = metrics.metrics.conflict_repair_freq.value;
  const conflictScoreComponent = conflictPer1k === null ? 0.5 : 1 - clamp01(conflictPer1k / 20);
  const conflictRepair = roundTo(
    clamp01(0.5 * conflictScoreComponent + 0.5 * (repairRatio ?? 0.5)) * 100,
    0,
  );

  // 投入一致性：直接取指标 10（0-100）。
  const consistencyValue = metrics.metrics.investment_consistency.value;
  const investmentConsistency = consistencyValue ?? 50;

  const dimensionInputs: Array<{
    id: DimensionId;
    score: number;
    confidence: number;
    explain: string;
    metricIds: MetricId[];
  }> = [
    {
      id: "reciprocity",
      score: reciprocity,
      confidence: confidenceBase,
      explain:
        "Balance of message volume (40%), session initiation (25%), median message length (20%) and question rate (15%). More equal = higher.",
      metricIds: ["initiation_ratio", "length_ratio", "question_rate", "double_text_rate"],
    },
    {
      id: "responsiveness",
      score: responsiveness,
      confidence: replySamples > 0 ? roundTo(confidenceFromMessages(replySamples, 20), 2) : 0,
      explain: responsivenessExplain,
      metricIds: ["reply_median_latency"],
    },
    {
      id: "atmosphere",
      score: atmosphere,
      confidence: confidenceBase,
      explain:
        "Emoji-bearing message rate (35%, normalized to 40%), positive vs negative lexicon balance (35%), repair-word share (30%).",
      metricIds: ["emoji_rate", "conflict_repair_freq"],
    },
    {
      id: "conflict_repair",
      score: conflictRepair,
      confidence: confidenceFromMessages(user.conflictCount + partner.conflictCount + user.repairCount + partner.repairCount, 20),
      explain:
        "Conflict-word rate (50%, lower is better, normalized at 20 per 1k messages) + repair share repair÷(repair+conflict) (50%). Lexicon v0-draft.",
      metricIds: ["conflict_repair_freq"],
    },
    {
      id: "investment_consistency",
      score: roundTo(investmentConsistency, 0),
      confidence: metrics.metrics.investment_consistency.confidence,
      explain:
        "Stability of weekly message volume and of your share over time; see metric investment_consistency.",
      metricIds: ["investment_consistency"],
    },
  ];

  const dimensions: DimensionScore[] = DIMENSION_ORDER.map((id) => {
    const input = dimensionInputs.find((item) => item.id === id) as (typeof dimensionInputs)[number];
    return {
      id,
      label: DIMENSION_LABELS[id],
      weight: WEIGHTS_V1[id],
      score: Math.min(100, Math.max(0, input.score)),
      confidence: input.confidence,
      explain: input.explain,
      metricIds: input.metricIds,
    };
  });

  const weightsSum = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const totalScore = roundTo(
    dimensions.reduce((sum, dimension) => sum + (dimension.score * dimension.weight) / 100, 0),
    0,
  );
  const { grade, scoreLabel } = gradeFromScore(totalScore);

  return { totalScore, grade, scoreLabel, dimensions, weightsVersion: WEIGHTS_VERSION, weightsSum };
}

/* -------------------------------------------------------------------------------------------------
 * 免费三卡 / 无时序替代卡（FR-3 / AC-3.3）
 * ------------------------------------------------------------------------------------------------*/

export type FreeCardId =
  | "reply_pace_gap"
  | "initiation"
  | "late_night"
  | "message_balance"
  | "double_texts"
  | "conversation_turns";

export interface FreeCard {
  id: FreeCardId;
  title: string;
  value: number | null;
  comparison: string | null;
  insight: string;
  footnote: string;
}

export interface FreePreview {
  /** timed = 三张节奏卡；untimed = 无时序替代卡（粘贴模式）。 */
  mode: "timed" | "untimed";
  cards: FreeCard[];
  /** 与 demo-report.ReportData 对齐的字段（% 整数）：主动发起占比 / 深夜占比 / 短句占比。 */
  replyBias: number;
  lateRatio: number;
  shortRatio: number;
  attachmentDirection: string;
  attachmentLabel: string;
  attachmentConfidence: number;
  /** 依恋预览卡文案用：找到的行为信号总数（含无证据的汇总型信号）。 */
  signalCount: number;
  evidenceCount: number;
}

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** 用 wall-clock 字段格式化日期范围（确定性，不受运行机器时区影响）。 */
export function formatWallClockDate(timestamp: number, withYear = true): string {
  const clock = wallClock(timestamp);
  const month = MONTH_ABBREVIATIONS[clock.month - 1] ?? "Jan";
  return withYear ? `${month} ${clock.day}, ${clock.year}` : `${month} ${clock.day}`;
}

export function formatDateRange(startedAt: number | null, endedAt: number | null): string {
  if (startedAt === null || endedAt === null) return "timestamps unavailable";
  const start = wallClock(startedAt);
  const end = wallClock(endedAt);
  const sameYear = start.year === end.year;
  const sameDay = sameYear && start.month === end.month && start.day === end.day;
  if (sameDay) return formatWallClockDate(startedAt);
  if (sameYear) return `${formatWallClockDate(startedAt, false)} – ${formatWallClockDate(endedAt)}`;
  return `${formatWallClockDate(startedAt)} – ${formatWallClockDate(endedAt)}`;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function timedCards(
  metrics: MetricsBundle,
  stats: ConversationStats,
  footnote: string,
): { cards: FreeCard[]; replyBias: number; lateRatio: number } {
  const replyMetric = metrics.metrics.reply_median_latency;
  const userReply = numberDetail(replyMetric, "userMedianMinutes");
  const partnerReply = numberDetail(replyMetric, "partnerMedianMinutes");

  let replyInsight = "Not enough replies in this conversation to compare pace.";
  let replyComparison: string | null = null;
  let replyValue: number | null = metrics.metrics.reply_median_latency.value;
  if (userReply !== null && partnerReply !== null) {
    const slower = Math.max(userReply, partnerReply);
    const faster = Math.min(userReply, partnerReply);
    const factor = faster <= 0 ? null : roundTo(slower / faster, 1);
    replyComparison = `You ${Math.round(userReply)} min vs Partner ${Math.round(partnerReply)} min`;
    replyValue = factor;
    const relativeGap = slower > 0 ? (slower - faster) / slower : 0;
    if (relativeGap < 0.15) {
      replyInsight = "You're pretty evenly matched here.";
    } else if (userReply < partnerReply) {
      replyInsight = `You usually reply about ${factor ?? "—"}× faster. Gaps like this often feel like mixed signals.`;
    } else {
      replyInsight = `You usually reply about ${factor ?? "—"}× slower. Worth noticing — gently.`;
    }
  }

  const initiation = metrics.metrics.initiation_ratio.value;
  const replyBias = initiation === null ? 50 : percent(initiation);
  const initiationInsight =
    initiation === null
      ? "Not enough conversations to see who starts them."
      : replyBias >= 42 && replyBias <= 58
        ? "You're pretty evenly matched on who starts the conversation."
        : `You start about ${replyBias}% of conversations. Worth noticing — gently.`;

  const lateOverall = metrics.metrics.late_night_share.value;
  const userLateRate = numberDetail(metrics.metrics.late_night_share, "userRate");
  const lateRatio = percent(userLateRate ?? lateOverall ?? 0);
  const lateInsight =
    lateOverall === null
      ? "Timestamps were not available for this card."
      : lateRatio >= 15
        ? `${lateRatio}% of your messages are after 11pm. The 3am paragraph is real.`
        : `${lateRatio}% of your messages are after 11pm. Your nights look fairly steady.`;

  const cards: FreeCard[] = [
    {
      id: "reply_pace_gap",
      title: "Reply pace gap",
      value: replyValue,
      comparison: replyComparison,
      insight: replyInsight,
      footnote,
    },
    {
      id: "initiation",
      title: "Who starts the conversation",
      value: initiation === null ? null : replyBias,
      comparison: initiation === null ? null : `You ${replyBias}% / Partner ${100 - replyBias}%`,
      insight: initiationInsight,
      footnote,
    },
    {
      id: "late_night",
      title: "Late-night messages",
      value: lateOverall === null ? null : percent(lateOverall),
      comparison: userLateRate === null ? null : `You ${percent(userLateRate)}% of your messages`,
      insight: lateInsight,
      footnote,
    },
  ];

  void stats;
  return { cards, replyBias, lateRatio };
}

function untimedCards(
  metrics: MetricsBundle,
  stats: ConversationStats,
  footnote: string,
): { cards: FreeCard[]; replyBias: number; lateRatio: number; shortRatio: number } {
  const userMessages = stats.user.messageCount;
  const partnerMessages = stats.partner.messageCount;
  const volumeRatio = partnerMessages > 0 ? roundTo(userMessages / partnerMessages, 1) : null;
  const volumeInsight =
    partnerMessages === 0
      ? "Only one side appears in this paste, so there's no balance to read."
      : volumeRatio === null
        ? "Not enough messages to compare volume."
        : volumeRatio >= 1.15
          ? `You send about ${volumeRatio}× more messages than they do. Not a verdict — just a pattern worth seeing.`
          : volumeRatio <= 0.87
            ? `You send about ${roundTo(1 / volumeRatio, 1)}× fewer messages than they do. Not a verdict — just a pattern worth seeing.`
            : "You send about the same number of messages.";

  const userDoubleRate = numberDetail(metrics.metrics.double_text_rate, "userRate") ?? 0;
  const doubleInsight =
    userDoubleRate >= 0.2
      ? `About ${percent(userDoubleRate)}% of your messages are back-to-back follow-ups. It can read as pressure, even when it isn't.`
      : "You rarely send follow-ups before a reply.";

  const meanRunLength = numberDetail(metrics.metrics.topic_switch_proxy, "meanRunLength");
  const turnsInsight =
    meanRunLength === null
      ? "Not enough text to read conversation turns."
      : `Most of your exchanges run about ${Math.round(meanRunLength)} messages before the topic shifts.`;

  const replyBias = 50;
  const lateRatio = 0;

  const cards: FreeCard[] = [
    {
      id: "message_balance",
      title: "Message balance",
      value: volumeRatio,
      comparison: `You ${userMessages} / Partner ${partnerMessages}`,
      insight: volumeInsight,
      footnote,
    },
    {
      id: "double_texts",
      title: "Double texts",
      value: percent(userDoubleRate),
      comparison: null,
      insight: doubleInsight,
      footnote,
    },
    {
      id: "conversation_turns",
      title: "Conversation turns",
      value: meanRunLength,
      comparison: null,
      insight: turnsInsight,
      footnote,
    },
  ];
  return { cards, replyBias, lateRatio, shortRatio: 0 };
}

/** 千分位格式化（不依赖 ICU，保证跨环境确定）。 */
function formatCount(value: number): string {
  return `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function buildFreePreview(
  conversation: Conversation,
  metrics: MetricsBundle,
  attachment: AttachmentReport,
  stats: ConversationStats = computeConversationStats(conversation),
): FreePreview {
  const messageCount = conversation.meta.messageCount;
  const footnote = `Based on ${formatCount(messageCount)} messages, ${formatDateRange(
    conversation.meta.startedAt,
    conversation.meta.endedAt,
  )}`;
  const timed = conversation.meta.timestampCoverage > 0;

  const shortRatio =
    stats.user.textCount + stats.partner.textCount > 0
      ? percent(
          (stats.user.shortMessageCount + stats.partner.shortMessageCount) /
            (stats.user.textCount + stats.partner.textCount),
        )
      : 0;

  const base = timed
    ? { ...timedCards(metrics, stats, footnote), shortRatio }
    : untimedCards(metrics, stats, footnote);

  const signals = [...attachment.user.signals, ...attachment.partner.signals];
  const evidenceIds = new Set<string>();
  for (const signal of signals) for (const id of signal.messageIds) evidenceIds.add(id);

  return {
    mode: timed ? "timed" : "untimed",
    cards: base.cards,
    replyBias: base.replyBias,
    lateRatio: base.lateRatio,
    shortRatio,
    attachmentDirection: attachment.user.direction,
    attachmentLabel: ATTACHMENT_LABELS[attachment.user.direction],
    attachmentConfidence: attachment.user.confidence,
    signalCount: signals.length,
    evidenceCount: evidenceIds.size,
  };
}

/* -------------------------------------------------------------------------------------------------
 * ReportFeatures（规则层 → 报告层的数据契约）
 * ------------------------------------------------------------------------------------------------*/

export interface ReportFeatures {
  schemaVersion: typeof FEATURES_SCHEMA_VERSION;
  platform: Conversation["platform"];
  versions: {
    weights: typeof WEIGHTS_VERSION;
    metrics: typeof METRICS_VERSION;
    attachmentRule: typeof ATTACHMENT_RULE_VERSION;
    lexicon: string;
  };
  sample: {
    messageCount: number;
    timestampedCount: number;
    systemCount: number;
    participantCount: number;
    startedAt: number | null;
    endedAt: number | null;
    durationDays: number;
    dateRangeLabel: string;
  };
  metrics: Record<MetricId, MetricResult>;
  attachment: AttachmentReport;
  health: HealthAssessment;
  preview: FreePreview;
  evidenceCount: number;
  dataQuality: {
    /** 0..1 总体置信度（样本量 × 时间戳覆盖率 × 日期确认状态）。 */
    confidence: number;
    needsDateConfirmation: boolean;
    dateOrder: Conversation["meta"]["dateOrder"];
    timestampCoverage: number;
    lowSample: boolean;
    needsSpeakerConfirmation: false;
    warnings: string[];
  };
}

/**
 * 一次算出报告所需的全部特征（指标 + 依恋 + 五维 + 免费预览）。
 * 纯函数：同 Conversation 两次调用结果完全一致（PRD AC-5.4 规则部分零波动）。
 */
export function buildReportFeatures(conversation: Conversation): ReportFeatures {
  const metrics = computeMetrics(conversation);
  const stats = computeConversationStats(conversation);
  const attachment = assessAttachment(conversation, metrics);
  const health = buildHealth(conversation, metrics, stats);
  const preview = buildFreePreview(conversation, metrics, attachment, stats);

  const signals = [...attachment.user.signals, ...attachment.partner.signals];
  const evidenceIds = new Set<string>();
  for (const signal of signals) for (const id of signal.messageIds) evidenceIds.add(id);

  const sampleFactor = clamp01(Math.sqrt(Math.min(1, conversation.meta.messageCount / 500)));
  const qualityFactor =
    conversation.meta.needsDateConfirmation ? 0.7 : 1;
  const confidence = roundTo(sampleFactor * (0.5 + 0.5 * conversation.meta.timestampCoverage) * qualityFactor, 2);
  const lowSample =
    conversation.meta.messageCount < 500 || conversation.meta.durationDays < 14;

  const warnings = conversation.issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => `${issue.code}: ${issue.message}`);

  return {
    schemaVersion: FEATURES_SCHEMA_VERSION,
    platform: conversation.platform,
    versions: {
      weights: WEIGHTS_VERSION,
      metrics: METRICS_VERSION,
      attachmentRule: ATTACHMENT_RULE_VERSION,
      lexicon: LEXICON_VERSION,
    },
    sample: {
      messageCount: conversation.meta.messageCount,
      timestampedCount: conversation.meta.timestampedCount,
      systemCount: conversation.meta.systemCount,
      participantCount: 2,
      startedAt: conversation.meta.startedAt,
      endedAt: conversation.meta.endedAt,
      durationDays: conversation.meta.durationDays,
      dateRangeLabel: formatDateRange(conversation.meta.startedAt, conversation.meta.endedAt),
    },
    metrics: metrics.metrics,
    attachment,
    health,
    preview,
    evidenceCount: evidenceIds.size,
    dataQuality: {
      confidence,
      needsDateConfirmation: conversation.meta.needsDateConfirmation,
      dateOrder: conversation.meta.dateOrder,
      timestampCoverage: conversation.meta.timestampCoverage,
      lowSample,
      needsSpeakerConfirmation: false,
      warnings,
    },
  };
}
