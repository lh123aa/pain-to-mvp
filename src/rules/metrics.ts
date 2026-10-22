/**
 * PRD 10 项指标（M1 · FR-4 / §5.1）
 *
 * 全部为**确定性纯函数**：输入 Conversation（说话人已显式确认），输出
 * `{ value, sampleSize, confidence }` + 可解释公式 + 明细。同输入两次调用结果完全一致
 * （PRD AC-5.4：规则部分零波动）。
 *
 * ⚠️ 与 PRD 的关系（诚实标注）：
 * - 指标**名称与语义**来自 PRD §5.1（v1.0 十项，v1.1 把 topic_switch_rate 降级为词频桶）。
 * - PRD 未逐条写死公式，本文件是**可解释代理实现**：每个 metric 的 `explain` 字段写明公式，
 *   文件内注释重复一遍，便于 M2 黄金集评审时逐条校准，不需要改调用方。
 * - 每项都带 sampleSize 与 confidence（0..1，纯样本量函数），不足样本返回 value=null +
 *   unavailableReason，绝不把"没数据"伪装成 0。
 *
 * 时间口径：所有间隔都用 wall-clock epoch ms 差值（导出文件的钟面时间），见 parser/types.ts。
 */
import type { Conversation, ConversationMessage, SpeakerRole } from "../parser/types";
import { countLexiconHits, normalizeForMatching } from "./lexicons";

export const METRICS_VERSION = "metrics_v1";

export const METRIC_IDS = [
  "reply_median_latency",
  "double_text_rate",
  "initiation_ratio",
  "length_ratio",
  "question_rate",
  "emoji_rate",
  "late_night_share",
  "topic_switch_proxy",
  "conflict_repair_freq",
  "investment_consistency",
] as const;

export type MetricId = (typeof METRIC_IDS)[number];
export type MetricUnit = "minutes" | "ratio" | "percent" | "per_1k_messages" | "chars" | "score";
export type UnavailableReason = "no-timestamps" | "insufficient-sample" | "one-sided" | "no-messages";

export interface MetricsConfig {
  /** 会话切分阈值：相邻消息间隔超过该值视为新会话（默认 6 小时）。 */
  sessionGapMinutes?: number;
  /** 深夜窗口起点（含），默认 23 点。 */
  lateNightStartHour?: number;
  /** 深夜窗口终点（不含），默认 5 点。 */
  lateNightEndHour?: number;
  /** "短消息"字符阈值（demo-report.shortRatio 口径），默认 15。 */
  shortMessageChars?: number;
  /** 投入一致性的周桶大小（天），默认 7；跨度 <21 天时自动降为按天。 */
  consistencyBucketDays?: number;
  /** 话题词频桶的 top-N，默认 20（PRD v1.1「top-20 TF 聚类」）。 */
  topicTopTerms?: number;
}

export interface ResolvedMetricsConfig {
  sessionGapMinutes: number;
  sessionGapMs: number;
  lateNightStartHour: number;
  lateNightEndHour: number;
  shortMessageChars: number;
  consistencyBucketDays: number;
  topicTopTerms: number;
}

export const DEFAULT_METRICS_CONFIG: ResolvedMetricsConfig = {
  sessionGapMinutes: 360,
  sessionGapMs: 360 * 60 * 1000,
  lateNightStartHour: 23,
  lateNightEndHour: 5,
  shortMessageChars: 15,
  consistencyBucketDays: 7,
  topicTopTerms: 20,
};

export function resolveMetricsConfig(config: MetricsConfig = {}): ResolvedMetricsConfig {
  const sessionGapMinutes = config.sessionGapMinutes ?? DEFAULT_METRICS_CONFIG.sessionGapMinutes;
  return {
    sessionGapMinutes,
    sessionGapMs: sessionGapMinutes * 60 * 1000,
    lateNightStartHour: config.lateNightStartHour ?? DEFAULT_METRICS_CONFIG.lateNightStartHour,
    lateNightEndHour: config.lateNightEndHour ?? DEFAULT_METRICS_CONFIG.lateNightEndHour,
    shortMessageChars: config.shortMessageChars ?? DEFAULT_METRICS_CONFIG.shortMessageChars,
    consistencyBucketDays: config.consistencyBucketDays ?? DEFAULT_METRICS_CONFIG.consistencyBucketDays,
    topicTopTerms: config.topicTopTerms ?? DEFAULT_METRICS_CONFIG.topicTopTerms,
  };
}

export interface MetricResult {
  id: MetricId;
  label: string;
  value: number | null;
  unit: MetricUnit;
  sampleSize: number;
  /** 0..1；纯样本量函数（timing 指标再乘时间戳覆盖率系数）。 */
  confidence: number;
  /** true = PRD 明确标注的代理指标（topic_switch 词频桶、冲突修复词表 v0）。 */
  proxy: boolean;
  /** 人类可读公式，报告/方法论页可直接引用。 */
  explain: string;
  details: Record<string, number | string | null>;
  unavailableReason?: UnavailableReason;
}

export interface MetricsBundle {
  version: typeof METRICS_VERSION;
  config: ResolvedMetricsConfig;
  metrics: Record<MetricId, MetricResult>;
}

/* -------------------------------------------------------------------------------------------------
 * 基础工具
 * ------------------------------------------------------------------------------------------------*/

export function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 数值数组的中位数（偶数取中间两个平均）；空数组 → null。 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const low = sorted[mid - 1] ?? 0;
  const high = sorted[mid] ?? 0;
  return (low + high) / 2;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 自 epoch 起的天序号（wall clock，UTC 字段），用于分桶。 */
  dayIndex: number;
}

/** 从 wall-clock epoch 取出"记录到的钟面时间"。 */
export function wallClock(timestamp: number): WallClock {
  const date = new Date(timestamp);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    dayIndex: Math.floor(timestamp / 86_400_000),
  };
}

/** 深夜窗口判定（起点 23 / 终点 5 表示 23:00–04:59）。 */
export function isLateNightHour(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

const QUESTION_RE = /[?¿؟]/;
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2764}\u{2665}]/u;

export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text);
}

export function hasQuestionMark(text: string): boolean {
  return QUESTION_RE.test(text);
}

/** 字符数（按 Unicode code point，emoji 计 1）。 */
export function charLength(text: string): number {
  return Array.from(text).length;
}

const TOKEN_SPLIT_RE = /[^a-z0-9\u00c0-\u024f\u0400-\u04ff\u4e00-\u9fff]+/;

/** 轻量分词（不引依赖）：小写 + 去变音 + 按非字母数字切分。 */
export function tokenizeText(text: string): string[] {
  return normalizeForMatching(text)
    .split(TOKEN_SPLIT_RE)
    .filter((token) => token.length >= 2);
}

/**
 * 停止词（en/es/de 高频虚词；中文不做分词，整段短语命中 top 词桶即可）。
 * 目的只是让"话题词频桶"不被 the/you/que 之类淹没。
 */
const STOPWORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "if", "to", "of", "in", "on", "at", "for", "with", "from",
  "i", "you", "he", "she", "it", "we", "they", "me", "my", "your", "our", "their", "his", "her",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "so", "just", "not",
  "no", "yes", "ok", "okay", "that", "this", "these", "those", "what", "when", "where", "who", "why",
  "how", "as", "have", "has", "had", "will", "would", "can", "could", "should", "get", "got", "go",
  "going", "gonna", "want", "like", "really", "very", "much", "about", "up", "out", "im", "dont",
  "its", "thats", "well", "yeah", "lol", "haha", "there", "here", "then", "than", "them", "too",
  "que", "de", "la", "el", "los", "las", "y", "en", "un", "una", "por", "para", "con", "sin", "pero",
  "si", "te", "se", "mi", "tu", "su", "es", "soy", "estoy", "eres", "esta", "esto", "eso", "lo", "le",
  "les", "al", "del", "como", "cuando", "donde", "porque", "bien", "ya", "mas", "muy",
  "der", "die", "das", "und", "oder", "aber", "wenn", "zu", "im", "auf", "fur", "mit", "ohne", "ich",
  "du", "er", "sie", "wir", "ihr", "mein", "dein", "ist", "bin", "bist", "sind", "war", "waren",
  "sein", "habe", "haben", "hat", "nicht", "kein", "keine", "nein", "dass", "wie", "was", "wer",
  "wo", "warum", "denn", "auch", "nur", "noch", "schon", "mal", "ja",
]);

/* -------------------------------------------------------------------------------------------------
 * 会话级统计（指标与依恋/健康度共用，避免重复扫描）
 * ------------------------------------------------------------------------------------------------*/

export interface RoleStats {
  role: SpeakerRole;
  messageCount: number;
  timedCount: number;
  /** 可分析文本消息数（kind=text 且去空白后非空）。 */
  textCount: number;
  questionCount: number;
  emojiCount: number;
  lateNightCount: number;
  /** 同一个人连续发送（还在等对方回复）的消息数。 */
  doubleTextCount: number;
  /** 归因到该角色的"回复时延"（ms）：对方消息 → 本条消息，且在同一个会话内。 */
  replyLatencies: number[];
  medianReplyMinutes: number | null;
  medianChars: number | null;
  shortMessageCount: number;
  conflictCount: number;
  repairCount: number;
  positiveCount: number;
  negativeCount: number;
  initiationCount: number;
  sessionsEnded: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

export interface ConversationStats {
  config: ResolvedMetricsConfig;
  totalMessages: number;
  timestampedCount: number;
  sessionCount: number;
  overallReplyLatencies: number[];
  overallMedianReplyMinutes: number | null;
  medianCharsBoth: number | null;
  /** top-N 词频桶（话题代理指标用）。 */
  topTerms: Array<{ term: string; count: number }>;
  user: RoleStats;
  partner: RoleStats;
}

function emptyRoleStats(role: SpeakerRole): RoleStats {
  return {
    role,
    messageCount: 0,
    timedCount: 0,
    textCount: 0,
    questionCount: 0,
    emojiCount: 0,
    lateNightCount: 0,
    doubleTextCount: 0,
    replyLatencies: [],
    medianReplyMinutes: null,
    medianChars: null,
    shortMessageCount: 0,
    conflictCount: 0,
    repairCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    initiationCount: 0,
    sessionsEnded: 0,
    firstTimestamp: null,
    lastTimestamp: null,
  };
}

/** 一次性扫描 Conversation，产出 10 项指标与依恋/健康度共用的统计量。 */
export function computeConversationStats(
  conversation: Conversation,
  configInput: MetricsConfig = {},
): ConversationStats {
  const config = resolveMetricsConfig(configInput);
  const user = emptyRoleStats("user");
  const partner = emptyRoleStats("partner");
  const byRole: Record<SpeakerRole, RoleStats> = { user, partner };
  const lengths: Record<SpeakerRole, number[]> = { user: [], partner: [] };
  const allLengths: number[] = [];
  const termCounts = new Map<string, number>();
  const messages = conversation.messages;

  let sessionCount = 0;
  let sessionLastRole: SpeakerRole | null = null;
  let timestampedCount = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] as ConversationMessage;
    const previous = index > 0 ? (messages[index - 1] as ConversationMessage) : null;
    const isBoundary =
      previous === null ||
      (message.timestamp !== null &&
        (previous.timestamp === null || message.timestamp - previous.timestamp > config.sessionGapMs));

    if (isBoundary) {
      if (previous !== null && sessionLastRole !== null) {
        byRole[sessionLastRole].sessionsEnded += 1;
      }
      sessionCount += 1;
      sessionLastRole = null;
      if (message.timestamp !== null) byRole[message.role].initiationCount += 1;
    }

    const role = byRole[message.role];
    role.messageCount += 1;
    sessionLastRole = message.role;

    if (previous !== null && !isBoundary) {
      if (previous.role === message.role) {
        role.doubleTextCount += 1;
      } else if (message.timestamp !== null && previous.timestamp !== null) {
        const latency = message.timestamp - previous.timestamp;
        if (latency >= 0) role.replyLatencies.push(latency);
      }
    }

    if (message.timestamp !== null) {
      timestampedCount += 1;
      role.timedCount += 1;
      if (role.firstTimestamp === null) role.firstTimestamp = message.timestamp;
      role.lastTimestamp = message.timestamp;
      if (
        isLateNightHour(
          wallClock(message.timestamp).hour,
          config.lateNightStartHour,
          config.lateNightEndHour,
        )
      ) {
        role.lateNightCount += 1;
      }
    }

    if (message.kind === "text" && message.text.trim().length > 0) {
      const text = message.text;
      role.textCount += 1;
      const length = charLength(text);
      lengths[message.role].push(length);
      allLengths.push(length);
      if (length <= config.shortMessageChars) role.shortMessageCount += 1;
      if (hasQuestionMark(text)) role.questionCount += 1;
      if (hasEmoji(text)) role.emojiCount += 1;

      const normalized = normalizeForMatching(text);
      const lexicon = countLexiconHits(normalized);
      role.conflictCount += lexicon.conflict;
      role.repairCount += lexicon.repair;
      role.positiveCount += lexicon.positive;
      role.negativeCount += lexicon.negative;

      for (const token of tokenizeText(text)) {
        if (STOPWORDS.has(token)) continue;
        termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
      }
    }
  }

  if (sessionLastRole !== null) byRole[sessionLastRole].sessionsEnded += 1;

  for (const role of [user, partner]) {
    const roleLatencies = role.replyLatencies;
    const minutes = roleLatencies.map((ms) => ms / 60_000);
    role.medianReplyMinutes = minutes.length > 0 ? roundTo(median(minutes) ?? 0, 2) : null;
    role.medianChars = lengths[role.role].length > 0 ? roundTo(median(lengths[role.role]) ?? 0, 1) : null;
  }

  const overallLatencies = [...user.replyLatencies, ...partner.replyLatencies];
  const overallMinutes = overallLatencies.map((ms) => ms / 60_000);
  const topTerms = [...termCounts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => (b.count - a.count) || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, config.topicTopTerms);

  return {
    config,
    totalMessages: messages.length,
    timestampedCount,
    sessionCount,
    overallReplyLatencies: overallLatencies,
    overallMedianReplyMinutes: overallMinutes.length > 0 ? roundTo(median(overallMinutes) ?? 0, 2) : null,
    medianCharsBoth: allLengths.length > 0 ? roundTo(median(allLengths) ?? 0, 1) : null,
    topTerms,
    user,
    partner,
  };
}

/* -------------------------------------------------------------------------------------------------
 * 指标实现
 * ------------------------------------------------------------------------------------------------*/

function confidenceFromSample(sampleSize: number, reliableAt: number): number {
  if (sampleSize <= 0) return 0;
  return roundTo(Math.sqrt(Math.min(1, sampleSize / reliableAt)), 2);
}

function unavailable(
  id: MetricId,
  label: string,
  unit: MetricUnit,
  reason: UnavailableReason,
  explain: string,
  proxy = false,
  sampleSize = 0,
): MetricResult {
  return {
    id,
    label,
    value: null,
    unit,
    sampleSize,
    confidence: 0,
    proxy,
    explain,
    details: {},
    unavailableReason: reason,
  };
}

interface TopicSwitchComputation {
  pairs: number;
  switches: number;
  meanRunLength: number | null;
  bucketCount: number;
  topTerms: string[];
}

/** 话题切换代理：top-N 词频桶序列的切换率（PRD v1.1 明示 embedding → 词频桶）。 */
function computeTopicSwitch(
  conversation: Conversation,
  stats: ConversationStats,
): TopicSwitchComputation | null {
  const config = stats.config;
  const textMessages = conversation.messages.filter(
    (message) => message.kind === "text" && message.text.trim().length > 0,
  );
  if (textMessages.length < 8) return null;
  if (stats.topTerms.length < 3) return null;

  const top = stats.topTerms;
  const topIndex = new Map<string, { term: string; count: number }>();
  for (const entry of top) topIndex.set(entry.term, entry);

  const bucketOf = (message: ConversationMessage): string | null => {
    let best: { term: string; count: number } | null = null;
    const seen = new Set<string>();
    for (const token of tokenizeText(message.text)) {
      if (seen.has(token)) continue;
      seen.add(token);
      const entry = topIndex.get(token);
      if (!entry) continue;
      if (
        best === null ||
        entry.count > best.count ||
        (entry.count === best.count && entry.term < best.term)
      ) {
        best = entry;
      }
    }
    return best?.term ?? null;
  };

  let pairs = 0;
  let switches = 0;
  let totalInRuns = 0;
  let runCount = 0;
  let runBucket: string | null = null;
  let runLength = 0;
  let previousComparable: string | null = null;

  const finalizeRun = () => {
    if (runLength > 0) {
      totalInRuns += runLength;
      runCount += 1;
    }
    runBucket = null;
    runLength = 0;
  };

  for (let index = 0; index < textMessages.length; index += 1) {
    const message = textMessages[index] as ConversationMessage;
    const previous = index > 0 ? (textMessages[index - 1] as ConversationMessage) : null;
    const sessionBreak =
      index > 0 &&
      message.timestamp !== null &&
      previous !== null &&
      previous.timestamp !== null &&
      message.timestamp - previous.timestamp > config.sessionGapMs;
    if (sessionBreak) {
      finalizeRun();
      previousComparable = null;
    }

    const bucket = bucketOf(message);
    if (bucket === null) {
      finalizeRun();
      continue;
    }
    if (runBucket === null) {
      runBucket = bucket;
      runLength = 1;
    } else if (runBucket === bucket) {
      runLength += 1;
    } else {
      finalizeRun();
      runBucket = bucket;
      runLength = 1;
    }

    if (previousComparable !== null) {
      pairs += 1;
      if (previousComparable !== bucket) switches += 1;
    }
    previousComparable = bucket;
  }
  finalizeRun();

  return {
    pairs,
    switches,
    meanRunLength: runCount > 0 ? roundTo(totalInRuns / runCount, 2) : null,
    bucketCount: new Set(top.map((entry) => entry.term)).size,
    topTerms: top.slice(0, 8).map((entry) => `${entry.term}:${entry.count}`),
  };
}

// 局部别名：仅用于让上面的 previous 取值类型更直观

interface ConsistencyComputation {
  bucketDays: number;
  bucketCount: number;
  cv: number;
  drift: number;
  longestSilenceBuckets: number;
  value: number;
}

/**
 * 投入一致性（0-100，越高越稳定）：
 * - 按周桶（跨度 <21 天自动按天）统计双方各桶消息量；
 * - cv = 桶总量的变异系数（断档/忽冷忽热 ↑）；
 * - drift = 非空桶里"你的占比"的标准差（投入失衡漂移 ↑）；
 * - consistency = clamp(1 − 0.45·min(cv,2) − 1.2·drift, 0, 1) × 100。
 */
function computeConsistency(
  conversation: Conversation,
  stats: ConversationStats,
): ConsistencyComputation | null {
  if (conversation.user.messageCount === 0 || conversation.partner.messageCount === 0) return null;
  const timed = conversation.messages.filter(
    (message): message is ConversationMessage & { timestamp: number } => message.timestamp !== null,
  );
  if (timed.length < 2) return null;

  const startTimestamp = timed[0]?.timestamp as number;
  const endTimestamp = timed[timed.length - 1]?.timestamp as number;
  const spanDays = (endTimestamp - startTimestamp) / 86_400_000;
  const bucketDays = spanDays >= 21 ? stats.config.consistencyBucketDays : 1;
  const bucketCount = Math.floor(spanDays / bucketDays) + 1;
  if (bucketCount < 3) return null;

  const userCounts = new Array<number>(bucketCount).fill(0);
  const totals = new Array<number>(bucketCount).fill(0);
  for (const message of timed) {
    const offsetDays = (message.timestamp - startTimestamp) / 86_400_000;
    const bucket = Math.min(bucketCount - 1, Math.floor(offsetDays / bucketDays));
    if (bucket < 0) continue;
    totals[bucket] = (totals[bucket] ?? 0) + 1;
    if (message.role === "user") userCounts[bucket] = (userCounts[bucket] ?? 0) + 1;
  }

  const meanTotal = totals.reduce((a, b) => a + b, 0) / bucketCount;
  const variance = totals.reduce((sum, total) => sum + (total - meanTotal) ** 2, 0) / bucketCount;
  const cv = meanTotal > 0 ? Math.sqrt(variance) / meanTotal : 0;

  const shares = totals
    .map((total, index) => ({ total, user: userCounts[index] ?? 0 }))
    .filter((bucket) => bucket.total > 0)
    .map((bucket) => bucket.user / bucket.total);
  const meanShare = shares.reduce((a, b) => a + b, 0) / Math.max(1, shares.length);
  const drift =
    shares.length > 0
      ? Math.sqrt(shares.reduce((sum, share) => sum + (share - meanShare) ** 2, 0) / shares.length)
      : 0;

  let longestSilenceBuckets = 0;
  let currentSilence = 0;
  for (const total of totals) {
    if (total === 0) {
      currentSilence += 1;
      longestSilenceBuckets = Math.max(longestSilenceBuckets, currentSilence);
    } else {
      currentSilence = 0;
    }
  }

  const value = clamp01(1 - 0.45 * Math.min(cv, 2) - 1.2 * drift) * 100;
  return { bucketDays, bucketCount, cv: roundTo(cv, 3), drift: roundTo(drift, 3), longestSilenceBuckets, value: roundTo(value, 2) };
}

/** 计算 PRD 10 项指标。同输入结果完全确定（无 Date.now / 随机）。 */
export function computeMetrics(conversation: Conversation, config: MetricsConfig = {}): MetricsBundle {
  const stats = computeConversationStats(conversation, config);
  const { user, partner } = stats;
  const total = stats.totalMessages;
  const coverageFactor = 0.5 + 0.5 * (total > 0 ? stats.timestampedCount / total : 0);
  const textDenominator = user.textCount + partner.textCount;

  const metrics = {} as Record<MetricId, MetricResult>;

  // 1) 回复中位时延 = median(每条"对方消息 → 本消息"的间隔)，单位分钟。
  const replySamples = stats.overallReplyLatencies.length;
  metrics.reply_median_latency =
    replySamples === 0
      ? unavailable(
          "reply_median_latency",
          "Reply pace",
          "minutes",
          stats.timestampedCount === 0 ? "no-timestamps" : "insufficient-sample",
          "Median minutes between a message and the next reply from the other person (same session, gap ≤ 6 h).",
        )
      : {
          id: "reply_median_latency",
          label: "Reply pace",
          value: stats.overallMedianReplyMinutes,
          unit: "minutes",
          sampleSize: replySamples,
          confidence: roundTo(confidenceFromSample(replySamples, 20) * coverageFactor, 2),
          proxy: false,
          explain:
            "For every sender change inside a session (gap ≤ 6 h): latency = current message time − previous message time. Value = median of all such latencies, in minutes. Also reported per side.",
          details: {
            userMedianMinutes: user.medianReplyMinutes,
            partnerMedianMinutes: partner.medianReplyMinutes,
            userReplySamples: user.replyLatencies.length,
            partnerReplySamples: partner.replyLatencies.length,
            shareWithin15Min: roundTo(
              stats.overallReplyLatencies.filter((ms) => ms <= 15 * 60_000).length / replySamples,
              3,
            ),
          },
        };

  // 2) double-text 率 = 同一人连续发送（对方尚未回复）的消息数 / 总消息数。
  metrics.double_text_rate =
    total < 4
      ? unavailable(
          "double_text_rate",
          "Double texts",
          "ratio",
          "insufficient-sample",
          "Messages sent while still waiting for a reply ÷ all messages.",
        )
      : {
          id: "double_text_rate",
          label: "Double texts",
          value: roundTo((user.doubleTextCount + partner.doubleTextCount) / total, 4),
          unit: "ratio",
          sampleSize: total,
          confidence: confidenceFromSample(total, 30),
          proxy: false,
          explain:
            "A message counts as a double text when the previous message in the same session was sent by the same person. Value = double texts ÷ all messages (per side available in details).",
          details: {
            userRate: user.messageCount > 0 ? roundTo(user.doubleTextCount / user.messageCount, 4) : null,
            partnerRate: partner.messageCount > 0 ? roundTo(partner.doubleTextCount / partner.messageCount, 4) : null,
            userDoubleTexts: user.doubleTextCount,
            partnerDoubleTexts: partner.doubleTextCount,
          },
        };

  // 3) 发起比 = 你开启的会话数 / 会话总数（会话 = 间隔 >6h 切分）。
  metrics.initiation_ratio =
    stats.timestampedCount === 0 || stats.sessionCount < 2
      ? unavailable(
          "initiation_ratio",
          "Who starts conversations",
          "ratio",
          stats.timestampedCount === 0 ? "no-timestamps" : "insufficient-sample",
          "Sessions start when the gap from the previous message is over 6 h. Value = sessions you started ÷ all sessions.",
        )
      : {
          id: "initiation_ratio",
          label: "Who starts conversations",
          value: roundTo(user.initiationCount / stats.sessionCount, 4),
          unit: "ratio",
          sampleSize: stats.sessionCount,
          confidence: roundTo(confidenceFromSample(stats.sessionCount, 8) * coverageFactor, 2),
          proxy: false,
          explain:
            "Session boundary = gap > 6 h between consecutive messages. Initiator = first sender of the session. Value = sessions started by you ÷ all timed sessions.",
          details: {
            userSessions: user.initiationCount,
            partnerSessions: partner.initiationCount,
            sessions: stats.sessionCount,
          },
        };

  // 4) 长度比 = 双方消息字符数中位数之比（你 / 对方）。
  metrics.length_ratio =
    user.medianChars === null || partner.medianChars === null || partner.medianChars <= 0
      ? unavailable(
          "length_ratio",
          "Message length balance",
          "ratio",
          "insufficient-sample",
          "Ratio of median message length (Unicode characters) — you ÷ your partner.",
        )
      : {
          id: "length_ratio",
          label: "Message length balance",
          value: roundTo(user.medianChars / partner.medianChars, 2),
          unit: "ratio",
          sampleSize: user.textCount + partner.textCount,
          confidence: confidenceFromSample(textDenominator, 20),
          proxy: false,
          explain:
            "Median length (Unicode characters, emoji = 1) of non-empty text messages per side; value = your median ÷ your partner's median. Media/deleted/call placeholders are excluded.",
          details: {
            userMedianChars: user.medianChars,
            partnerMedianChars: partner.medianChars,
            userTextMessages: user.textCount,
            partnerTextMessages: partner.textCount,
          },
        };

  // 5) 问句率 = 含 ?/¿/؟ 的消息数 / 文本消息数。
  metrics.question_rate =
    textDenominator === 0
      ? unavailable(
          "question_rate",
          "Questions asked",
          "ratio",
          "insufficient-sample",
          "Messages containing ? / ¿ / ؟ ÷ all non-empty text messages.",
        )
      : {
          id: "question_rate",
          label: "Questions asked",
          value: roundTo((user.questionCount + partner.questionCount) / textDenominator, 4),
          unit: "ratio",
          sampleSize: textDenominator,
          confidence: confidenceFromSample(textDenominator, 30),
          proxy: false,
          explain:
            "A message counts as a question if it contains ? / ¿ / ؟. Value = questions ÷ non-empty text messages (per side in details).",
          details: {
            userRate: user.textCount > 0 ? roundTo(user.questionCount / user.textCount, 4) : null,
            partnerRate: partner.textCount > 0 ? roundTo(partner.questionCount / partner.textCount, 4) : null,
          },
        };

  // 6) emoji 率 = 含 emoji 的消息数 / 文本消息数。
  metrics.emoji_rate =
    textDenominator === 0
      ? unavailable(
          "emoji_rate",
          "Emoji use",
          "ratio",
          "insufficient-sample",
          "Messages containing at least one emoji ÷ all non-empty text messages.",
        )
      : {
          id: "emoji_rate",
          label: "Emoji use",
          value: roundTo((user.emojiCount + partner.emojiCount) / textDenominator, 4),
          unit: "ratio",
          sampleSize: textDenominator,
          confidence: confidenceFromSample(textDenominator, 30),
          proxy: false,
          explain:
            "Message-level emoji presence (Unicode emoji ranges). Value = emoji-bearing messages ÷ non-empty text messages.",
          details: {
            userRate: user.textCount > 0 ? roundTo(user.emojiCount / user.textCount, 4) : null,
            partnerRate: partner.textCount > 0 ? roundTo(partner.emojiCount / partner.textCount, 4) : null,
          },
        };

  // 7) 深夜集中度 = 23:00-04:59 的消息数 / 有时间戳的消息数。
  metrics.late_night_share =
    stats.timestampedCount === 0
      ? unavailable(
          "late_night_share",
          "Late-night messages",
          "ratio",
          "no-timestamps",
          "Messages sent between 23:00 and 04:59 ÷ all timestamped messages.",
        )
      : {
          id: "late_night_share",
          label: "Late-night messages",
          value: roundTo((user.lateNightCount + partner.lateNightCount) / stats.timestampedCount, 4),
          unit: "ratio",
          sampleSize: stats.timestampedCount,
          confidence: roundTo(confidenceFromSample(stats.timestampedCount, 30) * coverageFactor, 2),
          proxy: false,
          explain:
            "Calendar window: 23:00–04:59, from the recorded wall-clock time (no timezone conversion). Value = late-night messages ÷ timestamped messages.",
          details: {
            userRate: user.timedCount > 0 ? roundTo(user.lateNightCount / user.timedCount, 4) : null,
            partnerRate: partner.timedCount > 0 ? roundTo(partner.lateNightCount / partner.timedCount, 4) : null,
            window: "23:00-04:59",
          },
        };

  // 8) 话题切换代理（PRD v1.1：embedding → top-20 词频桶）。
  const topic = computeTopicSwitch(conversation, stats);
  metrics.topic_switch_proxy =
    topic === null || topic.pairs < 4
      ? unavailable(
          "topic_switch_proxy",
          "Topic switching",
          "ratio",
          "insufficient-sample",
          "Top-20 term-frequency buckets; value = adjacent message pairs whose dominant bucket changed ÷ comparable pairs.",
          true,
        )
      : {
          id: "topic_switch_proxy",
          label: "Topic switching",
          value: roundTo(topic.switches / topic.pairs, 4),
          unit: "ratio",
          sampleSize: topic.pairs,
          confidence: roundTo(confidenceFromSample(topic.pairs, 40) * 0.8, 2),
          proxy: true,
          explain:
            "PROXY (PRD v1.1 downgraded embedding clustering to word-frequency buckets): tokenize text messages, keep the top-20 terms, assign each message to its strongest term bucket, then measure how often the bucket changes between adjacent messages in the same session.",
          details: {
            switches: topic.switches,
            comparablePairs: topic.pairs,
            meanRunLength: topic.meanRunLength,
            buckets: topic.bucketCount,
            topTerms: topic.topTerms.join(", "),
          },
        };

  // 9) 冲突/修复词频 = 命中冲突词的消息数 / 1000 条文本消息；修复词频同理。
  metrics.conflict_repair_freq =
    textDenominator === 0
      ? unavailable(
          "conflict_repair_freq",
          "Conflict and repair",
          "per_1k_messages",
          "insufficient-sample",
          "Lexicon hits per 1,000 non-empty text messages (conflict value; repair in details).",
          true,
        )
      : {
          id: "conflict_repair_freq",
          label: "Conflict and repair",
          value: roundTo(((user.conflictCount + partner.conflictCount) / textDenominator) * 1000, 2),
          unit: "per_1k_messages",
          sampleSize: textDenominator,
          confidence: confidenceFromSample(textDenominator, 50),
          proxy: true,
          explain:
            "PROXY with lexicon_v0-draft (en/es/de keyword lists, founder-owned v1 pending): conflict hits per 1,000 text messages is the value; repair hits per 1,000 and repair÷(conflict+repair) are in details.",
          details: {
            repairPer1k: roundTo(((user.repairCount + partner.repairCount) / textDenominator) * 1000, 2),
            conflictCount: user.conflictCount + partner.conflictCount,
            repairCount: user.repairCount + partner.repairCount,
            repairToConflictRatio:
              user.conflictCount + partner.conflictCount + user.repairCount + partner.repairCount > 0
                ? roundTo(
                    (user.repairCount + partner.repairCount) /
                      (user.conflictCount + partner.conflictCount + user.repairCount + partner.repairCount),
                    3,
                  )
                : null,
          },
        };

  // 10) 投入一致性（0-100）。
  const consistency = computeConsistency(conversation, stats);
  metrics.investment_consistency =
    consistency === null
      ? unavailable(
          "investment_consistency",
          "Investment consistency",
          "score",
          total === 0
            ? "no-messages"
            : stats.timestampedCount === 0
              ? "no-timestamps"
              : user.messageCount === 0 || partner.messageCount === 0
                ? "one-sided"
                : "insufficient-sample",
          "Weekly buckets: consistency = clamp(1 − 0.45·min(CV,2) − 1.2·drift, 0, 1) × 100, where CV = coefficient of variation of bucket totals and drift = std-dev of your share across non-empty buckets.",
        )
      : {
          id: "investment_consistency",
          label: "Investment consistency",
          value: consistency.value,
          unit: "score",
          sampleSize: consistency.bucketCount,
          confidence: roundTo(confidenceFromSample(consistency.bucketCount, 6) * coverageFactor, 2),
          proxy: false,
          explain:
            "Split the conversation into weekly buckets (daily if the span is under 21 days); CV = std-dev ÷ mean of bucket totals (dips/gaps raise it); drift = std-dev of your message share across non-empty buckets. Score = clamp(1 − 0.45·min(CV,2) − 1.2·drift, 0, 1) × 100.",
          details: {
            bucketUnit: consistency.bucketDays === 7 ? "week" : "day",
            bucketDays: consistency.bucketDays,
            bucketCount: consistency.bucketCount,
            cv: consistency.cv,
            drift: consistency.drift,
            longestSilenceBuckets: consistency.longestSilenceBuckets,
          },
        };

  return { version: METRICS_VERSION, config: stats.config, metrics };
}
