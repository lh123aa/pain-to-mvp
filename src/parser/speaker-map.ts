/**
 * 说话人锁定（M1 · FR-2 / AC-2.x）
 *
 * 铁律（PRD 原文）：
 * - **映射确认前不显示任何分析结果**（FR-2）。
 * - 元数据优先；导出者启发式**只作默认建议**，绝不自动确认。
 * - **禁止按性别、左右、语气、头像位置猜**——本模块只接受显式名字，猜不出就 `needsConfirmation`。
 * - 群聊（>2 个活跃说话人）拒绝（E-4），除非显式映射把全部说话人归并进两个角色
 *   （对应 FR-1「一人多昵称归并」：改名会产生第三个 sender，但用户可显式把两个名字都选成"我"）。
 *
 * 产出 Conversation = 规则层唯一合法输入；ParsedChat 永远不能直接进指标计算。
 */
import type {
  Conversation,
  ConversationMessage,
  ConversationMeta,
  NormalizedMessage,
  ParseIssue,
  ParsedChat,
  Participant,
  SpeakerIdentity,
  SpeakerMap,
  SpeakerMapCandidate,
  SpeakerMapInput,
  SpeakerMapResult,
  SpeakerRole,
} from "./types";

/** 昵称归一化：NFKC + 去方向控制符 + 折叠空白 + 小写。 */
export function normalizeSpeakerName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toNameList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((n) => n.trim()).filter((n) => n.length > 0);
}

function toCandidate(participant: Participant): SpeakerMapCandidate {
  return {
    id: participant.id,
    displayName: participant.displayName,
    messageCount: participant.messageCount,
    firstTimestamp: participant.firstTimestamp,
    lastTimestamp: participant.lastTimestamp,
    anchorMessageId: participant.anchorMessageId,
  };
}

function candidatesOf(chat: ParsedChat): SpeakerMapCandidate[] {
  return chat.participants.map(toCandidate);
}

function resolveNames(chat: ParsedChat, names: string[]): { matched: Participant[]; unknown: string[] } {
  const matched: Participant[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const key = normalizeSpeakerName(name);
    const hit = chat.participants.find(
      (p) => normalizeSpeakerName(p.displayName) === key || p.id === name || normalizeSpeakerName(p.id) === key,
    );
    if (hit) {
      if (!matched.some((p) => p.id === hit.id)) matched.push(hit);
    } else {
      unknown.push(name);
    }
  }
  return { matched, unknown };
}

function exportSuggestion(
  chat: ParsedChat,
  exportedBy: string | undefined,
): { user?: string; partner?: string } | undefined {
  if (!exportedBy) return undefined;
  const { matched } = resolveNames(chat, [exportedBy]);
  if (matched.length !== 1) return undefined;
  const user = matched[0] as Participant;
  const partner = chat.participants.find((p) => p.id !== user.id);
  return partner ? { user: user.displayName, partner: partner.displayName } : { user: user.displayName };
}

function confirmedResult(map: SpeakerMap): SpeakerMapResult {
  return { status: "confirmed", map };
}

/**
 * 建立显式说话人映射。
 *
 * 典型调用（P-3 确认卡）：
 *   createSpeakerMap(chat, { user: "Alex" })            // 另一人自动成为 partner（UI 已展示"另一张卡"）
 *   createSpeakerMap(chat, { user: ["Alex", "A."] })    // 改昵称归并
 *   createSpeakerMap(chat, { exportedBy: "Alex" })      // ❌ 仍 needsConfirmation，只附 suggestion
 */
export function createSpeakerMap(chat: ParsedChat, input: SpeakerMapInput = {}): SpeakerMapResult {
  const candidates = candidatesOf(chat);
  if (candidates.length === 0) {
    return {
      status: "needsConfirmation",
      code: "empty-chat",
      message: "No messages found in this conversation",
      hint: "Try another export, or paste the conversation instead.",
      candidates,
    };
  }

  const userNames = toNameList(input.user);
  const partnerNames = toNameList(input.partner);
  const explicitProvided = userNames.length > 0 || partnerNames.length > 0;

  if (!explicitProvided) {
    const suggestion = exportSuggestion(chat, input.exportedBy);
    return {
      status: "needsConfirmation",
      code: candidates.length > 2 ? "group-chat-unsupported" : "no-explicit-mapping",
      message:
        candidates.length > 2
          ? "This looks like a group chat"
          : "Please confirm which person is you",
      hint:
        candidates.length > 2
          ? "Reports only analyze one-to-one conversations. Pick the chat with just the two of you."
          : "We never guess who is who — it changes every conclusion in the report.",
      candidates,
      ...(suggestion ? { suggestion } : {}),
    };
  }

  const userResolved = resolveNames(chat, userNames);
  const partnerResolved = resolveNames(chat, partnerNames);
  const unknown = [...userResolved.unknown, ...partnerResolved.unknown];
  if (unknown.length > 0) {
    return {
      status: "needsConfirmation",
      code: "unknown-speaker-name",
      message: `We couldn't find "${unknown[0]}" in this export`,
      hint: "Nicknames are shown exactly as saved on the phone. Pick one of the names below.",
      candidates,
    };
  }

  const userMatched = userResolved.matched;
  const partnerMatched = partnerResolved.matched;
  const samePerson = userMatched.find((u) => partnerMatched.some((p) => p.id === u.id));
  if (samePerson) {
    return {
      status: "needsConfirmation",
      code: "same-speaker-selected",
      message: "The same person was selected for both sides",
      hint: "Pick two different people: you and your partner.",
      candidates,
    };
  }

  // 单人一方（>2 候选）只有显式覆盖全部候选才可继续（改名归并场景）。
  if (candidates.length > 2) {
    const covered = new Set([...userMatched, ...partnerMatched].map((p) => p.id));
    if (covered.size !== candidates.length) {
      return {
        status: "needsConfirmation",
        code: "group-chat-unsupported",
        message: "This looks like a group chat",
        hint:
          "Reports only analyze one-to-one conversations. If a nickname changed mid-export, select both of that person's names.",
        candidates,
      };
    }
  }

  // 只选定一侧时，另一侧 = 未被选中的候选（UI 上"另一张卡自动标记 Your partner"，不是猜测）。
  const chosenIds = new Set([...userMatched, ...partnerMatched].map((p) => p.id));
  const remaining = candidates.filter((p) => !chosenIds.has(p.id));
  const finalUser = [...userMatched];
  const finalPartner = [...partnerMatched];
  if (finalUser.length === 0) {
    if (remaining.length === 0) {
      return {
        status: "needsConfirmation",
        code: "ambiguous-names",
        message: "We couldn't tell which person is you",
        hint: "Pick who you are first — the other side becomes your partner.",
        candidates,
      };
    }
    finalUser.push(...remaining);
    remaining.length = 0;
  }
  if (finalPartner.length === 0) {
    finalPartner.push(...remaining);
  }
  if (finalPartner.length === 0) {
    // 只有一个人（纯单方倾诉）：PRD 细化方案 §4.3「仍然可继续」，报告层显式声明样本失衡。
    return confirmedResult({
      version: 1,
      platform: chat.platform,
      user: { names: finalUser.map((p) => p.displayName) },
      partner: { names: [] },
      confirmedBy: "explicit",
    });
  }

  return confirmedResult({
    version: 1,
    platform: chat.platform,
    user: { names: finalUser.map((p) => p.displayName) },
    partner: { names: finalPartner.map((p) => p.displayName) },
    confirmedBy: "explicit",
  });
}

function buildIdentity(
  role: SpeakerRole,
  names: string[],
  messages: ConversationMessage[],
): SpeakerIdentity {
  const own = messages.filter((m) => m.role === role);
  const timed = own.filter((m) => m.timestamp !== null);
  return {
    role,
    id: role,
    names,
    messageCount: own.length,
    firstTimestamp: timed.length > 0 ? Math.min(...timed.map((m) => m.timestamp as number)) : null,
    lastTimestamp: timed.length > 0 ? Math.max(...timed.map((m) => m.timestamp as number)) : null,
    // 锚点 = 该说话人的第 2 条消息（P-3 身份核对卡），不足 2 条时取第 1 条
    anchorMessageId: own[1]?.id ?? own[0]?.id ?? null,
  };
}

/**
 * 用已确认的映射构建 Conversation（规则层唯一输入）。
 * 未映射的 sender 会被跳过并记录 W-UNMAPPED-SENDER —— 绝不"猜"到某一侧。
 */
export function conversationFromChat(chat: ParsedChat, map: SpeakerMap): Conversation {
  const issues: ParseIssue[] = [...chat.issues];

  const roleByNormalizedName = new Map<string, SpeakerRole>();
  for (const name of map.user.names) roleByNormalizedName.set(normalizeSpeakerName(name), "user");
  for (const name of map.partner.names) roleByNormalizedName.set(normalizeSpeakerName(name), "partner");

  const messages: ConversationMessage[] = [];
  const systemMessages: NormalizedMessage[] = [];
  let unmapped = 0;

  for (const message of chat.messages) {
    if (message.isSystem) {
      systemMessages.push(message);
      continue;
    }
    const role =
      roleByNormalizedName.get(normalizeSpeakerName(message.senderName)) ??
      roleByNormalizedName.get(normalizeSpeakerName(message.senderId ?? ""));
    if (!role) {
      unmapped += 1;
      continue;
    }
    messages.push({ ...message, role });
  }

  const userNames = map.user.names.filter((name) =>
    chat.participants.some((p) => normalizeSpeakerName(p.displayName) === normalizeSpeakerName(name)),
  );
  const partnerNames = map.partner.names.filter((name) =>
    chat.participants.some((p) => normalizeSpeakerName(p.displayName) === normalizeSpeakerName(name)),
  );

  const user = buildIdentity("user", userNames, messages);
  const partner = buildIdentity("partner", partnerNames, messages);

  if (unmapped > 0) {
    issues.push({
      code: "W-UNMAPPED-SENDER",
      severity: "warning",
      message: "Some messages came from a sender we couldn't match",
      hint: "Check the speaker selection if a nickname changed in this export.",
      detail: `${unmapped} message(s) skipped`,
    });
  }
  if (userNames.length > 1 || partnerNames.length > 1) {
    issues.push({
      code: "W-SPEAKER-ALIAS-MERGED",
      severity: "warning",
      message: "One person used more than one nickname in this export",
      hint: "We grouped them together because you selected them as the same person.",
    });
  }
  if (partner.messageCount === 0 || user.messageCount === 0) {
    issues.push({
      code: "W-PARTNER-SILENT",
      severity: "warning",
      message: "One side has no messages",
      hint: "The report will state the imbalance and lower its confidence.",
    });
  }

  const timed = messages.filter((m) => m.timestamp !== null);
  const startedAt = timed.length > 0 ? Math.min(...timed.map((m) => m.timestamp as number)) : null;
  const endedAt = timed.length > 0 ? Math.max(...timed.map((m) => m.timestamp as number)) : null;

  const meta: ConversationMeta = {
    platform: chat.platform,
    messageCount: messages.length,
    systemCount: systemMessages.length,
    timestampedCount: timed.length,
    timestampCoverage: messages.length === 0 ? 0 : timed.length / messages.length,
    startedAt,
    endedAt,
    durationDays:
      startedAt !== null && endedAt !== null
        ? Math.round(((endedAt - startedAt) / 86_400_000) * 100) / 100
        : 0,
    dateOrder: chat.meta.dateOrder,
    needsDateConfirmation: chat.meta.needsDateConfirmation,
    timestampBasis: chat.meta.timestampBasis,
    speakerMapConfirmed: true,
  };

  return {
    platform: chat.platform,
    user,
    partner,
    messages,
    systemMessages,
    meta,
    issues,
  };
}

/** 便捷组合：确认映射后直接产出 Conversation；未确认时原样返回 needsConfirmation。 */
export function tryBuildConversation(
  chat: ParsedChat,
  input: SpeakerMapInput,
): { status: "confirmed"; conversation: Conversation } | Extract<SpeakerMapResult, { status: "needsConfirmation" }> {
  const result = createSpeakerMap(chat, input);
  if (result.status === "needsConfirmation") return result;
  return { status: "confirmed", conversation: conversationFromChat(chat, result.map) };
}

