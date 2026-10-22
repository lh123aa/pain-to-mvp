/**
 * Deterministic report engine: `ReportFeatures` -> `ReportDataV2`.
 *
 * Contract: this is a **pure function**. Same features + same conversation
 * produce byte-identical JSON (the regression test asserts two builds are
 * `JSON.stringify`-equal). No network, no LLM, no `Date.now()`, no randomness.
 * `generatedAt` is injected by the caller (the `/report` page passes the
 * analysis `createdAt` from sessionStorage); when it is not injected we derive
 * it from the conversation's last timestamp, which is still deterministic.
 *
 * Division of responsibility with the rules layer:
 * - Scores, metric values, attachment directions, confidences and signal
 *   evidence ids all come from `features` (rules layer is the single source of
 *   truth - the engine never recomputes a score or flips a direction).
 * - The engine only turns those numbers into English, selects evidence that
 *   actually exists in `conversation`, derives timeline moments, and picks
 *   seven actions from the weakest dimensions / strongest risk signals.
 *
 * Copy discipline: English only, no Chinese characters in output (quotes that
 * would carry CJK text are skipped), and none of the clinical vocabulary the
 * product bans (`report-engine.test.ts` scans the serialized report).
 */
import type { Conversation, ConversationMessage } from "../parser/types";
import { METRIC_IDS, roundTo, wallClock } from "../rules/metrics";
import type { MetricResult } from "../rules/metrics";
import { formatWallClockDate } from "../rules/health";
import type { DimensionId, DimensionScore, ReportFeatures } from "../rules/health";
import type { AttachmentAssessment, AttachmentSignal } from "../rules/attachment";
import {
  FALLBACK_WHAT_WE_DONT_KNOW,
  MAX_EVIDENCE_ITEMS,
  MAX_EVIDENCE_QUOTE_CHARS,
  REPORT_CHAPTER_IDS,
  REPORT_DISCLAIMER,
  REPORT_SCHEMA_VERSION,
  containsCjk,
} from "./report-contract";
import type {
  ActionItem,
  ActionSource,
  AtAGlanceChapter,
  AttachmentChapter,
  AttachmentSideView,
  AttachmentSignalView,
  ChapterId,
  CommunicationHealthChapter,
  ConfidenceLabel,
  DimensionReading,
  DimensionStatus,
  EvidenceConfidenceChapter,
  EvidenceQuote,
  GlanceDimension,
  MetricReading,
  NextSevenDaysChapter,
  ReportChapter,
  ReportDataV2,
  ReportEvidence,
  ReportHeadline,
  ReportMeta,
  TurningPoint,
  TurningPointsChapter,
} from "./report-contract";

export interface BuildReportOptions {
  /**
   * Stable timestamp for `meta.generatedAt`. The page injects the analysis
   * `createdAt`; tests omit it to prove determinism.
   */
  generatedAt?: string;
}

/* -------------------------------------------------------------------------------------------------
 * Small deterministic formatting helpers
 * ------------------------------------------------------------------------------------------------*/

function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 0.66) return "high";
  if (confidence >= 0.4) return "moderate";
  return "low";
}

function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function ratioPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusForScore(score: number): DimensionStatus {
  if (score >= 80) return "strength";
  if (score >= 60) return "steady";
  return "needs-attention";
}

function numberDetail(metric: MetricResult, key: string): number | null {
  const value = metric.details[key];
  return typeof value === "number" ? value : null;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 6) / 10;
  if (hours < 48) return `${hours} hours`;
  const days = Math.round(hours / 2.4) / 10;
  return `${days} days`;
}

function dateLabel(timestamp: number | null): string {
  return timestamp === null ? "timestamps unavailable" : formatWallClockDate(timestamp, false);
}

function isLateNight(timestamp: number): boolean {
  const hour = wallClock(timestamp).hour;
  return hour >= 23 || hour < 5;
}

function formatMetricValue(metric: MetricResult): string {
  if (metric.value === null) return "Not measured";
  switch (metric.unit) {
    case "minutes":
      return `${roundTo(metric.value, 1)} min`;
    case "ratio":
      return ratioPercent(metric.value);
    case "percent":
      return `${Math.round(metric.value)}%`;
    case "per_1k_messages":
      return `${roundTo(metric.value, 1)} per 1,000 messages`;
    case "chars":
      return `${Math.round(metric.value)} chars`;
    case "score":
      return `${Math.round(metric.value)}/100`;
    default:
      return `${metric.value}`;
  }
}

/* -------------------------------------------------------------------------------------------------
 * Headline + chapter 1 (at a glance)
 * ------------------------------------------------------------------------------------------------*/

function sortedDimensions(dimensions: DimensionScore[]): DimensionScore[] {
  return [...dimensions].sort(
    (a, b) => a.score - b.score || b.weight - a.weight || a.id.localeCompare(b.id),
  );
}

function dimensionMap(features: ReportFeatures): Record<DimensionId, DimensionScore> {
  const map = {} as Record<DimensionId, DimensionScore>;
  for (const dimension of features.health.dimensions) map[dimension.id] = dimension;
  return map;
}

function buildHeadline(features: ReportFeatures): ReportHeadline {
  const dimensions = sortedDimensions(features.health.dimensions);
  const weakest = dimensions[0] as DimensionScore;
  const strongest = dimensions[dimensions.length - 1] as DimensionScore;
  const sparse = features.sample.messageCount < 12;
  const caveat = features.dataQuality.lowSample
    ? " This is a small sample, so treat the read as provisional."
    : "";
  const oneLineSummary =
    `${features.health.totalScore}/100, grade ${features.health.grade} (${features.health.scoreLabel}). ` +
    `${strongest.label} is the clearest strength at ${strongest.score}/100; ` +
    `${weakest.label} has the most room at ${weakest.score}/100.${caveat}` +
    (sparse ? " There is not enough data for a settled picture yet." : "");

  return {
    score: features.health.totalScore,
    grade: features.health.grade,
    scoreLabel: features.health.scoreLabel,
    oneLineSummary,
    confidence: features.dataQuality.confidence,
    confidenceLabel: confidenceLabel(features.dataQuality.confidence),
  };
}

function buildAtAGlance(features: ReportFeatures): AtAGlanceChapter {
  const dimensions = sortedDimensions(features.health.dimensions);
  const weakest = dimensions[0] as DimensionScore;
  const strongest = dimensions[dimensions.length - 1] as DimensionScore;
  const sparse = features.sample.messageCount < 12;
  const dims: GlanceDimension[] = features.health.dimensions.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    score: dimension.score,
    weight: dimension.weight,
    confidence: dimension.confidence,
  }));
  const attachment = features.attachment.user;
  const summary =
    `${features.health.totalScore}/100 overall, grade ${features.health.grade} - ${features.health.scoreLabel}. ` +
    `Strongest: ${strongest.label} (${strongest.score}/100). Weakest: ${weakest.label} (${weakest.score}/100). ` +
    `On your side the behavior signals read as ${attachment.label} ` +
    `(confidence ${confidencePercent(attachment.confidence)}). ` +
    (sparse
      ? "Not enough data for a stable picture, so every score here is provisional."
      : "These scores are rule-based and reproducible from the same export.");

  return {
    id: "at-a-glance",
    number: 1,
    title: "At a glance",
    summary,
    dimensions: dims,
    attachment: {
      direction: attachment.direction,
      label: attachment.label,
      confidence: attachment.confidence,
    },
    confidence: features.dataQuality.confidence,
    confidenceLabel: confidenceLabel(features.dataQuality.confidence),
    dataNotEnough: sparse,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Chapter 2 (attachment picture)
 * ------------------------------------------------------------------------------------------------*/

function topSignals(assessment: AttachmentAssessment, limit = 5): AttachmentSignalView[] {
  const validIds = new Set<string>();
  for (const signal of assessment.signals) for (const id of signal.messageIds) validIds.add(id);
  const signals = [...assessment.signals].sort(
    (a, b) => b.contribution - a.contribution || b.value - a.value || a.id.localeCompare(b.id),
  );
  return signals.slice(0, limit).map((signal: AttachmentSignal) => ({
    id: signal.id,
    label: signal.label,
    direction: signal.direction,
    strength: signal.value,
    contribution: signal.contribution,
    explain: signal.explain,
    evidenceIds: signal.messageIds.filter((id) => validIds.has(id)),
  }));
}

function sideNote(assessment: AttachmentAssessment, messageCount: number): string {
  if (messageCount === 0) {
    return "No messages from this side in the export, so there is nothing to read here.";
  }
  if (assessment.confidence < 0.35) {
    return "Low confidence - treat this direction as a hint, not a conclusion.";
  }
  if (assessment.direction === "mixed") {
    return "The direction scores are close together, so the honest label is Mixed signals.";
  }
  const supporting = assessment.signals.filter((signal) => signal.value > 0).length;
  return `Based on ${supporting} weighted behavior signals found in this export.`;
}

function attachmentSide(
  role: "user" | "partner",
  heading: string,
  assessment: AttachmentAssessment,
  messageCount: number,
): AttachmentSideView {
  return {
    role,
    heading,
    direction: assessment.direction,
    label: assessment.label,
    confidence: assessment.confidence,
    scores: assessment.scores,
    topSignals: topSignals(assessment),
    note: sideNote(assessment, messageCount),
  };
}

function buildAttachmentChapter(features: ReportFeatures, conversation: Conversation): AttachmentChapter {
  const user = features.attachment.user;
  const partner = features.attachment.partner;
  const sparse =
    conversation.messages.length < 6 ||
    (conversation.user.messageCount === 0 && conversation.partner.messageCount === 0);
  const oneSided = conversation.user.messageCount === 0 || conversation.partner.messageCount === 0;
  const summary =
    `Your side reads as ${user.label.toLowerCase()} (confidence ${confidencePercent(user.confidence)}); ` +
    `your partner's side reads as ${partner.label.toLowerCase()} (confidence ${confidencePercent(partner.confidence)}). ` +
    "Directions describe behavior in this export - reply pace, follow-ups, who starts, how much is said - not a fixed type." +
    (oneSided ? " One side has no messages, so this is a one-sided read." : "") +
    (sparse ? " Not enough data for a settled read; treat both directions as provisional." : "");

  return {
    id: "attachment",
    number: 2,
    title: "Attachment picture",
    summary,
    sides: [
      attachmentSide("user", "You", user, conversation.user.messageCount),
      attachmentSide("partner", "Your partner", partner, conversation.partner.messageCount),
    ],
    dataNotEnough: sparse,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Chapter 3 (communication health) - dimensions + all ten metric readings
 * ------------------------------------------------------------------------------------------------*/

function dimensionReading(dimension: DimensionScore, features: ReportFeatures): string {
  const metrics = features.metrics;
  let base: string;
  switch (dimension.id) {
    case "reciprocity": {
      if (dimension.score >= 80) {
        base =
          "Both sides carry a similar share of messages, conversation starts, message length and questions.";
      } else if (dimension.score >= 60) {
        base =
          "The split is broadly even, with a mild lean in who writes more, starts more, or asks more.";
      } else {
        const userStarts = numberDetail(metrics.initiation_ratio, "userSessions");
        const sessions = numberDetail(metrics.initiation_ratio, "sessions");
        const startText =
          userStarts !== null && sessions !== null && sessions > 0
            ? ` You start ${ratioPercent(userStarts / sessions)} of sessions.`
            : "";
        base = `One side carries more of the conversation: more messages, more starts, or longer turns.${startText}`;
      }
      break;
    }
    case "responsiveness": {
      if (metrics.reply_median_latency.value === null) {
        base =
          "Reply pace cannot be read without timestamps, so this dimension stays neutral at 50 instead of being guessed.";
        break;
      }
      if (dimension.score >= 80) base = "Replies arrive quickly and both sides reply at a similar pace.";
      else if (dimension.score >= 60) base = "Reply pace is workable, with some slower stretches.";
      else base = "One or both sides take a long time to reply, or the pace is lopsided.";
      break;
    }
    case "atmosphere": {
      if (dimension.score >= 80) base = "Warmth signals dominate: emoji, positive wording, and repair language.";
      else if (dimension.score >= 60) base = "The tone is mostly neutral to warm, with some flat or tense patches.";
      else base = "Tense wording and/or few warmth signals pull the tone down.";
      break;
    }
    case "conflict_repair": {
      const repairRatio = numberDetail(metrics.conflict_repair_freq, "repairToConflictRatio");
      if (dimension.score >= 80) base = "Friction is rare and repair language shows up when it does.";
      else if (dimension.score >= 60) {
        base =
          repairRatio !== null && repairRatio >= 0.5
            ? "Some friction appears, and repair language is present in roughly half of those moments."
            : "Some friction appears, but repair language is thinner than the conflict signal.";
      } else {
        base = "Conflict wording is frequent and repair language is scarce by comparison.";
      }
      break;
    }
    case "investment_consistency": {
      if (dimension.score >= 80) base = "Message volume and your share of it are steady across the timeline.";
      else if (dimension.score >= 60) base = "There are some gaps or shifts in how evenly effort is spread over time.";
      else base = "The timeline shows uneven investment: gaps, bursts, or a drifting share of messages.";
      break;
    }
    default:
      base = "";
  }
  const caveat =
    dimension.confidence < 0.25
      ? " Confidence is low for this dimension, so treat it as a hint."
      : "";
  return `${base}${caveat}`.trim();
}

function unavailableReading(metric: MetricResult): string {
  switch (metric.unavailableReason) {
    case "no-timestamps":
      return "Not measured: this export has no timestamps, so timing patterns cannot be calculated.";
    case "one-sided":
      return "Not measured: one side has no messages in this export.";
    case "no-messages":
      return "Not measured: there are no messages to analyze.";
    case "insufficient-sample":
    default:
      return `Not enough data: only ${metric.sampleSize} usable sample(s) for this measure, which is below the threshold.`;
  }
}

function metricReading(metric: MetricResult): string {
  if (metric.value === null) return unavailableReading(metric);
  const value = metric.value;
  switch (metric.id) {
    case "reply_median_latency": {
      const user = numberDetail(metric, "userMedianMinutes");
      const partner = numberDetail(metric, "partnerMedianMinutes");
      const pace =
        value < 15
          ? "Replies typically arrive within 15 minutes - close to real-time."
          : value < 60
            ? "A typical reply lands within the hour."
            : value < 360
              ? "Replies usually land within a few hours."
              : "Replies often take many hours, which makes momentum hard to keep.";
      const both =
        user !== null && partner !== null
          ? ` You: about ${Math.round(user)} min; your partner: about ${Math.round(partner)} min.`
          : "";
      return `${pace}${both}`;
    }
    case "double_text_rate": {
      const user = numberDetail(metric, "userRate");
      const signal =
        value < 0.1
          ? "Follow-up messages before a reply are rare."
          : value < 0.25
            ? "Some messages are sent while still waiting for a reply."
            : "A noticeable share of messages are follow-ups sent while still waiting for a reply.";
      const yours = user === null ? "" : ` Your rate: ${ratioPercent(user)}.`;
      return `${signal}${yours}`;
    }
    case "initiation_ratio": {
      const starts = ratioPercent(value);
      if (value >= 0.42 && value <= 0.58) return `Conversation starts are close to even (you start ${starts}).`;
      if (value > 0.58) return `You start ${starts} of conversations, which is above an even split.`;
      return `You start ${starts} of conversations, so your partner opens more of them.`;
    }
    case "length_ratio": {
      const user = numberDetail(metric, "userMedianChars");
      const partner = numberDetail(metric, "partnerMedianChars");
      const context =
        user !== null && partner !== null
          ? ` Median message: ${Math.round(user)} vs ${Math.round(partner)} characters.`
          : "";
      if (value >= 1.18) return `You write noticeably longer messages than your partner.${context}`;
      if (value <= 0.85) return `Your partner writes noticeably longer messages than you.${context}`;
      return `Message length is balanced between the two sides.${context}`;
    }
    case "question_rate": {
      const user = numberDetail(metric, "userRate");
      const partner = numberDetail(metric, "partnerRate");
      const side =
        user !== null && partner !== null
          ? ` You ask in ${ratioPercent(user)} of your messages, they ask in ${ratioPercent(partner)}.`
          : "";
      return `${ratioPercent(value)} of messages contain a question.${side}`;
    }
    case "emoji_rate": {
      return `${ratioPercent(value)} of messages carry an emoji - a rough warmth signal, not a mood measure.`;
    }
    case "late_night_share": {
      const window = typeof metric.details.window === "string" ? metric.details.window : "23:00-04:59";
      const user = numberDetail(metric, "userRate");
      const yours = user === null ? "" : ` Your own rate: ${ratioPercent(user)}.`;
      if (value >= 0.15) {
        return `${ratioPercent(value)} of timestamped messages fall in the ${window} window.${yours}`;
      }
      return `${ratioPercent(value)} of timestamped messages fall in the ${window} window - a low share.${yours}`;
    }
    case "topic_switch_proxy": {
      const meanRun = numberDetail(metric, "meanRunLength");
      const run = meanRun === null ? "" : ` Messages usually stay on one top-term topic for about ${Math.round(meanRun)} in a row.`;
      return `Keyword proxy (not semantic understanding): the dominant word-frequency topic changes in ${ratioPercent(value)} of adjacent messages.${run}`;
    }
    case "conflict_repair_freq": {
      const repairPer1k = numberDetail(metric, "repairPer1k");
      const repairRatio = numberDetail(metric, "repairToConflictRatio");
      const conflict =
        value >= 20
          ? "Conflict wording is dense relative to the sample."
          : value >= 5
            ? "Some conflict wording appears in the sample."
            : "Conflict wording is rare in the sample.";
      const repair =
        repairRatio === null
          ? ""
          : repairRatio >= 0.5
            ? " Repair language outweighs conflict wording."
            : " Repair language is thinner than the conflict signal.";
      const per1k = repairPer1k === null ? "" : ` Repair rate: ${roundTo(repairPer1k, 1)} per 1,000 messages.`;
      return `${conflict}${repair}${per1k}`;
    }
    case "investment_consistency": {
      const gap = numberDetail(metric, "longestSilenceBuckets");
      const gapText = gap === null ? "" : ` Longest run of empty buckets: ${Math.round(gap)}.`;
      if (value >= 80) return `Weekly message volume and your share of it are stable.${gapText}`;
      if (value >= 60) return `Volume and share shift somewhat across the timeline.${gapText}`;
      return `Volume and share are uneven over time - bursts, quiet gaps, or a drifting split.${gapText}`;
    }
    default:
      return "";
  }
}

function buildHealthChapter(features: ReportFeatures): CommunicationHealthChapter {
  const sparse = features.sample.messageCount < 12;
  const dimensions: DimensionReading[] = features.health.dimensions.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    score: dimension.score,
    weight: dimension.weight,
    confidence: dimension.confidence,
    status: statusForScore(dimension.score),
    reading: dimensionReading(dimension, features),
    metricIds: dimension.metricIds,
  }));
  const metrics: MetricReading[] = METRIC_IDS.map((id) => {
    const metric = features.metrics[id];
    let displayValue = formatMetricValue(metric);
    if (id === "conflict_repair_freq" && metric.value !== null) {
      const repairPer1k = numberDetail(metric, "repairPer1k");
      displayValue =
        repairPer1k === null
          ? `${roundTo(metric.value, 1)} conflict per 1,000 messages`
          : `${roundTo(metric.value, 1)} conflict / ${roundTo(repairPer1k, 1)} repair per 1,000`;
    }
    return {
      id,
      label: metric.label,
      value: metric.value,
      unit: metric.unit,
      displayValue,
      confidence: metric.confidence,
      sampleSize: metric.sampleSize,
      reading: metricReading(metric),
      unavailableReason: metric.unavailableReason ?? null,
      proxy: metric.proxy,
    };
  });
  const available = metrics.filter((metric) => metric.value !== null).length;
  const weakest = sortedDimensions(features.health.dimensions)[0] as DimensionScore;
  const summary =
    `${available}/10 measures could be computed from ${features.sample.messageCount} messages. ` +
    `The weighted total is ${features.health.totalScore}/100 across five dimensions ` +
    `(weights ${features.health.dimensions.map((dimension) => dimension.weight).join("/")}). ` +
    `Lowest dimension: ${weakest.label} at ${weakest.score}/100.`;
  const dataNotEnough = available === 0 || sparse;

  return {
    id: "health",
    number: 3,
    title: "Communication health",
    summary: dataNotEnough
      ? `Not enough data for a stable health read. ${summary}`
      : summary,
    dimensions,
    metrics,
    dataNotEnough,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Chapter 4 (turning points) - derived from the timeline and existing signals
 * ------------------------------------------------------------------------------------------------*/

interface TimedMessage extends ConversationMessage {
  timestamp: number;
}

function isTimed(message: ConversationMessage): message is TimedMessage {
  return message.timestamp !== null;
}

function buildTurningPoints(
  features: ReportFeatures,
  conversation: Conversation,
): TurningPointsChapter {
  const timed = conversation.messages.filter(isTimed);
  const sparse = conversation.messages.length < 6 || timed.length < 4;
  const title = "Turning points";
  if (sparse) {
    return {
      id: "turning-points",
      number: 4,
      title,
      summary:
        "Not enough data to identify turning points: this export is too short or has too few timestamps. " +
        "We would rather say nothing than invent a moment.",
      points: [],
      dataNotEnough: true,
    };
  }

  const points: TurningPoint[] = [];

  // Longest pause between two consecutive timestamped messages.
  let longestGap: { ms: number; from: TimedMessage; to: TimedMessage } | null = null;
  for (let index = 1; index < timed.length; index += 1) {
    const from = timed[index - 1] as TimedMessage;
    const to = timed[index] as TimedMessage;
    const gap = to.timestamp - from.timestamp;
    if (gap <= 0) continue;
    if (longestGap === null || gap > longestGap.ms) longestGap = { ms: gap, from, to };
  }
  if (longestGap !== null && longestGap.ms >= 6 * 3_600_000) {
    points.push({
      id: "longest-pause",
      label: "Longest pause",
      detail:
        `The chat went quiet for ${formatDuration(longestGap.ms)}, ` +
        `between ${dateLabel(longestGap.from.timestamp)} and ${dateLabel(longestGap.to.timestamp)}.`,
      timestamp: longestGap.to.timestamp,
      dateLabel: dateLabel(longestGap.to.timestamp),
      evidenceIds: [longestGap.from.id, longestGap.to.id],
    });
  }

  // Busiest calendar day (wall-clock day, timezone independent).
  const perDay = new Map<number, { count: number; first: TimedMessage }>();
  for (const message of timed) {
    const key = wallClock(message.timestamp).dayIndex;
    const existing = perDay.get(key);
    if (existing === undefined) perDay.set(key, { count: 1, first: message });
    else existing.count += 1;
  }
  let busiest: { day: number; count: number; first: TimedMessage } | null = null;
  for (const [day, bucket] of perDay) {
    if (busiest === null || bucket.count > busiest.count || (bucket.count === busiest.count && day < busiest.day)) {
      busiest = { day, count: bucket.count, first: bucket.first };
    }
  }
  if (busiest !== null && busiest.count >= 3) {
    points.push({
      id: "busiest-day",
      label: "Busiest day",
      detail: `${busiest.count} messages landed on ${dateLabel(busiest.first.timestamp)} - the densest day in this export.`,
      timestamp: busiest.first.timestamp,
      dateLabel: dateLabel(busiest.first.timestamp),
      evidenceIds: [busiest.first.id],
    });
  }

  // Late-night cluster.
  const lateNight = timed.filter((message) => isLateNight(message.timestamp));
  if (lateNight.length >= 3) {
    const first = lateNight[0] as TimedMessage;
    points.push({
      id: "late-night-cluster",
      label: "Late-night cluster",
      detail: `${lateNight.length} of ${timed.length} timestamped messages were sent between 11pm and 5am.`,
      timestamp: first.timestamp,
      dateLabel: dateLabel(first.timestamp),
      evidenceIds: [first.id],
    });
  }

  // Longest run of messages from the same side.
  let runRole: "user" | "partner" | null = null;
  let runLength = 0;
  let runFirst: ConversationMessage | null = null;
  let bestRun: { role: "user" | "partner"; length: number; first: ConversationMessage; last: ConversationMessage } | null = null;
  for (const message of conversation.messages) {
    if (runRole === message.role) {
      runLength += 1;
    } else {
      runRole = message.role;
      runLength = 1;
      runFirst = message;
    }
    if (runFirst === null) runFirst = message;
    if (bestRun === null || runLength > bestRun.length) {
      bestRun = { role: message.role, length: runLength, first: runFirst, last: message };
    }
  }
  if (bestRun !== null && bestRun.length >= 3) {
    points.push({
      id: "one-sided-run",
      label: "One-sided run",
      detail:
        `${bestRun.length} messages in a row came from ${bestRun.role === "user" ? "you" : "your partner"} ` +
        `without a reply in between.`,
      timestamp: bestRun.last.timestamp,
      dateLabel: dateLabel(bestRun.last.timestamp),
      evidenceIds: [bestRun.first.id, bestRun.last.id],
    });
  }

  // Repair language from the attachment signals (already evidence-backed).
  const repairIds: string[] = [];
  for (const signal of [...features.attachment.user.signals, ...features.attachment.partner.signals]) {
    if (signal.id !== "repair_signals") continue;
    for (const id of signal.messageIds) repairIds.push(id);
  }
  if (repairIds.length > 0) {
    const byId = new Map(conversation.messages.map((message) => [message.id, message]));
    const anchors = repairIds
      .map((id) => byId.get(id))
      .filter((message): message is ConversationMessage => message !== undefined && message.timestamp !== null);
    if (anchors.length > 0) {
      const first = anchors[0] as ConversationMessage;
      points.push({
        id: "repair-moment",
        label: "Repair moment",
        detail: `Repair language appears in ${repairIds.length} message(s) - evidence that friction has a way back.`,
        timestamp: first.timestamp,
        dateLabel: dateLabel(first.timestamp),
        evidenceIds: repairIds.slice(0, 2),
      });
    }
  }

  // Bookend of the timeline.
  const last = timed[timed.length - 1] as TimedMessage;
  points.push({
    id: "last-message",
    label: "Last message on record",
    detail: `The last timestamped message was sent on ${dateLabel(last.timestamp)}.`,
    timestamp: last.timestamp,
    dateLabel: dateLabel(last.timestamp),
    evidenceIds: [last.id],
  });

  points.sort(
    (a, b) =>
      (a.timestamp ?? 0) - (b.timestamp ?? 0) || a.id.localeCompare(b.id),
  );
  const capped = points.slice(0, 5);
  const summary =
    `Moments the timeline itself supports: ${capped.length} point(s), each linked to real messages. ` +
    (features.dataQuality.lowSample
      ? "The sample is small, so these are simply the densest or longest moments in it."
      : "They are descriptive, not judgments about the relationship.");

  return {
    id: "turning-points",
    number: 4,
    title,
    summary,
    points: capped,
    dataNotEnough: capped.length === 0,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Evidence selection
 * ------------------------------------------------------------------------------------------------*/

interface EvidenceCandidate {
  messageId: string;
  chapterId: ChapterId;
  priority: number;
  index: number;
}

function isQuotable(message: ConversationMessage): boolean {
  if (message.kind !== undefined && message.kind !== "text") return false;
  if (message.text.trim().length === 0) return false;
  return !containsCjk(message.text);
}

function truncateQuote(text: string): string {
  const points = Array.from(text);
  if (points.length <= MAX_EVIDENCE_QUOTE_CHARS) return text;
  return points.slice(0, MAX_EVIDENCE_QUOTE_CHARS).join("");
}

/**
 * Collect candidate evidence, weighted by the signal that produced it.
 * Priority tiers (higher wins): attachment signals (200+) > turning points
 * (130) > health-specific timeline signals (90).
 */
function collectCandidates(
  features: ReportFeatures,
  conversation: Conversation,
  turningPoints: TurningPointsChapter,
): EvidenceCandidate[] {
  const byId = new Map<string, ConversationMessage>();
  const indexById = new Map<string, number>();
  conversation.messages.forEach((message, index) => {
    byId.set(message.id, message);
    indexById.set(message.id, index);
  });
  const candidates: EvidenceCandidate[] = [];
  const add = (id: string, chapterId: ChapterId, priority: number) => {
    const message = byId.get(id);
    if (message === undefined || !isQuotable(message)) return;
    candidates.push({
      messageId: id,
      chapterId,
      priority: roundTo(priority, 3),
      index: indexById.get(id) ?? 0,
    });
  };

  const sides: Array<{ role: "user" | "partner"; assessment: AttachmentAssessment }> = [
    { role: "user", assessment: features.attachment.user },
    { role: "partner", assessment: features.attachment.partner },
  ];
  for (const side of sides) {
    for (const signal of side.assessment.signals) {
      const directionBonus = signal.direction === side.assessment.direction ? 5 : 0;
      const roleBonus = side.role === "user" ? 0.5 : 0;
      const priority = 200 + signal.contribution + directionBonus + roleBonus;
      for (const id of signal.messageIds) add(id, "attachment", priority);
    }
  }

  turningPoints.points.forEach((point, order) => {
    for (const id of point.evidenceIds) add(id, "turning-points", 130 - order);
  });

  // Health evidence: late-night messages and follow-up runs, when measured.
  const late = features.metrics.late_night_share;
  if (late.value !== null) {
    let taken = 0;
    for (const message of conversation.messages) {
      if (taken >= 2) break;
      if (!isQuotable(message) || !isTimed(message) || !isLateNight(message.timestamp)) continue;
      add(message.id, "health", 90 + late.confidence * 10);
      taken += 1;
    }
  }
  const doubleText = features.metrics.double_text_rate;
  if (doubleText.value !== null) {
    let taken = 0;
    for (let index = 1; index < conversation.messages.length; index += 1) {
      if (taken >= 2) break;
      const message = conversation.messages[index] as ConversationMessage;
      const previous = conversation.messages[index - 1] as ConversationMessage;
      if (message.role !== previous.role) continue;
      if (!isQuotable(message)) continue;
      add(message.id, "health", 85 + doubleText.confidence * 10);
      taken += 1;
    }
  }

  return candidates;
}

function selectEvidence(
  candidates: EvidenceCandidate[],
  conversation: Conversation,
): ReportEvidence[] {
  const byId = new Map<string, ConversationMessage>();
  for (const message of conversation.messages) byId.set(message.id, message);

  const best = new Map<string, EvidenceCandidate>();
  for (const candidate of candidates) {
    const existing = best.get(candidate.messageId);
    if (existing === undefined) {
      best.set(candidate.messageId, candidate);
      continue;
    }
    const better =
      candidate.priority > existing.priority ||
      (candidate.priority === existing.priority &&
        REPORT_CHAPTER_IDS.indexOf(candidate.chapterId) < REPORT_CHAPTER_IDS.indexOf(existing.chapterId));
    if (better) best.set(candidate.messageId, candidate);
  }

  const ranked = [...best.values()].sort(
    (a, b) => b.priority - a.priority || a.index - b.index || a.messageId.localeCompare(b.messageId),
  );
  const selected = ranked.slice(0, MAX_EVIDENCE_ITEMS);
  selected.sort(
    (a, b) =>
      REPORT_CHAPTER_IDS.indexOf(a.chapterId) - REPORT_CHAPTER_IDS.indexOf(b.chapterId) ||
      a.index - b.index,
  );

  const evidence: ReportEvidence[] = [];
  for (const candidate of selected) {
    const message = byId.get(candidate.messageId);
    if (message === undefined) continue;
    evidence.push({
      messageId: candidate.messageId,
      quote: truncateQuote(message.text),
      timestamp: message.timestamp,
      chapterId: candidate.chapterId,
    });
  }
  return evidence;
}

/* -------------------------------------------------------------------------------------------------
 * Chapter 5 (evidence & confidence)
 * ------------------------------------------------------------------------------------------------*/

function buildWhatWeDontKnow(
  features: ReportFeatures,
  conversation: Conversation,
  evidence: ReportEvidence[],
): string[] {
  const items: string[] = [
    "We cannot know what either of you was feeling - only what the messages show.",
  ];
  if (conversation.meta.timestampedCount === 0) {
    items.push("Reply pace, late-night patterns and pauses cannot be measured without timestamps.");
  } else if (conversation.meta.needsDateConfirmation) {
    items.push("The date order in this export was ambiguous, so timing-based readings may shift by a day.");
  }
  if (conversation.user.messageCount === 0 || conversation.partner.messageCount === 0) {
    items.push("Only one side has messages in this export, so balance measures describe that side alone.");
  }
  if (features.dataQuality.lowSample) {
    items.push(
      `The sample is small (${features.sample.messageCount} messages over ${features.sample.durationDays} days); ` +
        "treat directions and scores as provisional rather than settled.",
    );
  }
  const unavailable = METRIC_IDS.filter((id) => features.metrics[id].value === null).map(
    (id) => features.metrics[id].label,
  );
  if (unavailable.length > 0) {
    items.push(`These measures could not be computed from this export: ${unavailable.join(", ")}.`);
  }
  if (features.metrics.topic_switch_proxy.proxy || features.metrics.conflict_repair_freq.proxy) {
    items.push(
      "Topic switching and conflict/repair counts rely on keyword proxies, not semantic understanding.",
    );
  }
  if (evidence.length === 0) {
    items.push("There are no quotable messages in this export, so no evidence quotes are shown.");
  }
  items.push("We do not see what either person was thinking, or what happened outside this chat.");

  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
  const capped = unique.slice(0, 8);
  return capped.length > 0 ? capped : [...FALLBACK_WHAT_WE_DONT_KNOW];
}

function buildEvidenceChapter(
  features: ReportFeatures,
  conversation: Conversation,
  evidence: ReportEvidence[],
  whatWeDontKnow: string[],
): EvidenceConfidenceChapter {
  const quotes: EvidenceQuote[] = evidence.map((item) => {
    const message = conversation.messages.find((entry) => entry.id === item.messageId);
    return {
      messageId: item.messageId,
      quote: item.quote,
      dateLabel: dateLabel(message?.timestamp ?? item.timestamp),
      chapterId: item.chapterId,
    };
  });
  const limitations: string[] = [
    `Built from ${features.sample.messageCount} messages (${features.sample.timestampedCount} with timestamps), ${features.sample.dateRangeLabel}.`,
    `Quoted evidence is a prefix of the real message text, capped at ${MAX_EVIDENCE_QUOTE_CHARS} characters.`,
    "Scores are rule-based and deterministic: the same export produces the same numbers.",
    "The attachment direction is a behavior proxy, not a fixed type or a label for a person.",
  ];
  if (features.metrics.topic_switch_proxy.proxy) {
    limitations.push("Topic switching is measured with word-frequency buckets rather than semantic clustering.");
  }
  const summary =
    `${evidence.length} quoted message(s) support this report. ` +
    `Overall data confidence: ${confidencePercent(features.dataQuality.confidence)} (${confidenceLabel(features.dataQuality.confidence)}). ` +
    (evidence.length === 0
      ? "Not enough data to quote evidence from this export."
      : "Every quote can be checked against the upload.");

  return {
    id: "evidence-confidence",
    number: 5,
    title: "Evidence & confidence",
    summary,
    evidenceCount: evidence.length,
    citedMessageIds: evidence.map((item) => item.messageId),
    quotes,
    whatWeDontKnow,
    limitations,
    confidence: features.dataQuality.confidence,
    confidenceLabel: confidenceLabel(features.dataQuality.confidence),
    dataNotEnough: evidence.length === 0,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Chapter 6 (next 7 days) - selected from weakest dimensions / risk signals
 * ------------------------------------------------------------------------------------------------*/

interface Focus {
  key: string;
  label: string;
  dimensionId: DimensionId | null;
  severity: number;
  source: ActionSource;
}

interface RawAction {
  action: string;
  why: string;
  targetDimension: DimensionId | null;
  source: ActionSource;
}

interface ActionContext {
  features: ReportFeatures;
  dimensions: Record<DimensionId, DimensionScore>;
}

function buildFocusOrder(features: ReportFeatures, sparse: boolean): Focus[] {
  const dimensions = dimensionMap(features);
  const metrics = features.metrics;
  const risks: Focus[] = [];
  const push = (
    key: string,
    label: string,
    dimensionId: DimensionId | null,
    severity: number,
    source: ActionSource = "risk",
  ) => {
    risks.push({ key, label, dimensionId, severity: roundTo(severity, 3), source });
  };

  if (dimensions.conflict_repair.score < 70) {
    push("conflict-repair", "Conflict repair", "conflict_repair", 6 + (70 - dimensions.conflict_repair.score) / 20);
  }
  if (dimensions.responsiveness.score < 60 && metrics.reply_median_latency.value !== null) {
    push("reply-pace", "Reply pace", "responsiveness", 5 + (60 - dimensions.responsiveness.score) / 20);
  }
  if (dimensions.reciprocity.score < 65) {
    push("reciprocity", "Reciprocity", "reciprocity", 5 + (65 - dimensions.reciprocity.score) / 20);
  }
  if (dimensions.atmosphere.score < 65) {
    push("atmosphere", "Atmosphere", "atmosphere", 4 + (65 - dimensions.atmosphere.score) / 20);
  }
  if (dimensions.investment_consistency.score < 65) {
    push("consistency", "Investment consistency", "investment_consistency", 4 + (65 - dimensions.investment_consistency.score) / 20);
  }
  const late = metrics.late_night_share.value;
  if (late !== null && late >= 0.15) {
    push("late-night", "Late-night messages", "atmosphere", 3 + late * 5);
  }
  const doubleUser = numberDetail(metrics.double_text_rate, "userRate");
  if (doubleUser !== null && doubleUser >= 0.2) {
    push("double-text", "Double texts", "reciprocity", 3 + doubleUser * 5);
  }
  const initiation = metrics.initiation_ratio.value;
  if (initiation !== null && (initiation <= 0.35 || initiation >= 0.65)) {
    push("initiation", "Who starts conversations", "reciprocity", 3 + Math.abs(initiation - 0.5) * 5);
  }
  if (sparse) push("small-sample", "Small sample", null, 8, "low-sample");

  risks.sort(
    (a, b) =>
      b.severity - a.severity ||
      (a.dimensionId === null ? 50 : dimensions[a.dimensionId].score) -
        (b.dimensionId === null ? 50 : dimensions[b.dimensionId].score) ||
      a.key.localeCompare(b.key),
  );

  const focuses: Focus[] = [];
  const seen = new Set<string>();
  for (const risk of risks) {
    if (seen.has(risk.key)) continue;
    seen.add(risk.key);
    focuses.push(risk);
  }
  const weakest = sortedDimensions(features.health.dimensions);
  for (const dimension of weakest) {
    // Only dimensions that actually need work become action targets; a healthy
    // conversation falls through to the maintenance actions below.
    if (dimension.score >= 80) continue;
    const key = `weak-${dimension.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    focuses.push({
      key,
      label: dimension.label,
      dimensionId: dimension.id,
      severity: 1,
      source: "weakness",
    });
  }
  return focuses;
}

function actionsForFocus(focus: Focus, context: ActionContext): Array<{ action: string; why: string }> {
  const { features, dimensions } = context;
  const dimension = focus.dimensionId === null ? null : dimensions[focus.dimensionId];
  const score = dimension === null ? null : dimension.score;
  const scoreText = score === null ? "" : ` at ${score}/100`;
  const confidence = features.dataQuality.confidence;

  switch (focus.key) {
    case "conflict-repair":
      return [
        {
          action:
            "When a disagreement starts, name it early: \"I think we're both getting frustrated - can we slow down?\"",
          why: `Conflict repair is one of your lowest weighted dimensions${scoreText}. Naming friction early gives both of you a way back before things harden.`,
        },
        {
          action: "Pick one tense exchange and ask, \"What did you hear me say?\" before explaining your side.",
          why: "Repair works when both people check what landed, not just what was intended.",
        },
        {
          action: "Use one short repair line within the first minute of friction, such as \"I want to get this right.\"",
          why: "Short repair phrases are easier to hear than long explanations.",
        },
      ];
    case "reply-pace":
      return [
        {
          action: "Agree on a rough reply window with them (for example, evenings) and say when you'll be slower.",
          why: `Responsiveness scores${scoreText}; a stated window removes the guesswork about slow replies.`,
        },
        {
          action: "Reply to the small messages quickly - pace carries more signal than length here.",
          why: "Faster acknowledgment on small messages softens the slower ones without pretending to be always available.",
        },
      ];
    case "reciprocity":
      return [
        {
          action: "Let them start the next conversation, then reply at your normal pace.",
          why: `Reciprocity scores${scoreText}; letting the other side open a thread rebalances who carries the conversation.`,
        },
        {
          action: "For every two updates you send, ask one open question.",
          why: "Questions shift messages from reporting to exchange, which is what reciprocity measures.",
        },
      ];
    case "atmosphere":
      return [
        {
          action: "Send one message that is just appreciation, with no ask attached.",
          why: `Atmosphere scores${scoreText}; warmth signals are sparse relative to the volume of messages.`,
        },
        {
          action: "Swap one long paragraph for two shorter, warmer messages.",
          why: "Shorter warm messages are easier to answer and raise the tone without a big gesture.",
        },
      ];
    case "consistency":
      return [
        {
          action: "Pick two days this week and send a check-in on both days.",
          why: `Investment consistency scores${scoreText}; steady small contact is what this dimension rewards.`,
        },
        {
          action: "Keep one conversation going across two days instead of one long burst.",
          why: "Spreading contact over time smooths out the gaps and bursts that lower this score.",
        },
      ];
    case "late-night":
      return [
        {
          action: "Move one late-night thread to a daytime reply this week.",
          why: `A meaningful share of timestamped messages fall after 11pm. A daytime reply keeps the topic without the sleep cost.`,
        },
        {
          action: "If a late-night message can wait, send one short line and pick it up in the morning.",
          why: "Late-night exchanges are harder to read accurately and easier to escalate.",
        },
      ];
    case "double-text":
      return [
        {
          action: "Wait for a reply before sending the follow-up; if it matters, send one message instead of three.",
          why: "A noticeable share of your messages are follow-ups sent while still waiting for a reply.",
        },
        {
          action: "Turn one follow-up burst into a single message with the important point in it.",
          why: "One clear message reads as less pressure than a stack of follow-ups.",
        },
      ];
    case "initiation":
      return [
        {
          action: "Start one conversation this week, then leave the next start to them.",
          why: "Conversation starts are lopsided in this export; alternating starts evens out the effort.",
        },
        {
          action: "When you want to talk, say so directly instead of waiting to be opened to.",
          why: "Direct asks are easier to answer than hints and keep initiation from feeling like a test.",
        },
      ];
    case "small-sample":
      return [
        {
          action: `Log three conversations this week: who started, how long replies took, and how they ended.`,
          why: `This export has ${features.sample.messageCount} messages, so more examples would sharpen the read. Confidence is currently ${confidencePercent(confidence)}.`,
        },
        {
          action: "Export the last month again next week and compare the two reports.",
          why: "A second sample distinguishes a real pattern from a short stretch.",
        },
        {
          action: "Ask one direct question this week instead of reading between the lines.",
          why: "Clear answers beat inference, especially when the sample is small.",
        },
      ];
    default: {
      // Weakest-dimension focuses fall back to the same playbooks as their risk keys.
      if (focus.dimensionId === "conflict_repair") return actionsForFocus({ ...focus, key: "conflict-repair" }, context);
      if (focus.dimensionId === "responsiveness") return actionsForFocus({ ...focus, key: "reply-pace" }, context);
      if (focus.dimensionId === "reciprocity") return actionsForFocus({ ...focus, key: "reciprocity" }, context);
      if (focus.dimensionId === "atmosphere") return actionsForFocus({ ...focus, key: "atmosphere" }, context);
      if (focus.dimensionId === "investment_consistency") return actionsForFocus({ ...focus, key: "consistency" }, context);
      return [];
    }
  }
}

const MAINTENANCE_ACTIONS: Array<{ action: string; why: string }> = [
  {
    action: "Keep one weekly check-in on the calendar and protect it for seven days.",
    why: "A predictable ritual protects the strongest parts of what the data already shows.",
  },
  {
    action: "Send one specific thank-you before the week ends - name the exact thing they did.",
    why: "Specific appreciation is harder to dismiss than a generic one.",
  },
  {
    action: "Ask one question you don't already know the answer to.",
    why: "New information keeps a familiar conversation from becoming a routine report.",
  },
  {
    action: "When a plan changes, say it early instead of going quiet.",
    why: "Early updates prevent a silence from being read as disinterest.",
  },
  {
    action: "Take one conversation off autopilot: ask what made their day hard.",
    why: "Small invitations to be honest keep the warm signals warm.",
  },
  {
    action: "Share one small thing you noticed about them, out loud.",
    why: "Showing attention is a low-cost way to keep reciprocity from drifting.",
  },
  {
    action: "Try a voice note or a call where a long thread would usually happen.",
    why: "A different medium can carry warmth that text strips out.",
  },
];

const FALLBACK_ACTIONS: Array<{ action: string; why: string }> = [
  {
    action: "Pick the one conversation you would most like to understand better and re-read it before replying next time.",
    why: "Reading before replying creates a small pause where a different response is possible.",
  },
  {
    action: "Set a reminder to check in once this week with no agenda attached.",
    why: "Contact without an agenda is easy to skip and unusually reassuring.",
  },
  {
    action: "Write down one thing you appreciated this week and say it directly.",
    why: "Unsaid appreciation cannot show up in the data.",
  },
  {
    action: "When you notice a tense exchange, ask one clarifying question before defending yourself.",
    why: "Clarifying first lowers the chance of a misunderstanding turning into a pattern.",
  },
  {
    action: "Keep the next vulnerable message the same length as your usual one.",
    why: "Changing register abruptly can read as a shift in the relationship.",
  },
  {
    action: "Choose one moment to put the phone down and finish the conversation later.",
    why: "Pauses are a tool, not a withdrawal, when they are named.",
  },
  {
    action: "At the end of the week, note which message felt easiest to send.",
    why: "Noticing what feels easy is a clue to how you want to communicate.",
  },
];

function buildNextSevenDays(
  features: ReportFeatures,
  sparse: boolean,
): NextSevenDaysChapter {
  const dimensions = dimensionMap(features);
  const focuses = buildFocusOrder(features, sparse);
  const context: ActionContext = { features, dimensions };
  const collected: RawAction[] = [];
  const seenActions = new Set<string>();
  const addFrom = (focus: Focus, entries: Array<{ action: string; why: string }>) => {
    for (const entry of entries) {
      if (collected.length >= 7) return;
      if (seenActions.has(entry.action)) continue;
      seenActions.add(entry.action);
      collected.push({
        action: entry.action,
        why: entry.why,
        targetDimension: focus.dimensionId,
        source: focus.source,
      });
    }
  };

  for (const focus of focuses) {
    if (collected.length >= 7) break;
    addFrom(focus, actionsForFocus(focus, context));
  }
  if (collected.length < 7) {
    addFrom(
      { key: "maintenance", label: "Maintenance", dimensionId: null, severity: 0, source: "maintenance" },
      MAINTENANCE_ACTIONS,
    );
  }
  if (collected.length < 7) {
    addFrom(
      { key: "maintenance", label: "Maintenance", dimensionId: null, severity: 0, source: "maintenance" },
      FALLBACK_ACTIONS,
    );
  }

  const actions: ActionItem[] = collected.slice(0, 7).map((entry, index) => ({
    day: index + 1,
    dayLabel: `Day ${index + 1}`,
    action: entry.action,
    why: entry.why,
    targetDimension: entry.targetDimension,
    source: entry.source,
  }));

  const focusDimensions: DimensionId[] = [];
  for (const entry of collected) {
    if (entry.targetDimension !== null && !focusDimensions.includes(entry.targetDimension)) {
      focusDimensions.push(entry.targetDimension);
    }
  }
  const focusLabels: string[] = [];
  for (const focus of focuses) {
    if (collected.some((entry) => entry.targetDimension === focus.dimensionId && focus.dimensionId !== null)) {
      if (!focusLabels.includes(focus.label)) focusLabels.push(focus.label);
    }
  }
  const summary = sparse
    ? `Not enough data for a targeted plan, so these are seven low-risk experiments rather than fixes. ` +
      `They still follow the weakest signals (${focusLabels.length > 0 ? focusLabels.join(", ") : "maintenance"}).`
    : focusLabels.length === 0
      ? "All five dimensions are steady, so this week protects what already works rather than fixing a weak spot. " +
        "One action per day; skip anything that does not fit your situation."
      : `Selected from your weakest signals - ${focusLabels.join(", ")}. ` +
        "One action per day; skip anything that does not fit your situation.";

  return {
    id: "next-7-days",
    number: 6,
    title: "The next 7 days",
    summary,
    focusDimensions,
    actions,
    dataNotEnough: sparse,
  };
}

/* -------------------------------------------------------------------------------------------------
 * Public entry point
 * ------------------------------------------------------------------------------------------------*/

function generatedAtFrom(features: ReportFeatures, conversation: Conversation, options: BuildReportOptions): string {
  if (typeof options.generatedAt === "string" && options.generatedAt.trim().length > 0) {
    return options.generatedAt;
  }
  if (conversation.meta.endedAt !== null) return new Date(conversation.meta.endedAt).toISOString();
  if (features.sample.endedAt !== null) return new Date(features.sample.endedAt).toISOString();
  return "unknown";
}

/**
 * Turn rule-layer features + the matched conversation into the six-chapter
 * English report. Pure and deterministic; see the file header.
 */
export function buildReportV2(
  features: ReportFeatures,
  conversation: Conversation,
  options: BuildReportOptions = {},
): ReportDataV2 {
  const sparse = features.sample.messageCount < 12;
  const meta: ReportMeta = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    weightsVersion: features.versions.weights,
    metricsVersion: features.versions.metrics,
    attachmentRuleVersion: features.versions.attachmentRule,
    generatedAt: generatedAtFrom(features, conversation, options),
    sample: {
      messages: features.sample.messageCount,
      dateRange: features.sample.dateRangeLabel,
      durationDays: features.sample.durationDays,
      timestampedMessages: features.sample.timestampedCount,
    },
  };
  const headline = buildHeadline(features);
  const glance = buildAtAGlance(features);
  const attachment = buildAttachmentChapter(features, conversation);
  const health = buildHealthChapter(features);
  const turningPoints = buildTurningPoints(features, conversation);
  const candidates = collectCandidates(features, conversation, turningPoints);
  const evidence = selectEvidence(candidates, conversation);
  const whatWeDontKnow = buildWhatWeDontKnow(features, conversation, evidence);
  const evidenceChapter = buildEvidenceChapter(features, conversation, evidence, whatWeDontKnow);
  const nextSevenDays = buildNextSevenDays(features, sparse);

  const chapters: [
    AtAGlanceChapter,
    AttachmentChapter,
    CommunicationHealthChapter,
    TurningPointsChapter,
    EvidenceConfidenceChapter,
    NextSevenDaysChapter,
  ] = [glance, attachment, health, turningPoints, evidenceChapter, nextSevenDays];

  return {
    meta,
    headline,
    chapters,
    evidence,
    disclaimer: REPORT_DISCLAIMER,
    whatWeDontKnow,
    dataQuality: {
      confidence: features.dataQuality.confidence,
      confidenceLabel: confidenceLabel(features.dataQuality.confidence),
      lowSample: features.dataQuality.lowSample,
      timestampCoverage: features.dataQuality.timestampCoverage,
      needsDateConfirmation: features.dataQuality.needsDateConfirmation,
      warnings: [...features.dataQuality.warnings],
    },
  };
}

/** Narrowing helper for renderers that switch on `chapter.id`. */
export function isReportChapter(value: ReportChapter, id: ChapterId): boolean {
  return value.id === id;
}
