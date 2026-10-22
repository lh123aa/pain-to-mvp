/**
 * 粘贴文本适配器（M1 · FR-1 / FR-3 无时序替代卡）
 *
 * 约束（PRD v1.1）：
 * - 粘贴文本通常**没有时间戳** → 解析必须"保守"：不编造时间、不跑任何节奏类指标；
 *   免费三卡退化为无时序替代卡（消息量比 + double-text 率 + 平均回合长度，AC-3.3）。
 * - 只认真实存在的说话人标签：`Name: text`（冒号后必须有空格或行尾）。无标签的续行
 *   原样并入上一条消息（多行消息），不推断说话人。
 * - 若粘贴内容其实是 WhatsApp 导出片段（检测到足够多 header），直接委托给 whatsapp-txt，
 *   不降级——但日期顺序/说话人仍需上行确认。
 *
 * 与 whatsapp 适配器共享全部类型与说话人映射 API（speaker-map.ts），因此 UI 只需切换 Tab。
 */
import type {
  ChatMeta,
  DateOrder,
  NormalizedMessage,
  ParseIssue,
  ParseResult,
  ParsedChat,
  Participant,
} from "./types";
import { classifyTextKind, detectInputFormat, normalizeLine, parseWhatsAppTxt } from "./whatsapp-txt";

export interface PasteParseOptions {
  /** 若用户先选了日期格式（粘贴里其实带时间戳），委托 WhatsApp 解析时使用。 */
  dateOrder?: DateOrder;
}

interface ParticipantBuilder {
  id: string;
  displayName: string;
  messageCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  firstMessageId: string | null;
  secondMessageId: string | null;
}

function splitPasteLine(line: string): { senderName: string | null; text: string } {
  const normalized = normalizeLine(line);
  // 逐行输入，不含换行 ⇒ 不需要 dotAll（`s` flag 在 tsconfig target ES2017 下不可用）。
  const m = /^([^:]{1,64}):(?:\s(.*))?$/.exec(normalized);
  if (!m) return { senderName: null, text: normalized };
  const name = m[1].trim();
  if (!name) return { senderName: null, text: normalized };
  if (/https?:/i.test(name) || /[<>]/.test(name)) return { senderName: null, text: normalized };
  // 含句末标点 + 多词 ⇒ 大概率是一句叙述而非昵称（保守，不猜）。
  if (/[.!?]$/.test(name) && name.split(/\s+/).length > 3) {
    return { senderName: null, text: normalized };
  }
  return { senderName: name, text: m[2] ?? "" };
}

function emptyChat(platform: ParsedChat["platform"]): ParsedChat {
  const meta: ChatMeta = {
    platform,
    lineCount: 0,
    messageCount: 0,
    systemCount: 0,
    participantCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    timestampCoverage: 0,
    timestampPrecision: "none",
    timestampBasis: "wall-clock-utc",
    dateOrder: "unknown",
    dateOrderConfidence: 0,
    dateOrderSource: "none",
    needsDateConfirmation: false,
    preamble: [],
    tier: "standard",
  };
  return { platform, messages: [], participants: [], meta, issues: [] };
}

/**
 * 解析无时间戳的粘贴对话。
 *
 * 返回的 ParsedChat.messages[].timestamp 全为 null；说话人映射仍需用户显式确认
 * （speaker-map.createSpeakerMap），未确认前调用方不得展示任何分析结果（FR-2）。
 */
export function parsePastedText(input: string, options: PasteParseOptions = {}): ParseResult {
  const detection = detectInputFormat(input);
  if (detection.format === "whatsapp" && detection.confidence >= 0.6) {
    // 粘贴里其实是标准导出片段：不降级，交给完整适配器。
    return parseWhatsAppTxt(input, { dateOrder: options.dateOrder });
  }

  const issues: ParseIssue[] = [];
  const rawLines = input.split(/\r\n|\n|\r/);
  const messages: NormalizedMessage[] = [];
  const participantMap = new Map<string, ParticipantBuilder>();
  const preamble: string[] = [];
  let messageSeq = 0;

  for (let i = 0; i < rawLines.length; i += 1) {
    const rawLine = rawLines[i] ?? "";
    const trimmed = normalizeLine(rawLine).trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue; // fixture 注释 / 用户备注，不进入对话

    const split = splitPasteLine(rawLine);
    if (split.senderName === null) {
      const prev = messages[messages.length - 1];
      if (prev) {
        prev.text = prev.text.length > 0 ? `${prev.text}\n${normalizeLine(rawLine)}` : normalizeLine(rawLine);
      } else {
        preamble.push(rawLine);
      }
      continue;
    }

    const key = split.senderName.toLowerCase();
    let participant = participantMap.get(key);
    if (!participant) {
      participant = {
        id: `s${participantMap.size + 1}`,
        displayName: split.senderName,
        messageCount: 0,
        firstTimestamp: null,
        lastTimestamp: null,
        firstMessageId: null,
        secondMessageId: null,
      };
      participantMap.set(key, participant);
    }

    const classification = classifyTextKind(split.text);
    messageSeq += 1;
    const id = `m${messageSeq}`;
    messages.push({
      id,
      timestamp: null,
      senderId: participant.id,
      senderName: split.senderName,
      text: split.text,
      isSystem: false,
      kind: classification.kind,
      hasMedia: classification.hasMedia,
      lineNumber: i + 1,
    });
    participant.messageCount += 1;
    if (participant.firstMessageId === null) participant.firstMessageId = id;
    else if (participant.secondMessageId === null) participant.secondMessageId = id;
  }

  const participants: Participant[] = [...participantMap.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    messageCount: p.messageCount,
    firstTimestamp: null,
    lastTimestamp: null,
    anchorMessageId: p.secondMessageId ?? p.firstMessageId,
  }));

  if (preamble.length > 0) {
    issues.push({
      code: "W-PREAMBLE",
      severity: "warning",
      message: "Some lines before the first message were not part of the conversation",
      detail: `${preamble.length} line(s) skipped`,
    });
  }
  if (messages.length === 0) {
    issues.push({
      code: "E-7",
      severity: "error",
      message: "I couldn't read this paste",
      hint: 'Put each message on its own line, like "Me: ..." or "Alex: ...".',
    });
  } else {
    issues.push({
      code: "W-UNTIMED",
      severity: "warning",
      message: "No timestamps in your paste",
      hint: "Showing what we can read from the text itself.",
    });
    if (messages.length < 500) {
      issues.push({
        code: "W-SMALL-SAMPLE",
        severity: "warning",
        message: "Small dataset",
        hint: "The report will say so and lower its confidence.",
        detail: `${messages.length} messages`,
      });
    }
  }

  const chat: ParsedChat = {
    platform: "paste",
    messages,
    participants,
    meta: {
      platform: "paste",
      lineCount: rawLines.length,
      messageCount: messages.length,
      systemCount: 0,
      participantCount: participants.length,
      firstTimestamp: null,
      lastTimestamp: null,
      timestampCoverage: 0,
      timestampPrecision: "none",
      timestampBasis: "wall-clock-utc",
      dateOrder: "unknown",
      dateOrderConfidence: 0,
      dateOrderSource: "none",
      needsDateConfirmation: false,
      preamble: preamble.slice(0, 10),
      tier: "standard",
    },
    issues,
  };

  return { ok: !issues.some((issue) => issue.severity === "error"), chat, issues };
}

export { emptyChat };
