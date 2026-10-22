/**
 * WhatsApp / paste 解析层测试（M1 · FR-1 / FR-2 / AC-1.2 / AC-1.3 / AC-2.x）
 *
 * 覆盖：
 * - 7 种导出方言 + 多语言月份名（en/es/de）
 * - 多行、系统消息、媒体、已删除、通话、空消息、URL、emoji、CRLF、BOM、窄空格
 * - 日期歧义（needsDateConfirmation）与显式 dateOrder 重解析
 * - 3 份手写合成 fixture + 1 份 paste fixture（fixtures/ 纪律见 fixtures/README.md）
 * - 说话人显式映射：未确认一律 needsConfirmation；禁止猜测；群聊拒绝；改昵称归并
 *
 * 时间基准：wall-clock epoch ms（Date.UTC(本地钟面时间)），与运行机器时区无关。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  conversationFromChat,
  createSpeakerMap,
  detectInputFormat,
  matchHeaderLine,
  normalizeLine,
  parsePastedText,
  parseWhatsAppTxt,
  tryBuildConversation,
  type ParsedChat,
} from "@/parser";

function fixture(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${relativePath}`, import.meta.url)), "utf8");
}

function analysisMessages(chat: ParsedChat) {
  return chat.messages.filter((m) => !m.isSystem);
}

function issueCodes(chat: { issues: Array<{ code: string }> }): string[] {
  return chat.issues.map((i) => i.code);
}

describe("WhatsApp txt adapter · dialects", () => {
  it("parses bracketed 24h DD/MM/YYYY with seconds", () => {
    const result = parseWhatsAppTxt(
      [
        "[15/11/2023, 14:32:10] Alex: hello there",
        "[15/11/2023, 14:33:00] Sam: hi back",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.chat.meta.messageCount).toBe(2);
    expect(result.chat.meta.systemCount).toBe(0);
    expect(result.chat.meta.dateOrder).toBe("DMY");
    expect(result.chat.meta.dateOrderSource).toBe("evidence");
    expect(result.chat.meta.needsDateConfirmation).toBe(false);
    expect(result.chat.meta.timestampPrecision).toBe("second");

    const [first, second] = analysisMessages(result.chat);
    expect(first?.timestamp).toBe(Date.UTC(2023, 10, 15, 14, 32, 10));
    expect(first?.senderName).toBe("Alex");
    expect(second?.senderName).toBe("Sam");
    expect(first?.senderId).not.toBe(second?.senderId);
  });

  it("parses unbracketed Android `DD/MM/YYYY, HH:MM - Name:` with an en dash", () => {
    const result = parseWhatsAppTxt("05/11/2023, 14:32 - Alex: first\n05/11/2023, 14:40 – Sam: second");
    expect(result.ok).toBe(true);
    expect(analysisMessages(result.chat).map((m) => m.senderName)).toEqual(["Alex", "Sam"]);
    expect(analysisMessages(result.chat)[1]?.timestamp).toBe(Date.UTC(2023, 10, 5, 14, 40, 0));
  });

  it("parses iOS 12h M/D/YY with AM/PM and dash separator (MDY evidence from 4/13)", () => {
    const result = parseWhatsAppTxt(
      ["3/4/26, 9:15 AM - Riley: morning", "4/13/26, 8:40 PM - Jordan: evening"].join("\n"),
    );

    expect(result.chat.meta.dateOrder).toBe("MDY");
    expect(result.chat.meta.dateOrderConfidence).toBe(1);
    const [first, second] = analysisMessages(result.chat);
    expect(first?.timestamp).toBe(Date.UTC(2026, 2, 4, 9, 15, 0));
    expect(second?.timestamp).toBe(Date.UTC(2026, 3, 13, 20, 40, 0));
  });

  it("normalizes U+202F narrow no-break space before AM/PM (iOS export detail)", () => {
    const line = "3/4/26, 9:15\u202fAM - Riley: hello";
    expect(matchHeaderLine(line)).not.toBeNull();
    const result = parseWhatsAppTxt(`3/4/26, 3:05\u202fPM - Riley: later`);
    expect(analysisMessages(result.chat)[0]?.timestamp).toBe(Date.UTC(2026, 2, 4, 15, 5, 0));
  });

  it("parses European dot separator and defaults to DMY + needs confirmation", () => {
    const result = parseWhatsAppTxt("05.11.2023, 14:32 - Alex: hallo\n06.11.2023, 09:01 - Sam: hi");
    expect(result.chat.meta.dateOrder).toBe("DMY");
    expect(result.chat.meta.dateOrderSource).toBe("heuristic");
    expect(result.chat.meta.needsDateConfirmation).toBe(true);
    expect(analysisMessages(result.chat)[0]?.timestamp).toBe(Date.UTC(2023, 10, 5, 14, 32, 0));
  });

  it("parses ISO-ish YYYY-MM-DD", () => {
    const result = parseWhatsAppTxt("2023-11-05, 14:32 - Alex: hello");
    expect(result.ok).toBe(true);
    expect(result.chat.meta.dateOrder).toBe("YMD");
    expect(analysisMessages(result.chat)[0]?.timestamp).toBe(Date.UTC(2023, 10, 5, 14, 32, 0));
  });

  it("parses Spanish month names (`12 de enero de 2026`)", () => {
    const result = parseWhatsAppTxt("12 de enero de 2026, 10:30 - Ana: hola");
    expect(result.chat.meta.dateOrder).toBe("DMY");
    expect(result.chat.meta.dateOrderConfidence).toBe(1);
    expect(analysisMessages(result.chat)[0]?.timestamp).toBe(Date.UTC(2026, 0, 12, 10, 30, 0));
  });

  it("parses German month names with umlaut (`3. März 2026`)", () => {
    const result = parseWhatsAppTxt("3. März 2026, 18:05 - Ben: hallo");
    expect(result.chat.meta.dateOrder).toBe("DMY");
    expect(analysisMessages(result.chat)[0]?.timestamp).toBe(Date.UTC(2026, 2, 3, 18, 5, 0));
  });

  it("parses English month-first (`Mar 4, 2026, 9:15 AM`) and abbreviated months", () => {
    const first = parseWhatsAppTxt("Mar 4, 2026, 9:15 AM - Riley: hi");
    expect(first.chat.meta.dateOrder).toBe("MDY");
    expect(analysisMessages(first.chat)[0]?.timestamp).toBe(Date.UTC(2026, 2, 4, 9, 15, 0));

    const second = parseWhatsAppTxt("4. Apr. 2026, 09:15 - Riley: hi");
    expect(second.chat.meta.dateOrder).toBe("DMY");
    expect(analysisMessages(second.chat)[0]?.timestamp).toBe(Date.UTC(2026, 3, 4, 9, 15, 0));
  });

  it("handles CRLF line endings", () => {
    const result = parseWhatsAppTxt("[05/11/2023, 14:32:10] Alex: one\r\n[05/11/2023, 14:33:10] Sam: two\r\n");
    expect(result.chat.meta.messageCount).toBe(2);
    expect(analysisMessages(result.chat)[1]?.text).toBe("two");
  });

  it("strips a UTF-8 BOM and leading LRM from the first header line", () => {
    const result = parseWhatsAppTxt("\uFEFF[05/11/2023, 14:32:10] Alex: hi");
    expect(result.ok).toBe(true);
    expect(analysisMessages(result.chat)[0]?.text).toBe("hi");
    expect(normalizeLine("\u200e[05/11/2023, 14:32:10] Alex: hi")).toContain("[05/11/2023");
  });
});

describe("WhatsApp txt adapter · message shapes", () => {
  it("joins multi-line bodies into one message", () => {
    const text = [
      "[05/11/2023, 14:32:10] Alex: line one",
      "line two with emoji 😅",
      "line three",
      "[05/11/2023, 14:40:00] Sam: next",
    ].join("\n");
    const result = parseWhatsAppTxt(text);
    expect(result.chat.meta.messageCount).toBe(2);
    const first = analysisMessages(result.chat)[0];
    expect(first?.text.split("\n")).toEqual(["line one", "line two with emoji 😅", "line three"]);
  });

  it("detects system messages (encryption notice / subject change / group icon)", () => {
    const text = [
      "[05/11/2023, 14:32:10] Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.",
      "[05/11/2023, 14:33:10] Alex changed the subject to \"Trip\"",
      "[05/11/2023, 14:34:10] Sam: hello",
    ].join("\n");
    const result = parseWhatsAppTxt(text);
    expect(result.chat.meta.systemCount).toBe(2);
    expect(result.chat.meta.messageCount).toBe(1);
    expect(result.chat.messages[0]?.isSystem).toBe(true);
    expect(result.chat.messages[0]?.senderId).toBeNull();
  });

  it("classifies media / deleted / call markers without crashing", () => {
    const text = [
      "[05/11/2023, 14:32:10] Alex: <Media omitted>",
      "[05/11/2023, 14:33:10] Sam: <attached: 00001-PHOTO.jpg>",
      "[05/11/2023, 14:34:10] Alex: image omitted",
      "[05/11/2023, 14:35:10] Sam: This message was deleted",
      "[05/11/2023, 14:36:10] Alex: Missed voice call",
    ].join("\n");
    const result = parseWhatsAppTxt(text);
    const messages = analysisMessages(result.chat);
    expect(messages.map((m) => m.kind)).toEqual(["media", "media", "media", "deleted", "call"]);
    expect(messages[0]?.hasMedia).toBe(true);
    expect(messages[1]?.text).toBe("<attached: 00001-PHOTO.jpg>");
  });

  it("keeps empty message bodies and URLs/emoji intact", () => {
    const text = [
      "[05/11/2023, 14:32:10] Alex:",
      "[05/11/2023, 14:33:10] Sam: check https://example.com/a?b=1 😍",
      "[05/11/2023, 14:34:10] 🌙 Alex: 中文 mixed with English",
    ].join("\n");
    const result = parseWhatsAppTxt(text);
    const messages = analysisMessages(result.chat);
    expect(messages[0]?.text).toBe("");
    expect(messages[1]?.text).toBe("check https://example.com/a?b=1 😍");
    expect(messages[2]?.senderName).toBe("🌙 Alex");
    expect(messages[2]?.text).toBe("中文 mixed with English");
  });

  it("treats lines before the first timestamp as preamble (not messages)", () => {
    const result = parseWhatsAppTxt("# exported by me\nnote: hello\n[05/11/2023, 14:32:10] Alex: hi");
    expect(result.chat.meta.messageCount).toBe(1);
    expect(result.chat.meta.preamble.length).toBe(2);
    expect(issueCodes(result.chat)).toContain("W-PREAMBLE");
  });

  it("returns E-3 for empty input and for text without timestamps", () => {
    const empty = parseWhatsAppTxt("");
    expect(empty.ok).toBe(false);
    expect(empty.chat.meta.messageCount).toBe(0);
    expect(issueCodes(empty.chat)).toContain("E-3");

    const plain = parseWhatsAppTxt("just some words\nwith no timestamps at all");
    expect(plain.ok).toBe(false);
    expect(issueCodes(plain.chat)).toContain("E-3");
  });

  it("parses a single message", () => {
    const result = parseWhatsAppTxt("[05/11/2023, 14:32:10] Alex: only one");
    expect(result.ok).toBe(true);
    expect(result.chat.meta.messageCount).toBe(1);
    expect(result.chat.participants.length).toBe(1);
    expect(result.chat.participants[0]?.anchorMessageId).toBe("m1");
    expect(issueCodes(result.chat)).toContain("W-SMALL-SAMPLE");
  });
});

describe("WhatsApp txt adapter · date ambiguity", () => {
  it("flags ambiguous numeric dates and lets the caller confirm the order", () => {
    const ambiguous = parseWhatsAppTxt("03/04/25, 9:15 - Alex: hi");
    expect(ambiguous.chat.meta.needsDateConfirmation).toBe(true);
    expect(ambiguous.chat.meta.dateOrderSource).toBe("heuristic");
    expect(ambiguous.chat.meta.dateOrderConfidence).toBeLessThan(1);
    expect(issueCodes(ambiguous.chat)).toContain("W-DATE-AMBIGUOUS");
    // 默认 DMY：4 月 3 日
    expect(analysisMessages(ambiguous.chat)[0]?.timestamp).toBe(Date.UTC(2025, 3, 3, 9, 15, 0));

    const forced = parseWhatsAppTxt("03/04/25, 9:15 - Alex: hi", { dateOrder: "MDY" });
    expect(forced.chat.meta.needsDateConfirmation).toBe(false);
    expect(forced.chat.meta.dateOrderSource).toBe("explicit");
    expect(forced.chat.meta.dateOrderConfidence).toBe(1);
    // MDY：3 月 4 日
    expect(analysisMessages(forced.chat)[0]?.timestamp).toBe(Date.UTC(2025, 2, 4, 9, 15, 0));
  });

  it("does not silently pick a side when evidence conflicts", () => {
    const result = parseWhatsAppTxt("13/04/2025, 9:15 - Alex: one\n04/13/2025, 10:15 - Sam: two");
    expect(result.chat.meta.needsDateConfirmation).toBe(true);
    expect(result.chat.meta.dateOrderConfidence).toBe(0.3);
    expect(issueCodes(result.chat)).toContain("W-DATE-AMBIGUOUS");
  });

  it("skips invalid dates with W-INVALID-DATE and keeps text with the previous message", () => {
    const result = parseWhatsAppTxt("13/04/2025, 9:15 - Alex: valid\n32/13/2025, 10:15 - Sam: invalid tail");
    expect(result.chat.meta.messageCount).toBe(1);
    expect(issueCodes(result.chat)).toContain("W-INVALID-DATE");
    expect(analysisMessages(result.chat)[0]?.text).toBe("valid\ninvalid tail");
  });
});

describe("fixtures · synthetic WhatsApp exports", () => {
  it("android 24h DMY fixture: counts, participants, dimensions, edge messages", () => {
    const result = parseWhatsAppTxt(fixture("whatsapp/android-24h-dmy.txt"));
    const { chat } = result;
    expect(result.ok).toBe(true);
    expect(chat.platform).toBe("whatsapp");
    expect(chat.meta.messageCount).toBe(42);
    expect(chat.meta.systemCount).toBe(3);
    expect(chat.participants.map((p) => p.displayName)).toEqual(["Alex", "Sam"]);
    expect(chat.participants.map((p) => p.messageCount)).toEqual([21, 21]);
    expect(chat.meta.dateOrder).toBe("DMY");
    expect(chat.meta.dateOrderSource).toBe("evidence");
    expect(chat.meta.needsDateConfirmation).toBe(false);
    expect(chat.meta.timestampCoverage).toBe(1);
    expect(chat.meta.preamble.length).toBeGreaterThan(0);
    expect(analysisMessages(chat)[0]?.timestamp).toBe(Date.UTC(2026, 2, 1, 9, 12, 3));

    const multiline = analysisMessages(chat).find((m) => m.text.startsWith("Okay so hear me out"));
    expect(multiline?.text.split("\n").length).toBe(3);

    expect(analysisMessages(chat).find((m) => m.text === "<Media omitted>")?.kind).toBe("media");
    expect(analysisMessages(chat).find((m) => m.text === "This message was deleted")?.kind).toBe("deleted");
    expect(analysisMessages(chat).some((m) => m.text.includes("https://example.com/trail-map"))).toBe(true);

    const systemTexts = chat.messages.filter((m) => m.isSystem).map((m) => m.text);
    expect(systemTexts.some((t) => t.includes("end-to-end encrypted"))).toBe(true);
    expect(systemTexts.some((t) => t.includes("changed the subject"))).toBe(true);
    expect(systemTexts.some((t) => t.includes("changed this group's icon"))).toBe(true);
  });

  it("iOS 12h MDY fixture: AM/PM, media markers, multi-line tail", () => {
    const result = parseWhatsAppTxt(fixture("whatsapp/ios-12h-mdy.txt"));
    const { chat } = result;
    expect(result.ok).toBe(true);
    expect(chat.meta.messageCount).toBe(14);
    expect(chat.meta.systemCount).toBe(1);
    expect(chat.meta.dateOrder).toBe("MDY");
    expect(chat.meta.dateOrderConfidence).toBe(1);
    expect(chat.meta.needsDateConfirmation).toBe(false);
    expect(analysisMessages(chat)[0]?.timestamp).toBe(Date.UTC(2026, 2, 4, 9, 15, 0));
    expect(analysisMessages(chat)[0]?.senderName).toBe("Riley");

    const media = analysisMessages(chat).filter((m) => m.kind === "media");
    expect(media.length).toBe(2);

    const tail = analysisMessages(chat).find((m) => m.text.startsWith("Name a day"));
    expect(tail?.text.split("\n").length).toBe(3);
    expect(tail?.timestamp).toBe(Date.UTC(2026, 3, 13, 21, 2, 0));
  });

  it("European dot/CRLF fixture: ambiguous dates need confirmation, multi-language text survives", () => {
    const result = parseWhatsAppTxt(fixture("whatsapp/european-dots-crlf.txt"));
    const { chat } = result;
    expect(result.ok).toBe(true);
    expect(chat.meta.messageCount).toBe(10);
    expect(chat.meta.systemCount).toBe(2);
    expect(chat.meta.dateOrder).toBe("DMY");
    expect(chat.meta.dateOrderSource).toBe("heuristic");
    expect(chat.meta.needsDateConfirmation).toBe(true);
    expect(chat.meta.timestampPrecision).toBe("minute");
    expect(chat.participants.map((p) => p.displayName)).toEqual(["Lena", "Ming"]);
    expect(analysisMessages(chat)[0]?.timestamp).toBe(Date.UTC(2026, 3, 5, 21, 12, 0));

    const chinese = analysisMessages(chat).find((m) => m.text === "在的，怎么了？");
    expect(chinese?.senderName).toBe("Ming");

    const multiline = analysisMessages(chat).find((m) => m.text.startsWith("Nice. I'll listen tomorrow."));
    expect(multiline?.text.split("\n")).toEqual(["Nice. I'll listen tomorrow.", "Gute Nacht, Lena.", "Bis morgen."]);
  });

  it("paste fixture: no timestamps, conservative labels, multi-line continuation", () => {
    const result = parsePastedText(fixture("paste/two-speaker.txt"));
    const { chat } = result;
    expect(result.ok).toBe(true);
    expect(chat.platform).toBe("paste");
    expect(chat.meta.messageCount).toBe(9);
    expect(chat.meta.timestampCoverage).toBe(0);
    expect(chat.meta.timestampPrecision).toBe("none");
    expect(chat.participants.map((p) => p.displayName)).toEqual(["Me", "You"]);
    expect(chat.messages.every((m) => m.timestamp === null)).toBe(true);
    expect(issueCodes(chat)).toContain("W-UNTIMED");

    const continued = chat.messages.find((m) => m.text.startsWith("好啊"));
    expect(continued?.text.split("\n")).toEqual(["好啊", "其实我想说 谢谢你最近一直陪我"]);
  });
});

describe("input format detection", () => {
  it("detects whatsapp exports vs paste vs unknown", () => {
    const wa = detectInputFormat(fixture("whatsapp/android-24h-dmy.txt"));
    expect(wa.format).toBe("whatsapp");
    expect(wa.confidence).toBeGreaterThan(0.6);

    const paste = detectInputFormat(fixture("paste/two-speaker.txt"));
    expect(paste.format).toBe("paste");

    expect(detectInputFormat("").format).toBe("unknown");
    expect(detectInputFormat("just prose\nnothing here").format).toBe("unknown");
  });

  it("delegates pasted WhatsApp fragments to the whatsapp adapter", () => {
    const pasteOfExport = [
      "[05/11/2023, 14:32:10] Alex: hello",
      "[05/11/2023, 14:33:00] Sam: hi",
      "[05/11/2023, 14:34:00] Alex: how are you",
      "[05/11/2023, 14:35:00] Sam: good",
    ].join("\n");
    const result = parsePastedText(pasteOfExport);
    expect(result.chat.platform).toBe("whatsapp");
    expect(result.chat.meta.messageCount).toBe(4);
  });
});

describe("speaker map · explicit confirmation only (FR-2)", () => {
  const chat = (): ParsedChat =>
    parseWhatsAppTxt(fixture("whatsapp/android-24h-dmy.txt")).chat;

  it("never auto-confirms: needsConfirmation + candidates + exportedBy suggestion only", () => {
    const result = createSpeakerMap(chat(), {});
    expect(result.status).toBe("needsConfirmation");
    if (result.status !== "needsConfirmation") return;
    expect(result.code).toBe("no-explicit-mapping");
    expect(result.candidates.map((c) => c.displayName)).toEqual(["Alex", "Sam"]);
    expect(result.suggestion).toBeUndefined();

    const withExportOwner = createSpeakerMap(chat(), { exportedBy: "Alex" });
    expect(withExportOwner.status).toBe("needsConfirmation");
    if (withExportOwner.status !== "needsConfirmation") return;
    expect(withExportOwner.suggestion).toEqual({ user: "Alex", partner: "Sam" });
  });

  it("confirms with an explicit user and infers the other side from the two cards", () => {
    const result = createSpeakerMap(chat(), { user: "Sam" });
    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.map.user.names).toEqual(["Sam"]);
    expect(result.map.partner.names).toEqual(["Alex"]);

    const conversation = conversationFromChat(chat(), result.map);
    expect(conversation.user.messageCount).toBe(21);
    expect(conversation.partner.messageCount).toBe(21);
    expect(conversation.meta.systemCount).toBe(3);
    expect(conversation.systemMessages.length).toBe(3);
    expect(conversation.messages.every((m) => m.role === "user" || m.role === "partner")).toBe(true);
    expect(conversation.meta.speakerMapConfirmed).toBe(true);
    // 源文件第一条来自 Alex（= 映射里的 partner），角色按显式映射而非按左右猜。
    expect(conversation.messages[0]?.role).toBe("partner");
    expect(conversation.messages.filter((m) => m.role === "user").length).toBe(21);
  });

  it("rejects unknown names and same-person selections without guessing", () => {
    const unknown = createSpeakerMap(chat(), { user: "Nobody" });
    expect(unknown.status).toBe("needsConfirmation");
    if (unknown.status === "needsConfirmation") expect(unknown.code).toBe("unknown-speaker-name");

    const same = createSpeakerMap(chat(), { user: "Alex", partner: "Alex" });
    expect(same.status).toBe("needsConfirmation");
    if (same.status === "needsConfirmation") expect(same.code).toBe("same-speaker-selected");
  });

  it("rejects a group chat (3+ active senders) unless explicit mapping covers every sender", () => {
    const groupText = [
      "[13/04/2025, 10:00:00] Alice: hi",
      "[13/04/2025, 10:01:00] Bob: hey",
      "[13/04/2025, 10:02:00] Carol: hello",
    ].join("\n");
    const group = parseWhatsAppTxt(groupText).chat;
    expect(group.meta.participantCount).toBe(3);
    expect(issueCodes(group)).toContain("W-RENAME-SUSPECTED");

    const noExplicit = createSpeakerMap(group, {});
    expect(noExplicit.status).toBe("needsConfirmation");
    if (noExplicit.status === "needsConfirmation") expect(noExplicit.code).toBe("group-chat-unsupported");

    const partial = createSpeakerMap(group, { user: "Alice", partner: "Bob" });
    expect(partial.status).toBe("needsConfirmation");
    if (partial.status === "needsConfirmation") expect(partial.code).toBe("group-chat-unsupported");

    // 改昵称归并：同一人的两个名字都显式选进 user，第三个名字是 partner
    const renamedText = [
      "[13/04/2025, 10:00:00] Alice: hi",
      "[13/04/2025, 10:01:00] Bob: hey",
      "[14/04/2025, 10:00:00] Al: morning",
      "[14/04/2025, 10:01:00] Bob: hey again",
    ].join("\n");
    const renamed = parseWhatsAppTxt(renamedText).chat;
    const merged = createSpeakerMap(renamed, { user: ["Alice", "Al"], partner: "Bob" });
    expect(merged.status).toBe("confirmed");
    if (merged.status !== "confirmed") return;
    expect(merged.map.user.names).toEqual(["Alice", "Al"]);
    const conversation = conversationFromChat(renamed, merged.map);
    expect(conversation.user.names).toEqual(["Alice", "Al"]);
    expect(issueCodes(conversation)).toContain("W-SPEAKER-ALIAS-MERGED");
  });

  it("supports a one-sided conversation (partner silent) with an explicit warning", () => {
    const oneSided = parseWhatsAppTxt(
      ["[13/04/2025, 10:00:00] Alice: hi", "[13/04/2025, 10:01:00] Alice: hello?"].join("\n"),
    ).chat;
    const mapped = createSpeakerMap(oneSided, { user: "Alice" });
    expect(mapped.status).toBe("confirmed");
    if (mapped.status !== "confirmed") return;
    expect(mapped.map.partner.names).toEqual([]);
    const conversation = conversationFromChat(oneSided, mapped.map);
    expect(conversation.partner.messageCount).toBe(0);
    expect(issueCodes(conversation)).toContain("W-PARTNER-SILENT");
  });

  it("returns empty-chat for empty parses and works with tryBuildConversation", () => {
    const empty = parseWhatsAppTxt("no timestamps here").chat;
    const emptyMap = createSpeakerMap(empty, { user: "Alex" });
    expect(emptyMap.status).toBe("needsConfirmation");
    if (emptyMap.status === "needsConfirmation") expect(emptyMap.code).toBe("empty-chat");

    const built = tryBuildConversation(chat(), { user: "Alex", partner: "Sam" });
    expect(built.status).toBe("confirmed");
    if (built.status === "confirmed") {
      expect(built.conversation.meta.messageCount).toBe(42);
      expect(built.conversation.user.messageCount).toBe(21);
    }
  });
});
