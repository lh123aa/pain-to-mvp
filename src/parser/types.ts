/**
 * The Tell · 解析层公共类型（M1 · FR-1 / FR-2）
 *
 * 设计纪律（对齐 PRD v1.1）：
 * - **时间基**：WhatsApp/iMessage 导出只记录设备本地"钟面时间"，不含时区信息。
 *   本层把 `timestamp` 定义为 *wall-clock epoch ms*：`Date.UTC(本地年, 月-1, 日, 时, 分, 秒)`。
 *   好处：① 跨时区/夏令时不影响"记录到的间隔"（对应细化方案 Q-3「间隔指标按消息自带时区计算」）；
 *   ② 测试与运行机器时区无关，规则层输出零波动（PRD AC-5.4 要求的确定性）。
 * - **纯函数**：解析与规则层不得使用 Date.now() / 随机数 / 网络 / localStorage，保证可单测、可复算。
 * - **说话人未确认前不产出任何分析**（FR-2）：ParsedChat 只有 parser 级 `senderId`（s1/s2…），
 *   要拿到 Conversation（user/partner 角色）必须经过 speaker-map 的显式映射。
 */

/** 支持的输入平台；MVP 只做 whatsapp + paste，imessage 由适配器预留。 */
export type Platform = "whatsapp" | "imessage" | "paste";

/** 日期字段顺序；导出文件未声明时由解析层交叉推断（PRD FR-1 / 细化方案 §3.2 确认条）。 */
export type DateOrder = "DMY" | "MDY" | "YMD";

/** 日期顺序推断来源，供 UI 决定是否弹确认条。 */
export type DateOrderSource = "explicit" | "evidence" | "heuristic" | "none";

/** 时间戳精度：没有时间戳 → none（粘贴模式 / 无时序降级，AC-3.3）。 */
export type TimestampPrecision = "second" | "minute" | "none";

/** 消息类型：文本 / 媒体占位 / 已删除 / 通话记录。 */
export type MessageKind = "text" | "media" | "deleted" | "call";

/** 说话人角色（PRD FR-2：只允许"我 / 对方"，禁止按性别、左右、语气猜）。 */
export type SpeakerRole = "user" | "partner";

/**
 * 解析错误 / 警告码。
 * E-1~E-8 直接沿用 PRD 细化方案 §3.3 错误态全集编号（本层只用与解析相关的子集）；
 * W-* 为不阻断流程的诚实降级提示（计入 dataQuality，不上报用户内容）。
 */
export type ParseIssueCode =
  | "E-1"
  | "E-2"
  | "E-3"
  | "E-4"
  | "E-5"
  | "E-6"
  | "E-7"
  | "E-8"
  | "W-PREAMBLE"
  | "W-INVALID-DATE"
  | "W-DATE-AMBIGUOUS"
  | "W-UNTIMED"
  | "W-NO-MESSAGES"
  | "W-RENAME-SUSPECTED"
  | "W-SPEAKER-ALIAS-MERGED"
  | "W-PARTNER-SILENT"
  | "W-SMALL-SAMPLE"
  | "W-UNMAPPED-SENDER";

/** 可行动的英文错误提示（PRD AC-1.3：每个错误 = 标题 + 人话解释 + 一个修复动作）。 */
export interface ParseIssue {
  code: ParseIssueCode;
  severity: "error" | "warning";
  /** 面向用户的英文标题（可直接渲染）。 */
  message: string;
  /** 面向用户的一句解释 / 修复动作（可直接渲染）。 */
  hint?: string;
  /** 内部诊断信息，不含聊天原文。 */
  detail?: string;
}

/**
 * 归一化消息。system 消息（isSystem=true）也在 messages 中，保证"源文件行序"可追溯；
 * 分析层必须先过滤 system（见 Conversation：system 被单独拆走）。
 */
export interface NormalizedMessage {
  /** 稳定 id：`m1`…`mN`，按源文件消息顺序递增；证据引用只允许引用这个 id。 */
  id: string;
  /** wall-clock epoch ms；无时间戳（粘贴模式）为 null。 */
  timestamp: number | null;
  /** parser 级说话人 id（s1/s2…）；系统消息为 null。未映射前不得用于分析。 */
  senderId: string | null;
  /** 导出文件里显示的昵称（原样保留，含 emoji）。 */
  senderName: string;
  /** 原始消息正文（多行已用 \n 合并；媒体占位原文保留）。 */
  text: string;
  isSystem?: boolean;
  kind?: MessageKind;
  hasMedia?: boolean;
  /** 1-based 源文件行号（header 行），用于诊断与 fixture 对账。 */
  lineNumber?: number;
}

/** 解析器识别出的说话人（未确认角色）。 */
export interface Participant {
  id: string;
  displayName: string;
  messageCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  /** 锚点消息：该说话人的第 2 条消息（不足 2 条时取第 1 条），供 P-3 身份核对卡使用。 */
  anchorMessageId: string | null;
}

/** 解析元数据（不含聊天内容，可安全上报）。 */
export interface ChatMeta {
  platform: Platform;
  /** 源文本行数（含空行）。 */
  lineCount: number;
  /** 非系统消息数。 */
  messageCount: number;
  systemCount: number;
  participantCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  /** 有 timestamp 的非系统消息 / 非系统消息总数；0 表示完全无时序（粘贴模式）。 */
  timestampCoverage: number;
  timestampPrecision: TimestampPrecision;
  timestampBasis: "wall-clock-utc";
  dateOrder: DateOrder | "unknown";
  dateOrderConfidence: number;
  dateOrderSource: DateOrderSource;
  /** true = UI 必须弹一次日期确认条（PRD FR-1 低置信路径）。 */
  needsDateConfirmation: boolean;
  /** 文件头/前言行（通常来自 fixture 注释或导出附带说明），最多保留 10 条。 */
  preamble: string[];
  /** 计费档位：标准 ≤80k 条；深度 80k~150k；超限 >150k（PRD FR-7）。 */
  tier: "standard" | "deep" | "over-limit";
}

/** 解析结果：即使 ok=false 也返回可展示的 chat（UI 错误态不丢已解析内容）。 */
export interface ParsedChat {
  platform: Platform;
  messages: NormalizedMessage[];
  participants: Participant[];
  meta: ChatMeta;
  issues: ParseIssue[];
}

export interface ParseResult {
  ok: boolean;
  chat: ParsedChat;
  issues: ParseIssue[];
}

/** 说话人锁定的显式输入（P-3 确认卡提交的内容；只接受名字，不接受任何推断参数）。 */
export interface SpeakerMapInput {
  /** 你（可给多个昵称以归并改昵称：["Alice", "Al"]）。 */
  user?: string | string[];
  /** 对方（可选；只给 user 时，另一方由两张卡片的另一张确定）。 */
  partner?: string | string[];
  /** 导出者元数据（启发式，只用于 suggestion，绝不自动确认）。 */
  exportedBy?: string;
}

/** 说话人映射（用户在 P-3 显式确认后产生；禁止解析层自动确认）。 */
export interface SpeakerMap {
  version: 1;
  platform: Platform;
  /** 归一化前的导出昵称（保持首次出现的写法）。map 内一个角色可含多个昵称 = 改昵称归并。 */
  user: { names: string[] };
  partner: { names: string[] };
  confirmedBy: "explicit" | "explicit+exportedBy";
}

export type SpeakerMapIssueCode =
  | "no-explicit-mapping"
  | "unknown-speaker-name"
  | "group-chat-unsupported"
  | "empty-chat"
  | "same-speaker-selected"
  | "ambiguous-names";

/** P-3 说话人卡片所需的元数据（不含消息原文，只给锚点 id）。 */
export interface SpeakerMapCandidate {
  id: string;
  displayName: string;
  messageCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  anchorMessageId: string | null;
}

export type SpeakerMapResult =
  | { status: "confirmed"; map: SpeakerMap }
  | {
      status: "needsConfirmation";
      code: SpeakerMapIssueCode;
      /** 可行动的英文提示（UI 直接渲染，对应 E-4 等错误态）。 */
      message: string;
      /** 一句人话解释 / 修复动作（可选，渲染在 message 下方）。 */
      hint?: string;
      candidates: SpeakerMapCandidate[];
      /** 导出者启发式：仅作默认建议，绝不自动确认（FR-2「元数据优先，启发式仅建议」）。 */
      suggestion?: { user?: string; partner?: string };
    };

/** 映射后的说话人身份（聚合后的 user / partner）。 */
export interface SpeakerIdentity {
  role: SpeakerRole;
  /** "user" | "partner" */
  id: string;
  /** 该角色名下所有导出昵称（改昵称归并后可能 >1）。 */
  names: string[];
  messageCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  anchorMessageId: string | null;
}

/** 已映射消息：角色确定后规则层唯一允许消费的消息类型。 */
export type ConversationMessage = NormalizedMessage & { role: SpeakerRole };

/** 会话元数据（不含聊天原文）。 */
export interface ConversationMeta {
  platform: Platform;
  messageCount: number;
  systemCount: number;
  timestampedCount: number;
  timestampCoverage: number;
  startedAt: number | null;
  endedAt: number | null;
  /** 起止跨度（天，保留 2 位小数）。 */
  durationDays: number;
  dateOrder: DateOrder | "unknown";
  needsDateConfirmation: boolean;
  timestampBasis: "wall-clock-utc";
  speakerMapConfirmed: true;
}

/** 规则层唯一输入：speaker 已显式确认的一对一会话。 */
export interface Conversation {
  platform: Platform;
  user: SpeakerIdentity;
  partner: SpeakerIdentity;
  /** 非系统消息，按源文件顺序（= 时间顺序）。 */
  messages: ConversationMessage[];
  systemMessages: NormalizedMessage[];
  meta: ConversationMeta;
  issues: ParseIssue[];
}
