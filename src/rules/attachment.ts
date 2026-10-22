/**
 * 依恋方向判定（M1 · FR-3 依恋预览 / §5.2 Ch.2 事实层）
 *
 * 规则引擎产出**方向标签**（anxious / avoidant / secure / mixed），LLM 只做措辞、不得改方向
 * （PRD AC-3.2：规则单源，方向不一致 = P0 bug）。
 *
 * ⚠️ 这是**行为信号代理实现**，不是心理诊断：
 * - PRD 只规定"方向由规则引擎确定 + 双人对照卡三维细分 + 证据引用"，未写死公式。
 *   本文件的权重是 M1 可校准初值（`ruleVersion: attachment_v1`），M2 黄金集评审时按证据调整。
 * - 证据纪律：每条信号都带 `messageIds`（必须是会话里真实存在的 mN id）+ `explain`；
 *   没有证据的信号 messageIds 为空数组，不得在报告里伪装成"有证据"。
 * - 纯函数、零随机、零 Date.now：同输入两次调用完全一致。
 */
import type { Conversation, ConversationMessage, SpeakerRole } from "../parser/types";
import { countLexiconHits, normalizeForMatching } from "./lexicons";
import { clamp01, computeConversationStats, computeMetrics, roundTo } from "./metrics";
import type { MetricsBundle } from "./metrics";

export const ATTACHMENT_RULE_VERSION = "attachment_v1";

export type AttachmentDirection = "anxious" | "avoidant" | "secure" | "mixed";

export const ATTACHMENT_LABELS: Readonly<Record<AttachmentDirection, string>> = {
  anxious: "Anxious-leaning",
  avoidant: "Avoidant-leaning",
  secure: "Secure-leaning",
  mixed: "Mixed signals",
};

export interface AttachmentScores {
  anxious: number;
  avoidant: number;
  secure: number;
}

export interface AttachmentSignal {
  id: string;
  label: string;
  /** 该信号指向的方向（secure 信号 = 平衡/修复类证据）。 */
  direction: AttachmentDirection;
  weight: number;
  /** 0..1 归一化强度。 */
  value: number;
  /** 对总分的贡献（weight × value × 100）。 */
  contribution: number;
  explain: string;
  /** 证据消息 id（真实存在，最多 3 条）；空数组 = 汇总型信号。 */
  messageIds: string[];
}

export interface AttachmentAssessment {
  role: SpeakerRole;
  direction: AttachmentDirection;
  label: string;
  confidence: number;
  scores: AttachmentScores;
  sampleSize: number;
  signals: AttachmentSignal[];
}

export interface AttachmentReport {
  ruleVersion: typeof ATTACHMENT_RULE_VERSION;
  user: AttachmentAssessment;
  partner: AttachmentAssessment;
}

interface RoleFeatures {
  own: {
    doubleRate: number;
    volumeShare: number;
    initShare: number | null;
    lateShare: number | null;
    questionRate: number | null;
    emojiRate: number | null;
    endShare: number | null;
    medianChars: number | null;
    medianReply: number | null;
    repairRatio: number | null;
  };
  other: {
    doubleRate: number;
    volumeShare: number;
    questionRate: number | null;
    endShare: number | null;
    medianChars: number | null;
    medianReply: number | null;
  };
  totalMessages: number;
  sessionCount: number;
  overallMedianReply: number | null;
}

function featuresFor(conversation: Conversation, role: SpeakerRole): RoleFeatures {
  const stats = computeConversationStats(conversation);
  const own = role === "user" ? stats.user : stats.partner;
  const other = role === "user" ? stats.partner : stats.user;
  const total = stats.totalMessages;
  const lexiconTotal = own.conflictCount + own.repairCount;

  return {
    own: {
      doubleRate: own.messageCount > 0 ? own.doubleTextCount / own.messageCount : 0,
      volumeShare: total > 0 ? own.messageCount / total : 0,
      initShare: stats.sessionCount > 0 ? own.initiationCount / stats.sessionCount : null,
      lateShare: own.timedCount > 0 ? own.lateNightCount / own.timedCount : null,
      questionRate: own.textCount > 0 ? own.questionCount / own.textCount : null,
      emojiRate: own.textCount > 0 ? own.emojiCount / own.textCount : null,
      endShare: stats.sessionCount > 0 ? own.sessionsEnded / stats.sessionCount : null,
      medianChars: own.medianChars,
      medianReply: own.medianReplyMinutes,
      repairRatio: lexiconTotal > 0 ? own.repairCount / lexiconTotal : null,
    },
    other: {
      doubleRate: other.messageCount > 0 ? other.doubleTextCount / other.messageCount : 0,
      volumeShare: total > 0 ? other.messageCount / total : 0,
      questionRate: other.textCount > 0 ? other.questionCount / other.textCount : null,
      endShare: stats.sessionCount > 0 ? other.sessionsEnded / stats.sessionCount : null,
      medianChars: other.medianChars,
      medianReply: other.medianReplyMinutes,
    },
    totalMessages: total,
    sessionCount: stats.sessionCount,
    overallMedianReply: stats.overallMedianReplyMinutes,
  };
}

/* -------------------------------------------------------------------------------------------------
 * 证据收集（确定：按源顺序 + 明确的排序键，最多 3 条 id）
 * ------------------------------------------------------------------------------------------------*/

interface SessionFlags {
  boundary: boolean[];
  lateNight: (message: ConversationMessage) => boolean;
}

function sessionFlags(conversation: Conversation): SessionFlags {
  const config = {
    gapMs: 6 * 60 * 60 * 1000,
  };
  const boundary: boolean[] = [];
  conversation.messages.forEach((message, index) => {
    const previous = index > 0 ? conversation.messages[index - 1] : null;
    boundary.push(
      previous === undefined ||
        previous === null ||
        (message.timestamp !== null &&
          (previous.timestamp === null || message.timestamp - previous.timestamp > config.gapMs)),
    );
  });
  return {
    boundary,
    lateNight: (message) => {
      if (message.timestamp === null) return false;
      const hour = new Date(message.timestamp).getUTCHours();
      return hour >= 23 || hour < 5;
    },
  };
}

function takeIds(messages: ConversationMessage[], limit = 3): string[] {
  return messages.slice(0, limit).map((message) => message.id);
}

function replyEvidence(conversation: Conversation, role: SpeakerRole, slowest: boolean): string[] {
  const flags = sessionFlags(conversation);
  const candidates: Array<{ id: string; latency: number; index: number }> = [];
  conversation.messages.forEach((message, index) => {
    if (message.role !== role || index === 0 || flags.boundary[index]) return;
    const previous = conversation.messages[index - 1] as ConversationMessage;
    if (previous.role === role) return;
    if (message.timestamp === null || previous.timestamp === null) return;
    candidates.push({ id: message.id, latency: message.timestamp - previous.timestamp, index });
  });
  candidates.sort((a, b) =>
    slowest ? b.latency - a.latency || a.index - b.index : a.latency - b.latency || a.index - b.index,
  );
  return candidates.slice(0, 3).map((candidate) => candidate.id);
}

function doubleTextEvidence(conversation: Conversation, role: SpeakerRole): string[] {
  const flags = sessionFlags(conversation);
  const ids: string[] = [];
  conversation.messages.forEach((message, index) => {
    if (message.role !== role || index === 0 || flags.boundary[index]) return;
    const previous = conversation.messages[index - 1] as ConversationMessage;
    if (previous.role === role) ids.push(message.id);
  });
  return ids.slice(0, 3);
}

function sessionStartEvidence(conversation: Conversation, role: SpeakerRole): string[] {
  const flags = sessionFlags(conversation);
  const ids: string[] = [];
  conversation.messages.forEach((message, index) => {
    if (!flags.boundary[index] || message.role !== role || message.timestamp === null) return;
    ids.push(message.id);
  });
  return ids.slice(0, 3);
}

function sessionEndEvidence(conversation: Conversation, role: SpeakerRole): string[] {
  const flags = sessionFlags(conversation);
  const ids: string[] = [];
  conversation.messages.forEach((message, index) => {
    if (message.role !== role) return;
    const next = conversation.messages[index + 1];
    if (!next || flags.boundary[index + 1]) ids.push(message.id);
  });
  return ids.slice(0, 3);
}

function lateNightEvidence(conversation: Conversation, role: SpeakerRole): string[] {
  const flags = sessionFlags(conversation);
  return takeIds(
    conversation.messages.filter((message) => message.role === role && flags.lateNight(message)),
  );
}

function messageTextEvidence(
  conversation: Conversation,
  role: SpeakerRole,
  predicate: (message: ConversationMessage) => boolean,
): string[] {
  return takeIds(conversation.messages.filter((message) => message.role === role && predicate(message)));
}

function lengthEvidence(conversation: Conversation, role: SpeakerRole, shortest: boolean): string[] {
  const candidates = conversation.messages
    .map((message, index) => ({ message, index, length: Array.from(message.text).length }))
    .filter(({ message }) => message.role === role && message.kind === "text" && message.text.trim().length > 0);
  candidates.sort((a, b) =>
    shortest ? a.length - b.length || a.index - b.index : b.length - a.length || a.index - b.index,
  );
  return candidates.slice(0, 3).map((candidate) => candidate.message.id);
}

function lexiconEvidence(
  conversation: Conversation,
  role: SpeakerRole,
  kind: "conflict" | "repair",
): string[] {
  return messageTextEvidence(conversation, role, (message) => {
    if (message.kind !== "text" || message.text.trim().length === 0) return false;
    const counts = countLexiconHits(normalizeForMatching(message.text));
    return counts[kind] > 0;
  });
}

/* -------------------------------------------------------------------------------------------------
 * 打分
 * ------------------------------------------------------------------------------------------------*/

function weighted(components: Array<{ value: number; weight: number }>): number {
  const sum = components.reduce((total, component) => total + component.value * component.weight, 0);
  return roundTo(clamp01(sum) * 100, 1);
}

/** 方向分类：最高分领先第二名 < margin（默认 8 分）→ mixed；否则取最高分。 */
export function classifyDirection(scores: AttachmentScores, margin = 8): AttachmentDirection {
  const ordered: Array<[AttachmentDirection, number]> = [
    ["secure", scores.secure],
    ["anxious", scores.anxious],
    ["avoidant", scores.avoidant],
  ];
  ordered.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ordered[0] as [AttachmentDirection, number];
  const second = ordered[1] as [AttachmentDirection, number];
  if (top[1] - second[1] < margin) return "mixed";
  return top[0];
}

function assessOne(
  conversation: Conversation,
  role: SpeakerRole,
  metrics: MetricsBundle,
  features: RoleFeatures,
): AttachmentAssessment {
  const own = features.own;
  const other = features.other;
  const total = features.totalMessages;

  const latencyEdge =
    own.medianReply !== null && other.medianReply !== null && other.medianReply > 0
      ? clamp01((other.medianReply - own.medianReply) / other.medianReply)
      : 0.5;
  const latencyLag =
    own.medianReply !== null && other.medianReply !== null && own.medianReply > 0
      ? clamp01((own.medianReply - other.medianReply) / own.medianReply)
      : 0.5;
  const latencyBalance =
    own.medianReply !== null && other.medianReply !== null
      ? 1 - clamp01(Math.abs(own.medianReply - other.medianReply) / Math.max(own.medianReply, other.medianReply, 1))
      : 0.5;

  const doubleNorm = total >= 4 ? clamp01(own.doubleRate / 0.35) : 0.5;
  const volumeNorm = clamp01((own.volumeShare - 0.5) / 0.5);
  const initNorm = own.initShare === null ? 0.5 : clamp01((own.initShare - 0.5) / 0.5);
  const lateNorm = own.lateShare === null ? 0.5 : clamp01(own.lateShare / 0.35);
  const questionNorm = own.questionRate === null ? 0.5 : clamp01(own.questionRate / 0.45);
  const emojiNorm = own.emojiRate === null ? 0.5 : clamp01(own.emojiRate / 0.4);
  const lowDoubleNorm =
    total >= 4
      ? clamp01((other.doubleRate - own.doubleRate) / Math.max(other.doubleRate, 0.1))
      : 0.5;
  const shortNorm =
    own.medianChars !== null && other.medianChars !== null && other.medianChars > 0
      ? clamp01((other.medianChars - own.medianChars) / other.medianChars)
      : 0.5;
  // 会话结束倾向用"相对对方"的差值：平衡关系里单会话由谁收尾没有信息量。
  const endNorm =
    features.sessionCount < 2 || own.endShare === null || other.endShare === null
      ? 0.5
      : clamp01((own.endShare - other.endShare) / 0.5);
  const lowQuestionNorm =
    own.questionRate === null || other.questionRate === null
      ? 0.5
      : clamp01((other.questionRate - own.questionRate) / Math.max(other.questionRate, 0.1));
  const lowVolumeNorm = clamp01((other.volumeShare - own.volumeShare) / 0.5);
  const volumeBalance = 1 - clamp01(Math.abs(own.volumeShare - 0.5) / 0.5);
  const initBalance = own.initShare === null ? 0.5 : 1 - clamp01(Math.abs(own.initShare - 0.5) / 0.5);
  const repairQuality = own.repairRatio ?? 0.5;
  const consistencyNorm =
    metrics.metrics.investment_consistency.value === null
      ? 0.5
      : clamp01(metrics.metrics.investment_consistency.value / 100);
  const responsivenessAbs =
    features.overallMedianReply === null ? 0.5 : clamp01(1 - features.overallMedianReply / 720);

  const anxious = weighted([
    { value: latencyEdge, weight: 0.2 },
    { value: doubleNorm, weight: 0.2 },
    { value: volumeNorm, weight: 0.15 },
    { value: initNorm, weight: 0.15 },
    { value: lateNorm, weight: 0.1 },
    { value: questionNorm, weight: 0.1 },
    { value: emojiNorm, weight: 0.1 },
  ]);
  const avoidant = weighted([
    { value: latencyLag, weight: 0.25 },
    { value: lowDoubleNorm, weight: 0.15 },
    { value: shortNorm, weight: 0.15 },
    { value: endNorm, weight: 0.15 },
    { value: lowQuestionNorm, weight: 0.15 },
    { value: lowVolumeNorm, weight: 0.15 },
  ]);
  const secure = weighted([
    { value: latencyBalance, weight: 0.2 },
    { value: volumeBalance, weight: 0.15 },
    { value: initBalance, weight: 0.15 },
    { value: repairQuality, weight: 0.15 },
    { value: consistencyNorm, weight: 0.15 },
    { value: responsivenessAbs, weight: 0.2 },
  ]);

  const scores: AttachmentScores = { anxious, avoidant, secure };
  const direction = classifyDirection(scores);
  const ordered = [anxious, avoidant, secure].sort((a, b) => b - a);
  const margin = (ordered[0] as number) - (ordered[1] as number);
  const sampleFactor = clamp01(Math.sqrt(Math.min(1, total / 300)));
  const coverage = total > 0 ? conversation.meta.timestampCoverage : 0;
  const marginFactor = clamp01(0.6 + margin / 50);
  const confidence = roundTo(clamp01(sampleFactor * (0.55 + 0.45 * coverage) * marginFactor), 2);

  const signals: AttachmentSignal[] = [
    {
      id: "fast_reply",
      label: "Replies faster than the other person",
      direction: "anxious",
      weight: 0.2,
      value: roundTo(latencyEdge, 3),
      contribution: roundTo(latencyEdge * 0.2 * 100, 1),
      explain: "Relative gap between your median reply time and theirs (faster replies score toward anxious).",
      messageIds: replyEvidence(conversation, role, false),
    },
    {
      id: "double_text",
      label: "Sends follow-up messages before a reply",
      direction: "anxious",
      weight: 0.2,
      value: roundTo(doubleNorm, 3),
      contribution: roundTo(doubleNorm * 0.2 * 100, 1),
      explain: "Share of your messages sent while the previous message in the same session was also yours.",
      messageIds: doubleTextEvidence(conversation, role),
    },
    {
      id: "volume_share",
      label: "Carries more of the message volume",
      direction: "anxious",
      weight: 0.15,
      value: roundTo(volumeNorm, 3),
      contribution: roundTo(volumeNorm * 0.15 * 100, 1),
      explain: "Your share of all messages above an even split.",
      messageIds: messageTextEvidence(conversation, role, () => true).slice(0, 3),
    },
    {
      id: "initiation_share",
      label: "Starts more conversations",
      direction: "anxious",
      weight: 0.15,
      value: roundTo(initNorm, 3),
      contribution: roundTo(initNorm * 0.15 * 100, 1),
      explain: "Sessions you started (gap > 6 h) above an even split.",
      messageIds: sessionStartEvidence(conversation, role),
    },
    {
      id: "late_night",
      label: "More late-night messages",
      direction: "anxious",
      weight: 0.1,
      value: roundTo(lateNorm, 3),
      contribution: roundTo(lateNorm * 0.1 * 100, 1),
      explain: "Your share of 23:00–04:59 messages, normalized to 35%.",
      messageIds: lateNightEvidence(conversation, role),
    },
    {
      id: "questions",
      label: "Asks more questions",
      direction: "anxious",
      weight: 0.1,
      value: roundTo(questionNorm, 3),
      contribution: roundTo(questionNorm * 0.1 * 100, 1),
      explain: "Your question-mark rate, normalized to 45%.",
      messageIds: messageTextEvidence(conversation, role, (message) => message.text.includes("?")).slice(0, 3),
    },
    {
      id: "emoji_affect",
      label: "Uses more emoji",
      direction: "anxious",
      weight: 0.1,
      value: roundTo(emojiNorm, 3),
      contribution: roundTo(emojiNorm * 0.1 * 100, 1),
      explain: "Your emoji-bearing message rate, normalized to 40%.",
      messageIds: messageTextEvidence(conversation, role, (message) =>
        /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2764}]/u.test(message.text),
      ).slice(0, 3),
    },
    {
      id: "slow_reply",
      label: "Replies more slowly than the other person",
      direction: "avoidant",
      weight: 0.25,
      value: roundTo(latencyLag, 3),
      contribution: roundTo(latencyLag * 0.25 * 100, 1),
      explain: "Relative gap between their median reply time and yours (slower replies score toward avoidant).",
      messageIds: replyEvidence(conversation, role, true),
    },
    {
      id: "low_double_text",
      label: "Rarely sends follow-ups",
      direction: "avoidant",
      weight: 0.15,
      value: roundTo(lowDoubleNorm, 3),
      contribution: roundTo(lowDoubleNorm * 0.15 * 100, 1),
      explain: "Inverse of your double-text rate relative to theirs (fewer follow-ups than the other person).",
      messageIds: doubleTextEvidence(conversation, role),
    },
    {
      id: "short_messages",
      label: "Writes shorter messages",
      direction: "avoidant",
      weight: 0.15,
      value: roundTo(shortNorm, 3),
      contribution: roundTo(shortNorm * 0.15 * 100, 1),
      explain: "Your median message length below theirs.",
      messageIds: lengthEvidence(conversation, role, true),
    },
    {
      id: "ends_sessions",
      label: "Ends conversations",
      direction: "avoidant",
      weight: 0.15,
      value: roundTo(endNorm, 3),
      contribution: roundTo(endNorm * 0.15 * 100, 1),
      explain: "Share of sessions where your message is the last one, relative to theirs.",
      messageIds: sessionEndEvidence(conversation, role),
    },
    {
      id: "few_questions",
      label: "Asks fewer questions",
      direction: "avoidant",
      weight: 0.15,
      value: roundTo(lowQuestionNorm, 3),
      contribution: roundTo(lowQuestionNorm * 0.15 * 100, 1),
      explain: "Your question-mark rate below theirs.",
      messageIds: messageTextEvidence(conversation, role, (message) => message.text.includes("?")).slice(0, 3),
    },
    {
      id: "low_volume",
      label: "Sends fewer messages",
      direction: "avoidant",
      weight: 0.15,
      value: roundTo(lowVolumeNorm, 3),
      contribution: roundTo(lowVolumeNorm * 0.15 * 100, 1),
      explain: "Your share of all messages below an even split.",
      messageIds: [],
    },
    {
      id: "balanced_pace",
      label: "Balanced reply pace",
      direction: "secure",
      weight: 0.2,
      value: roundTo(latencyBalance, 3),
      contribution: roundTo(latencyBalance * 0.2 * 100, 1),
      explain: "Symmetry of median reply times between the two sides.",
      messageIds: replyEvidence(conversation, role, false),
    },
    {
      id: "balanced_volume",
      label: "Balanced message volume",
      direction: "secure",
      weight: 0.15,
      value: roundTo(volumeBalance, 3),
      contribution: roundTo(volumeBalance * 0.15 * 100, 1),
      explain: "Closeness of your message share to 50%.",
      messageIds: [],
    },
    {
      id: "balanced_initiation",
      label: "Balanced initiation",
      direction: "secure",
      weight: 0.15,
      value: roundTo(initBalance, 3),
      contribution: roundTo(initBalance * 0.15 * 100, 1),
      explain: "Closeness of your session-initiation share to 50%.",
      messageIds: sessionStartEvidence(conversation, role),
    },
    {
      id: "repair_signals",
      label: "Repair language present",
      direction: "secure",
      weight: 0.15,
      value: roundTo(repairQuality, 3),
      contribution: roundTo(repairQuality * 0.15 * 100, 1),
      explain: "Repair words ÷ (repair + conflict words) in your messages (lexicon_v0-draft).",
      messageIds: lexiconEvidence(conversation, role, "repair"),
    },
    {
      id: "steady_investment",
      label: "Steady investment over time",
      direction: "secure",
      weight: 0.15,
      value: roundTo(consistencyNorm, 3),
      contribution: roundTo(consistencyNorm * 0.15 * 100, 1),
      explain: "Investment consistency score (weekly message-volume stability).",
      messageIds: [],
    },
    {
      id: "responsive_overall",
      label: "Quick overall replying",
      direction: "secure",
      weight: 0.2,
      value: roundTo(responsivenessAbs, 3),
      contribution: roundTo(responsivenessAbs * 0.2 * 100, 1),
      explain: "Conversation-wide median reply time on a 12-hour scale (faster = higher).",
      messageIds: replyEvidence(conversation, role, false),
    },
  ];

  return {
    role,
    direction,
    label: ATTACHMENT_LABELS[direction],
    confidence,
    scores,
    sampleSize: total,
    signals,
  };
}

/**
 * 依恋方向判定（双人各一份，供 Ch.2 双人对照卡 + 免费预览）。
 * `metrics` 可选：健康度层已算过指标时传进来，避免重复扫描。
 */
export function assessAttachment(conversation: Conversation, metricsInput?: MetricsBundle): AttachmentReport {
  const metrics = metricsInput ?? computeMetrics(conversation);
  const userFeatures = featuresFor(conversation, "user");
  const partnerFeatures = featuresFor(conversation, "partner");
  return {
    ruleVersion: ATTACHMENT_RULE_VERSION,
    user: assessOne(conversation, "user", metrics, userFeatures),
    partner: assessOne(conversation, "partner", metrics, partnerFeatures),
  };
}
