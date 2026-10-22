/**
 * WhatsApp 官方导出 .txt 适配器（M1 · FR-1）
 *
 * 覆盖的方言（PRD AC-1.2 fixture 矩阵的核心子集）：
 * 1. Android 24h 方括号：   `[05/11/2023, 14:32:10] Alex: hi`
 * 2. Android 24h 无括号：   `05/11/2023, 14:32 - Alex: hi`
 * 3. iOS 12h 空格/无括号：  `3/4/24, 9:15 AM - Alex: hi`（兼容 U+202F 窄空格）
 * 4. iOS 12h 方括号：       `[3/4/24, 9:15:22 AM] Alex: hi`
 * 5. 欧陆点分隔：           `05.11.2023, 14:32 - Alex: hi`（默认识别为 DMY，仍需用户确认）
 * 6. ISO 风格：             `2023-11-05, 14:32 - Alex: hi`
 * 7. 多语言月份名：         `12 de enero de 2026, 10:30 - Alex: hola` / `3. März 2026, 18:05 - Alex: hallo`
 *                           `Mar 4, 2026, 9:15 AM - Alex: hi`（月份在前的英文方言）
 *
 * 其它要求：
 * - 多行消息：非 header 行合并进上一条消息（保留换行）。
 * - 系统消息：header + 无 `Name:` 前缀 → isSystem（如端到端加密声明、改主题、加人）。
 * - `<Media omitted>` / `<attached: …>` / `image omitted` / 已删除 / 通话记录 → kind 分类。
 * - 日期歧义（03/04/26）：先收集全部 header 的 >12 证据再定顺序（cross-inference）；
 *   无证据时用保守默认值 **并要求 UI 确认一次**（PRD FR-1 / 细化方案 §3.2），绝不静默猜。
 * - 时间戳 = wall-clock epoch ms（见 types.ts 注释），测试与机器时区无关。
 *
 * 明确不做（诚实边界）：
 * - 无法可靠区分"转发内容里的伪时间戳行"——只要行首形如 header 就会被当作新消息。
 *   这是纯文本格式的固有极限，记录在 W-* 警告里由报告层做置信度降级。
 * - 不做按性别/左右/语气的说话人推断（FR-2 铁律），只产出 senderId，角色映射见 speaker-map.ts。
 */
import type {
  ChatMeta,
  DateOrder,
  DateOrderSource,
  MessageKind,
  NormalizedMessage,
  ParseIssue,
  ParseResult,
  ParsedChat,
  Participant,
  Platform,
  TimestampPrecision,
} from "./types";

/* -------------------------------------------------------------------------------------------------
 * 方言识别：header 正则
 * ------------------------------------------------------------------------------------------------*/

const DASH = "[-–—]";
const MERIDIEM = String.raw`(?:\s*([ap])\.?\s?m?\.?)?`;

/** 解析出的 header（日期字段尚未按顺序解释）。 */
export interface HeaderMatch {
  style: "bracketed" | "plain" | "month-last" | "month-first";
  /** 数字型日期的三段：a/b/c 与 a 的位数（用于判 YMD）。 */
  parts: { a: number; b: number; c: number; aWidth: number; bWidth: number; cWidth: number };
  /** 月份名方言已解出的显式日期。 */
  explicitDate?: { year: number; month: number; day: number };
  time: { hour: number; minute: number; second: number | null; meridiem: "am" | "pm" | null };
  /** header 之后、说话人之前的正文（可能还含 "Name: " 前缀）。 */
  rest: string;
  separator: "/" | "." | "-";
}

const BRACKET_RE = new RegExp(
  String.raw`^\[(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),\s*(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?${MERIDIEM}\]\s*(?:${DASH}\s*)?(.*)$`,
  "i",
);
const PLAIN_RE = new RegExp(
  String.raw`^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),\s*(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?${MERIDIEM}\s*(?:${DASH}\s*)(.*)$`,
  "i",
);
const MONTH_LAST_RE = new RegExp(
  String.raw`^\[?(\d{1,2})(?:\.)?\s+(?:de\s+|del\s+|of\s+)?([A-Za-zÀ-ÖØ-öø-ÿ]+)\.?\s+(?:de\s+|del\s+|of\s+)?(\d{2,4})(?:,\s*|\s+)(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?${MERIDIEM}\]?\s*(?:${DASH}\s*)?(.*)$`,
  "i",
);
const MONTH_FIRST_RE = new RegExp(
  String.raw`^\[?([A-Za-zÀ-ÖØ-öø-ÿ]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})(?:,\s*|\s+)(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?${MERIDIEM}\]?\s*(?:${DASH}\s*)?(.*)$`,
  "i",
);

/** 月份名 → 1..12（en/es/de；NFD 去掉变音符号后匹配，如 märz→marz）。 */
const MONTH_NAMES: Readonly<Record<string, number>> = {
  january: 1, jan: 1, enero: 1, januar: 1,
  february: 2, feb: 2, febrero: 2, februar: 2,
  march: 3, mar: 3, marzo: 3, marz: 3, maerz: 3,
  april: 4, apr: 4, abril: 4,
  may: 5, mayo: 5, mai: 5,
  june: 6, jun: 6, junio: 6, juni: 6,
  july: 7, jul: 7, julio: 7, juli: 7,
  august: 8, aug: 8, agosto: 8,
  september: 9, sep: 9, sept: 9, septiembre: 9, setiembre: 9,
  october: 10, oct: 10, octubre: 10, oktober: 10, okt: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dezember: 12, dez: 12,
};

function normalizeMonthToken(token: string): number | null {
  const key = token
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.$/, "");
  return MONTH_NAMES[key] ?? null;
}

/** 去掉行首的 LRM/RLM/方向控制符（iOS 导出常见），并归一化窄空格。 */
export function normalizeLine(line: string): string {
  return line
    .replace(/^[\u200e\u200f\u202a-\u202e\ufeff]+/, "")
    .replace(/[\u202f\u00a0]/g, " ");
}

function toMeridiem(raw: string | undefined): "am" | "pm" | null {
  if (!raw) return null;
  return raw.toLowerCase() === "a" ? "am" : "pm";
}

/**
 * 尝试把一行识别为 WhatsApp 消息 header（不做日期合法性校验，校验在 resolveDate 中）。
 * 导出给 detectInputFormat / 测试使用。
 */
export function matchHeaderLine(rawLine: string): HeaderMatch | null {
  const line = normalizeLine(rawLine);
  if (!line) return null;

  let m = BRACKET_RE.exec(line);
  if (m) {
    return {
      style: "bracketed",
      parts: partsOf(m[1], m[2], m[3]),
      time: timeOf(m[4], m[5], m[6], m[7]),
      rest: m[8] ?? "",
      separator: separatorOfLine(line),
    };
  }

  m = PLAIN_RE.exec(line);
  if (m) {
    return {
      style: "plain",
      parts: partsOf(m[1], m[2], m[3]),
      time: timeOf(m[4], m[5], m[6], m[7]),
      rest: m[8] ?? "",
      separator: separatorOfLine(line),
    };
  }

  m = MONTH_LAST_RE.exec(line);
  if (m) {
    const month = normalizeMonthToken(m[2]);
    if (month !== null) {
      return {
        style: "month-last",
        parts: { a: 0, b: 0, c: 0, aWidth: 0, bWidth: 0, cWidth: 0 },
        explicitDate: { year: Number(m[3]), month, day: Number(m[1]) },
        time: timeOf(m[4], m[5], m[6], m[7]),
        rest: m[8] ?? "",
        separator: "/",
      };
    }
  }

  m = MONTH_FIRST_RE.exec(line);
  if (m) {
    const month = normalizeMonthToken(m[1]);
    if (month !== null) {
      return {
        style: "month-first",
        parts: { a: 0, b: 0, c: 0, aWidth: 0, bWidth: 0, cWidth: 0 },
        explicitDate: { year: Number(m[3]), month, day: Number(m[2]) },
        time: timeOf(m[4], m[5], m[6], m[7]),
        rest: m[8] ?? "",
        separator: "/",
      };
    }
  }

  return null;
}

function partsOf(a: string, b: string, c: string): HeaderMatch["parts"] {
  return {
    a: Number(a),
    b: Number(b),
    c: Number(c),
    aWidth: a.length,
    bWidth: b.length,
    cWidth: c.length,
  };
}

function timeOf(
  hour: string,
  minute: string,
  second: string | undefined,
  meridiem: string | undefined,
): HeaderMatch["time"] {
  return {
    hour: Number(hour),
    minute: Number(minute),
    second: second === undefined ? null : Number(second),
    meridiem: toMeridiem(meridiem),
  };
}

/** 取日期第一段与第二段之间真实的分隔符（点分隔 → 默认 DMY 启发式）。 */
function separatorOfLine(line: string): HeaderMatch["separator"] {
  const m = /\d([./-])\d/.exec(line);
  const sep = m?.[1];
  if (sep === ".") return ".";
  if (sep === "-") return "-";
  return "/";
}

/* -------------------------------------------------------------------------------------------------
 * 日期顺序推断（cross-inference，PRD FR-1）
 * ------------------------------------------------------------------------------------------------*/

interface OrderInference {
  order: DateOrder | "unknown";
  confidence: number;
  source: DateOrderSource;
  needsConfirmation: boolean;
}

/**
 * 从全部 header 交叉推断日/月顺序：
 * - 任一 header 的第一段 >12 ⇒ 第一段是"日" ⇒ DMY；
 * - 第一段 ≤12 而第二段 >12 ⇒ 第二段是"日" ⇒ MDY；
 * - 月份名方言本身已显式给出顺序（day-month-year / month-day-year）；
 * - 全部第一段是 4 位或 >31 ⇒ YMD。
 * 两类证据冲突时取多数并把 confidence 打到 0.3（必须让用户确认）。
 * 无任何证据 ⇒ 保守默认（12h→MDY，点分隔→DMY，其余→DMY）并 needsDateConfirmation=true。
 */
function inferDateOrder(headers: HeaderMatch[], explicit?: DateOrder): OrderInference {
  if (explicit) {
    return { order: explicit, confidence: 1, source: "explicit", needsConfirmation: false };
  }

  const numeric = headers.filter((h) => !h.explicitDate);
  const allYearFirst =
    numeric.length > 0 &&
    numeric.every((h) => h.parts.aWidth === 4 || h.parts.a > 31);

  let dmy = 0;
  let mdy = 0;
  let ymd = 0;
  let sawMeridiem = false;
  let sawDot = false;

  for (const h of headers) {
    if (h.time.meridiem) sawMeridiem = true;
    if (h.separator === ".") sawDot = true;

    if (h.explicitDate) {
      // 月份名方言：month-last（12 de enero）⇒ DMY；month-first（Mar 4）⇒ MDY
      if (h.style === "month-last") dmy += 1;
      else if (h.style === "month-first") mdy += 1;
      continue;
    }

    if (h.parts.aWidth === 4 || h.parts.a > 31) {
      ymd += 1;
      continue;
    }
    if (h.parts.a > 12 && h.parts.a <= 31) {
      dmy += 1;
    } else if (h.parts.b > 12 && h.parts.b <= 31) {
      mdy += 1;
    }
  }

  if (dmy > 0 && mdy > 0) {
    return {
      order: dmy >= mdy ? "DMY" : "MDY",
      confidence: 0.3,
      source: "heuristic",
      needsConfirmation: true,
    };
  }
  if (dmy > 0) {
    return { order: "DMY", confidence: 1, source: "evidence", needsConfirmation: false };
  }
  if (mdy > 0) {
    return { order: "MDY", confidence: 1, source: "evidence", needsConfirmation: false };
  }
  if (ymd > 0 && allYearFirst && ymd === numeric.length) {
    return { order: "YMD", confidence: 1, source: "evidence", needsConfirmation: false };
  }

  // 无证据：保守默认 + 强制确认（不猜）。
  if (sawMeridiem) {
    return { order: "MDY", confidence: 0.55, source: "heuristic", needsConfirmation: true };
  }
  if (sawDot) {
    return { order: "DMY", confidence: 0.6, source: "heuristic", needsConfirmation: true };
  }
  return { order: "DMY", confidence: 0.5, source: "heuristic", needsConfirmation: true };
}

interface ResolvedDate {
  timestamp: number;
  precision: "second" | "minute";
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  if (year >= 100) return 1900 + year;
  return year < 70 ? 2000 + year : 1900 + year;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 把 header 的日期字段按推断顺序解释成 wall-clock epoch；非法日期返回 null。 */
function resolveDate(header: HeaderMatch, order: DateOrder): ResolvedDate | null {
  let year: number;
  let month: number;
  let day: number;

  if (header.explicitDate) {
    ({ year, month, day } = header.explicitDate);
  } else if (header.parts.aWidth === 4 || header.parts.a > 31) {
    year = header.parts.a;
    month = header.parts.b;
    day = header.parts.c;
  } else if (order === "MDY") {
    month = header.parts.a;
    day = header.parts.b;
    year = header.parts.c;
  } else {
    // DMY（YMD 与 DMY 冲突的混合方言退化为 DMY）
    day = header.parts.a;
    month = header.parts.b;
    year = header.parts.c;
  }

  year = expandYear(year);
  if (!Number.isFinite(year) || year < 1970 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const time = header.time;
  let hour = time.hour;
  if (time.meridiem === "pm" && hour < 12) hour += 12;
  if (time.meridiem === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  if (time.minute < 0 || time.minute > 59) return null;
  const second = time.second ?? 0;
  if (second < 0 || second > 59) return null;

  return {
    timestamp: Date.UTC(year, month - 1, day, hour, time.minute, second),
    precision: time.second === null ? "minute" : "second",
  };
}

/* -------------------------------------------------------------------------------------------------
 * 消息正文分类（系统消息 / 媒体 / 已删除 / 通话）
 * ------------------------------------------------------------------------------------------------*/

const SYSTEM_ONLY_TEXT = [
  /^messages (and calls|to this chat) (are|and calls are) (now )?end-to-end encrypted/i,
  /^messages and calls are end-to-end encrypted/i,
  /changed (the subject|this group'?s icon|the group icon|the phone number)/i,
  /^(you|.+?) (added|removed|left|created group|joined|were added)/i,
  /^(tap to learn more|learn more)\.?$/i,
  /^your security code with .+ changed/i,
];

/**
 * 是否为"仅系统消息"文案（用于给无 sender 的 header 行保底分类；
 * 带 sender 的真实消息永远按用户消息处理，避免误吞）。
 */
export function isSystemOnlyText(text: string): boolean {
  const t = normalizeLine(text).trim();
  return SYSTEM_ONLY_TEXT.some((re) => re.test(t));
}

/** 文本型消息的 kind 分类（媒体占位 / 已删除 / 通话 / 普通文本）。 */
export function classifyTextKind(text: string): { kind: MessageKind; hasMedia: boolean } {
  const t = text.replace(/^[\u200e\u200f\u202a-\u202e\s]+/, "").trim();
  if (/^(this message was deleted|you deleted this message)\.?$/i.test(t)) {
    return { kind: "deleted", hasMedia: false };
  }
  if (/^missed (voice|video) call\.?$/i.test(t)) {
    return { kind: "call", hasMedia: false };
  }
  if (
    /^<?(media omitted|attached:.*?)>?$/i.test(t) ||
    /^(image|video|audio|document|sticker|gif|contact card) omitted\.?$/i.test(t) ||
    /^<attached:.*>$/i.test(t)
  ) {
    return { kind: "media", hasMedia: true };
  }
  return { kind: "text", hasMedia: false };
}

/* -------------------------------------------------------------------------------------------------
 * header 正文拆分：Sender: text
 * ------------------------------------------------------------------------------------------------*/

interface SplitMessage {
  senderName: string | null;
  text: string;
}

function splitSender(rawRest: string): SplitMessage {
  const rest = normalizeLine(rawRest);
  if (!rest) return { senderName: null, text: "" };
  // 只认 "Name: " / "Name:"（冒号后必须是空格或行尾），避免把 "see http://x" 当成说话人。
  // rest 来自单行 split，不含换行 ⇒ 不需要 dotAll（`s` flag 在 tsconfig target ES2017 下不可用）。
  const m = /^([^:]{1,64}):(?:\s(.*))?$/.exec(rest);
  if (!m) return { senderName: null, text: rest };

  const name = m[1].trim();
  if (!name) return { senderName: null, text: rest };
  if (/https?:/i.test(name) || /[<>]/.test(name)) return { senderName: null, text: rest };
  // 明显不是昵称的句子（含标点/超长）按系统消息处理，避免伪造时间戳的转发行污染说话人表。
  if (/[.!?]$/.test(name) && name.split(/\s+/).length > 3) {
    return { senderName: null, text: rest };
  }
  return { senderName: name, text: m[2] ?? "" };
}

/* -------------------------------------------------------------------------------------------------
 * 主解析函数
 * ------------------------------------------------------------------------------------------------*/

export interface ParseOptions {
  /** 用户在确认条里选定的日期顺序；给出后不再推断、不再要求确认。 */
  dateOrder?: DateOrder;
}

type Block =
  | {
      kind: "header";
      line: number;
      header: HeaderMatch;
      senderName: string | null;
      text: string;
    }
  | { kind: "preamble"; line: number; text: string };

interface ParticipantBuilder {
  id: string;
  displayName: string;
  messageCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  firstMessageId: string | null;
  secondMessageId: string | null;
}

const MAX_PRINTABLE = 80_000;
const MAX_DEEP = 150_000;

/**
 * 解析 WhatsApp 导出文本。
 *
 * 空文本 / 找不到任何时间戳 → ok=false + E-3（"I couldn't find timestamps"），
 * 但仍返回结构完整的空 chat，UI 据此渲染错误态（PRD AC-1.3 / E-3）。
 */
export function parseWhatsAppTxt(input: string, options: ParseOptions = {}): ParseResult {
  const issues: ParseIssue[] = [];
  const rawLines = input.split(/\r\n|\n|\r/);
  const blocks: Block[] = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const rawLine = rawLines[i] ?? "";
    // 空行（含文件末尾换行产生的空行）不构成消息，也不并入上一条正文。
    if (rawLine.trim().length === 0) continue;
    const header = matchHeaderLine(rawLine);
    if (header) {
      const split = splitSender(header.rest);
      blocks.push({
        kind: "header",
        line: i + 1,
        header,
        senderName: split.senderName,
        text: split.text,
      });
      continue;
    }

    const last = blocks[blocks.length - 1];
    if (last && last.kind === "header") {
      // 多行消息：续行原样并入上一条（保留原始缩进与 emoji）。
      last.text = last.text.length > 0 ? `${last.text}\n${normalizeLine(rawLine)}` : normalizeLine(rawLine);
    } else {
      blocks.push({ kind: "preamble", line: i + 1, text: rawLine });
    }
  }

  const headerBlocks = blocks.filter((b): b is Extract<Block, { kind: "header" }> => b.kind === "header");
  const headers = headerBlocks.map((b) => b.header);
  const inference = inferDateOrder(headers, options.dateOrder);

  const messages: NormalizedMessage[] = [];
  const participantMap = new Map<string, ParticipantBuilder>();
  let messageSeq = 0;
  let systemCount = 0;

  const pushSystem = (text: string, timestamp: number | null, kind: MessageKind = "text", lineNumber?: number) => {
    messageSeq += 1;
    messages.push({
      id: `m${messageSeq}`,
      timestamp,
      senderId: null,
      senderName: "",
      text,
      isSystem: true,
      kind,
      hasMedia: false,
      lineNumber,
    });
    systemCount += 1;
  };

  for (const block of blocks) {
    if (block.kind === "preamble") continue;

    const resolved = resolveDate(block.header, inference.order === "unknown" ? "DMY" : inference.order);
    if (!resolved) {
      issues.push({
        code: "W-INVALID-DATE",
        severity: "warning",
        message: "One line looked like a timestamp but the date was invalid",
        hint: "We skipped that timestamp and kept its text with the previous message.",
        detail: `line ${block.line}`,
      });
      const prev = messages[messages.length - 1];
      if (prev) {
        prev.text = prev.text.length > 0 ? `${prev.text}\n${block.text}` : block.text;
      }
      continue;
    }

    if (block.senderName === null) {
      // 系统消息：header + 无 "Name:"。少数情况下正文明显是系统声明但带了 "Name:" 的，也降级。
      pushSystem(block.text, resolved.timestamp, "text", block.line);
      continue;
    }

    const classification = classifyTextKind(block.text);

    const key = block.senderName.toLowerCase();
    let participant = participantMap.get(key);
    if (!participant) {
      participant = {
        id: `s${participantMap.size + 1}`,
        displayName: block.senderName,
        messageCount: 0,
        firstTimestamp: null,
        lastTimestamp: null,
        firstMessageId: null,
        secondMessageId: null,
      };
      participantMap.set(key, participant);
    }

    messageSeq += 1;
    const id = `m${messageSeq}`;
    messages.push({
      id,
      timestamp: resolved.timestamp,
      senderId: participant.id,
      senderName: block.senderName,
      text: block.text,
      isSystem: false,
      kind: classification.kind,
      hasMedia: classification.hasMedia,
      lineNumber: block.line,
    });

    participant.messageCount += 1;
    if (participant.firstTimestamp === null) participant.firstTimestamp = resolved.timestamp;
    participant.lastTimestamp = resolved.timestamp;
    if (participant.firstMessageId === null) participant.firstMessageId = id;
    else if (participant.secondMessageId === null) participant.secondMessageId = id;
  }

  const participants: Participant[] = [...participantMap.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    messageCount: p.messageCount,
    firstTimestamp: p.firstTimestamp,
    lastTimestamp: p.lastTimestamp,
    anchorMessageId: p.secondMessageId ?? p.firstMessageId,
  }));

  const analysisMessages = messages.filter((m) => !m.isSystem);
  const timedMessages = analysisMessages.filter((m) => m.timestamp !== null);

  const preamble = blocks
    .filter((b): b is Extract<Block, { kind: "preamble" }> => b.kind === "preamble")
    .map((b) => b.text)
    .filter((t) => t.trim().length > 0);

  if (preamble.length > 0) {
    issues.push({
      code: "W-PREAMBLE",
      severity: "warning",
      message: "Some lines before the first message were not part of the conversation",
      detail: `${preamble.length} line(s) skipped`,
    });
  }
  if (inference.needsConfirmation) {
    issues.push({
      code: "W-DATE-AMBIGUOUS",
      severity: "warning",
      message: "Date format is ambiguous",
      hint: "We picked a default order — please confirm it once so every timing metric is right.",
      detail: `assumed ${inference.order} (confidence ${inference.confidence})`,
    });
  }
  if (headerBlocks.length === 0) {
    issues.push({
      code: "E-3",
      severity: "error",
      message: "I couldn't find timestamps",
      hint:
        "Without timestamps we can't analyze pacing. Try the standard export, or switch to paste mode — we'll show what we can read from the text itself.",
    });
  } else if (analysisMessages.length === 0) {
    issues.push({
      code: "W-NO-MESSAGES",
      severity: "warning",
      message: "This export contains no messages",
      hint: "Only system lines were found. Try a different export or paste the conversation.",
    });
  }
  if (analysisMessages.length > MAX_PRINTABLE) {
    issues.push({
      code: "E-5",
      severity: "warning",
      message: "Big conversation!",
      hint: "This is over the standard report range. Crop the date range, or choose the deep report.",
      detail: `${analysisMessages.length} messages`,
    });
  }
  if (participants.length > 2) {
    issues.push({
      code: "W-RENAME-SUSPECTED",
      severity: "warning",
      message: "More than two senders were found",
      hint: "This may be a group chat, or the same person changed their nickname mid-export. Confirm who is who next.",
      detail: `${participants.length} senders`,
    });
  }
  if (analysisMessages.length > 0 && analysisMessages.length < 500) {
    issues.push({
      code: "W-SMALL-SAMPLE",
      severity: "warning",
      message: "Small dataset",
      hint: "The report will say so and lower its confidence.",
      detail: `${analysisMessages.length} messages`,
    });
  }

  const firstTimestamp =
    timedMessages.length > 0 ? Math.min(...timedMessages.map((m) => m.timestamp as number)) : null;
  const lastTimestamp =
    timedMessages.length > 0 ? Math.max(...timedMessages.map((m) => m.timestamp as number)) : null;

  const timestampPrecision: TimestampPrecision =
    headers.length === 0
      ? "none"
      : headers.some((h) => h.time.second !== null)
        ? "second"
        : "minute";

  const meta: ChatMeta = {
    platform: "whatsapp",
    lineCount: rawLines.length,
    messageCount: analysisMessages.length,
    systemCount,
    participantCount: participants.length,
    firstTimestamp,
    lastTimestamp,
    timestampCoverage: analysisMessages.length === 0 ? 0 : timedMessages.length / analysisMessages.length,
    timestampPrecision,
    timestampBasis: "wall-clock-utc",
    dateOrder: inference.order,
    dateOrderConfidence: inference.confidence,
    dateOrderSource: inference.source,
    needsDateConfirmation: inference.needsConfirmation,
    preamble: preamble.slice(0, 10),
    tier: analysisMessages.length > MAX_DEEP ? "over-limit" : analysisMessages.length > MAX_PRINTABLE ? "deep" : "standard",
  };

  const chat: ParsedChat = {
    platform: "whatsapp",
    messages,
    participants,
    meta,
    issues,
  };

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    chat,
    issues,
  };
}

/* -------------------------------------------------------------------------------------------------
 * 格式检测（上传页 P-2 的文件护照卡 / Tab 自动切换）
 * ------------------------------------------------------------------------------------------------*/

export interface FormatDetection {
  format: Platform | "unknown";
  confidence: number;
  evidence: { sampledLines: number; headerLines: number; speakerLines: number };
}

const SPEAKER_LINE_RE = /^[^:]{1,64}:\s+\S/;

/** 用前 400 条非空行判断输入更像 WhatsApp 导出还是无时序粘贴。 */
export function detectInputFormat(text: string): FormatDetection {
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((l) => normalizeLine(l).trim())
    .filter((l) => l.length > 0)
    .slice(0, 400);

  let headerLines = 0;
  let speakerLines = 0;
  for (const line of lines) {
    if (matchHeaderLine(line)) headerLines += 1;
    else if (SPEAKER_LINE_RE.test(line) && !/^#/.test(line)) speakerLines += 1;
  }

  const sampledLines = lines.length;
  const headerRatio = sampledLines === 0 ? 0 : headerLines / sampledLines;
  const speakerRatio = sampledLines === 0 ? 0 : speakerLines / sampledLines;

  if (headerLines >= 2 && headerRatio >= 0.3) {
    return {
      format: "whatsapp",
      confidence: Math.min(1, Math.round((0.6 + headerRatio * 0.4) * 100) / 100),
      evidence: { sampledLines, headerLines, speakerLines },
    };
  }
  if (speakerLines >= 2 && speakerRatio >= 0.3) {
    return {
      format: "paste",
      confidence: Math.min(1, Math.round((0.4 + speakerRatio * 0.4) * 100) / 100),
      evidence: { sampledLines, headerLines, speakerLines },
    };
  }
  return {
    format: "unknown",
    confidence: 0,
    evidence: { sampledLines, headerLines, speakerLines },
  };
}
