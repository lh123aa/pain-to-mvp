/**
 * worker-core 单测（W5-6）
 *
 * 覆盖：成功解析（WhatsApp / paste）、dateOrder 重解析、E-3/E-7 结构化错误映射、
 * 空文本、内部异常 → parse-error（不抛）、结构化克隆友好、大文本 + 10 万条性能证据。
 *
 * 性能数字只记录不阻断（CI 机器差异大）；阈值留给 Lead 在报告里判断。
 */
import { describe, expect, it } from "vitest";

import { handleParseRequest } from "@/parser/worker-core";
import type { WorkerParseRequest } from "@/parser/worker-core";

const WHATSAPP_TEXT = [
  "[15/11/2025, 09:00:00] Alex: morning",
  "[15/11/2025, 09:05:00] Sam: morning!",
  "[15/11/2025, 09:06:00] Alex: coffee?",
  "[15/11/2025, 09:10:00] Sam: always",
].join("\n");

function request(overrides: Partial<WorkerParseRequest> = {}): WorkerParseRequest {
  return { id: 1, text: WHATSAPP_TEXT, source: "file", ...overrides };
}

/** 生成 N 条确定性合成消息（DD/MM/YYYY 24h；>=13 的日号会给出 DMY 证据）。 */
function buildSyntheticConversation(messageCount: number): string {
  const baseMs = Date.UTC(2026, 0, 1, 8, 0, 0);
  const lines = new Array<string>(messageCount);
  for (let index = 0; index < messageCount; index += 1) {
    const date = new Date(baseMs + index * 60_000);
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = date.getUTCFullYear();
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const sender = index % 2 === 0 ? "Alex" : "Sam";
    lines[index] = `[${dd}/${mm}/${yyyy}, ${hh}:${minutes}:00] ${sender}: synthetic message ${index} about topic ${index % 17}`;
  }
  return lines.join("\n");
}

describe("worker-core · handleParseRequest", () => {
  it("parses a WhatsApp export and reports detection, counts and issue codes", () => {
    const response = handleParseRequest(request());
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    expect(response.detection?.format).toBe("whatsapp");
    expect(response.chat.platform).toBe("whatsapp");
    expect(response.chat.meta.messageCount).toBe(4);
    expect(response.chat.meta.dateOrder).toBe("DMY");
    expect(response.chat.meta.needsDateConfirmation).toBe(false);
    expect(response.issues.some((issue) => issue.code === "W-SMALL-SAMPLE")).toBe(true);
  });

  it("parses untimed paste text", () => {
    const response = handleParseRequest(
      request({
        id: 2,
        source: "paste",
        text: ["Me: hey", "You: hey back", "Me: coffee?", "You: always"].join("\n"),
      }),
    );
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    expect(response.detection?.format).toBe("paste");
    expect(response.chat.platform).toBe("paste");
    expect(response.chat.meta.messageCount).toBe(4);
    expect(response.chat.meta.timestampCoverage).toBe(0);
    expect(response.chat.messages.every((message) => message.timestamp === null)).toBe(true);
  });

  it("re-parses with a confirmed dateOrder and drops the confirmation flag", () => {
    const ambiguous = ["03/04/25, 9:15 AM - Alex: hi", "03/04/25, 9:16 AM - Sam: hello"].join("\n");
    const first = handleParseRequest(request({ text: ambiguous }));
    expect(first.ok).toBe(true);
    expect(first.chat?.meta.needsDateConfirmation).toBe(true);

    const confirmed = handleParseRequest(request({ id: 3, text: ambiguous, dateOrder: "DMY" }));
    expect(confirmed.ok).toBe(true);
    expect(confirmed.chat?.meta.needsDateConfirmation).toBe(false);
    expect(confirmed.chat?.messages[0]?.timestamp).toBe(Date.UTC(2025, 3, 3, 9, 15, 0));
  });

  it("maps parser failures to structured E-3 / E-7 without throwing", () => {
    const missingTimestamps = handleParseRequest(
      request({ id: 4, text: "just prose without timestamps", source: "file" }),
    );
    expect(missingTimestamps.ok).toBe(false);
    if (missingTimestamps.ok) throw new Error("expected an E-3 failure");
    expect(missingTimestamps.chat).not.toBeNull();
    expect(missingTimestamps.chat?.meta.messageCount).toBe(0);
    expect(missingTimestamps.error.code).toBe("E-3");
    expect(missingTimestamps.issues.some((issue) => issue.code === "E-3")).toBe(true);

    const unreadablePaste = handleParseRequest(
      request({ id: 5, text: "plain prose without speaker labels", source: "paste" }),
    );
    expect(unreadablePaste.ok).toBe(false);
    if (unreadablePaste.ok) throw new Error("expected an E-7 failure");
    expect(unreadablePaste.chat).not.toBeNull();
    expect(unreadablePaste.chat?.meta.messageCount).toBe(0);
    expect(unreadablePaste.error.code).toBe("E-7");
  });

  it("handles empty text for both sources", () => {
    const fromFile = handleParseRequest(request({ id: 6, text: "", source: "file" }));
    expect(fromFile.ok).toBe(false);
    expect(fromFile.chat?.meta.messageCount).toBe(0);

    const fromPaste = handleParseRequest(request({ id: 7, text: "   ", source: "paste" }));
    expect(fromPaste.ok).toBe(false);
    if (fromPaste.ok) throw new Error("expected an E-7 failure");
    expect(fromPaste.chat?.meta.messageCount).toBe(0);
    expect(fromPaste.error.code).toBe("E-7");
  });

  it("converts unexpected internal errors into parse-error instead of throwing", () => {
    const response = handleParseRequest(request({ id: 8, text: null as unknown as string }));
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("expected a parse-error failure");
    expect(response.chat).toBeNull();
    expect(response.detection).toBeNull();
    expect(response.error.code).toBe("parse-error");
    expect(response.error.message.length).toBeGreaterThan(0);
  });

  it("returns a structured-clone friendly payload (JSON round-trip identical)", () => {
    const response = handleParseRequest(request({ id: 9 }));
    const roundTripped = JSON.parse(JSON.stringify(response)) as typeof response;
    expect(roundTripped).toEqual(response);
  });

  it("parses a 5k-message conversation without degradation", () => {
    const response = handleParseRequest(
      request({ id: 10, text: buildSyntheticConversation(5_000) }),
    );
    expect(response.ok).toBe(true);
    expect(response.chat?.meta.messageCount).toBe(5_000);
    expect(response.chat?.meta.dateOrder).toBe("DMY");
  });

  it("measures 100k messages (timing and memory recorded, not asserted)", () => {
    const messageCount = 100_000;
    const text = buildSyntheticConversation(messageCount);

    const memoryBefore = process.memoryUsage();
    const startedAt = performance.now();
    const response = handleParseRequest({ id: 11, text, source: "file" });
    const elapsedMs = performance.now() - startedAt;
    const memoryAfter = process.memoryUsage();

    const heapDeltaMb = (memoryAfter.heapUsed - memoryBefore.heapUsed) / (1024 * 1024);
    const rssDeltaMb = (memoryAfter.rss - memoryBefore.rss) / (1024 * 1024);
    console.info(
      `[perf] 100k messages: parse ${elapsedMs.toFixed(1)} ms · ` +
        `input ${(text.length / (1024 * 1024)).toFixed(1)} MiB · ` +
        `heapΔ ${heapDeltaMb.toFixed(1)} MiB · rssΔ ${rssDeltaMb.toFixed(1)} MiB`,
    );

    expect(response.ok).toBe(true);
    expect(response.chat?.meta.messageCount).toBe(messageCount);
    expect(response.chat?.meta.tier).toBe("deep");
    expect(elapsedMs).toBeGreaterThan(0);
  }, 120_000);
});
