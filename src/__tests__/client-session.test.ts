/**
 * 客户端会话存储契约测试（W2-1b）
 *
 * 覆盖：
 * - save/load round-trip（用 fixtures 走真实 parse → speaker map → buildReportFeatures，
 *   验证 ReportFeatures + Conversation 真的可序列化、可还原）；
 * - schemaVersion / features schema 不匹配 → null；
 * - 坏 JSON → null；坏 sessionStorage 数据不会挡住 localStorage 里的有效数据；
 * - clearSession 同时清掉 features 与 lastInput；
 * - sessionStorage 写失败（配额）→ 自动落到 localStorage；
 * - 两个存储区都不可用 → ok=false / load=null（绝不抛）；
 * - >3MB → 降级只存 features + 证据所需的最小 conversation；
 * - `tell:lastInput` round-trip 与坏数据；
 * - 旧 /checkout 键只写元数据，pasted 恒为空（不落原文）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conversationFromChat, createSpeakerMap, parseWhatsAppTxt } from "@/parser";
import { buildReportFeatures } from "@/rules";
import {
  FEATURES_STORAGE_KEY,
  LAST_INPUT_STORAGE_KEY,
  LEGACY_CHECKOUT_INPUT_KEY,
  MAX_SESSION_BYTES,
  clearSession,
  estimateSessionBytes,
  loadLastInput,
  loadSession,
  saveCheckoutInput,
  saveLastInput,
  saveSession,
  speakersFromConversation,
  type SessionSaveInput,
} from "@/lib/client-session";

function fixture(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${relativePath}`, import.meta.url)), "utf8");
}

/** 真实链路：fixture → parse → 显式说话人映射 → Conversation → ReportFeatures。 */
function buildSessionInput(): SessionSaveInput {
  const parsed = parseWhatsAppTxt(fixture("whatsapp/android-24h-dmy.txt"));
  const mapping = createSpeakerMap(parsed.chat, { user: "Alex" });
  if (mapping.status !== "confirmed") {
    throw new Error(`fixture 说话人映射应直接确认，实际 ${mapping.status}`);
  }
  const conversation = conversationFromChat(parsed.chat, mapping.map);
  const features = buildReportFeatures(conversation);
  return {
    features,
    conversation,
    fileName: "android-24h-dmy.txt",
    speakers: speakersFromConversation(conversation),
  };
}

interface MemoryStorageOptions {
  throwOnWrite?: boolean;
  throwOnRead?: boolean;
}

function memoryStorage(options: MemoryStorageOptions = {}): Storage {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      if (options.throwOnRead) throw new Error("storage disabled");
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      if (options.throwOnWrite) {
        const error = new Error("quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }
      data.set(key, String(value));
    },
  };
  return storage as unknown as Storage;
}

function rawSession(): Record<string, unknown> {
  const raw = globalThis.sessionStorage.getItem(FEATURES_STORAGE_KEY);
  if (raw === null) throw new Error("expected a stored session");
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tell:features:v1 · save/load round-trip", () => {
  it("真实解析结果可保存并原样读回（含 speakers 与 conversation）", () => {
    const input = buildSessionInput();
    expect(input.speakers).toEqual({ user: "Alex", partner: "Sam" });

    const saved = saveSession(input);
    expect(saved.ok).toBe(true);
    expect(saved.storage).toBe("session");
    expect(saved.degraded).toBe(false);
    expect(saved.bytes).toBeGreaterThan(0);
    expect(Math.abs(saved.bytes - estimateSessionBytes(input))).toBeLessThanOrEqual(32);

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.schemaVersion).toBe(1);
    expect(loaded?.fileName).toBe(input.fileName);
    expect(loaded?.speakers).toEqual(input.speakers);
    expect(loaded?.features.schemaVersion).toBe("features_v1");
    expect(loaded?.features.sample.messageCount).toBe(input.features.sample.messageCount);
    expect(loaded?.features.health.totalScore).toBe(input.features.health.totalScore);
    expect(loaded?.conversation.messages.length).toBe(input.conversation.messages.length);
    // 与 /report 读取方对齐的 envelope 形状：createdAt 是 ISO 字符串（不是 epoch 数字）
    expect(loaded?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(loaded?.createdAt as string))).toBe(false);
    expect(Array.isArray(loaded?.features.health.dimensions)).toBe(true);
    expect(typeof loaded?.conversation.meta).toBe("object");
    expect(typeof loaded?.conversation.user).toBe("object");
    expect(typeof loaded?.conversation.partner).toBe("object");
  });

  it("写入的存储区可以通过删除 sessionStorage 后由 loadSession 兜底读到（localStorage 兜底路径）", () => {
    const input = buildSessionInput();
    const saved = saveSession(input);
    expect(saved.ok).toBe(true);

    // 把同一份数据搬到 localStorage，模拟 sessionStorage 在刷新/新标签页后为空
    const raw = globalThis.sessionStorage.getItem(FEATURES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    globalThis.localStorage.setItem(FEATURES_STORAGE_KEY, raw as string);
    globalThis.sessionStorage.removeItem(FEATURES_STORAGE_KEY);

    expect(loadSession()?.fileName).toBe(input.fileName);
  });
});

describe("tell:features:v1 · 版本与坏数据", () => {
  it("schemaVersion 不匹配返回 null", () => {
    saveSession(buildSessionInput());
    const record = rawSession();
    record.schemaVersion = 2;
    globalThis.sessionStorage.setItem(FEATURES_STORAGE_KEY, JSON.stringify(record));

    expect(loadSession()).toBeNull();
  });

  it("features.schemaVersion 不匹配返回 null", () => {
    saveSession(buildSessionInput());
    const record = rawSession();
    (record.features as Record<string, unknown>).schemaVersion = "features_v0";
    globalThis.sessionStorage.setItem(FEATURES_STORAGE_KEY, JSON.stringify(record));

    expect(loadSession()).toBeNull();
  });

  it("坏 JSON 返回 null（不抛）", () => {
    globalThis.sessionStorage.setItem(FEATURES_STORAGE_KEY, "{not-json");
    expect(loadSession()).toBeNull();
  });

  it("字段缺失的 JSON 返回 null", () => {
    globalThis.sessionStorage.setItem(FEATURES_STORAGE_KEY, JSON.stringify({ schemaVersion: 1 }));
    expect(loadSession()).toBeNull();
  });

  it("sessionStorage 的坏数据不会挡住 localStorage 里的有效数据", () => {
    const input = buildSessionInput();
    saveSession(input);
    const raw = globalThis.sessionStorage.getItem(FEATURES_STORAGE_KEY) as string;
    globalThis.localStorage.setItem(FEATURES_STORAGE_KEY, raw);
    globalThis.sessionStorage.setItem(FEATURES_STORAGE_KEY, "{broken");

    expect(loadSession()?.fileName).toBe(input.fileName);
  });
});

describe("clearSession", () => {
  it("清掉 features、lastInput 与旧结账元数据", () => {
    saveSession(buildSessionInput());
    expect(saveLastInput({ fileName: "chat.txt", dateRangeLabel: "Mar 1 – Mar 21", messageCount: 10 })).toBe(
      true,
    );
    expect(saveCheckoutInput({ fileName: "chat.txt", speakerA: "Alex", speakerB: "Sam" })).toBe(true);

    clearSession();

    expect(loadSession()).toBeNull();
    expect(loadLastInput()).toBeNull();
    expect(globalThis.sessionStorage.getItem(FEATURES_STORAGE_KEY)).toBeNull();
    expect(globalThis.localStorage.getItem(LAST_INPUT_STORAGE_KEY)).toBeNull();
    expect(globalThis.localStorage.getItem(LEGACY_CHECKOUT_INPUT_KEY)).toBeNull();
  });
});

describe("容量与降级", () => {
  it("sessionStorage 写失败（配额）时落 localStorage，读写仍成立", () => {
    vi.stubGlobal("sessionStorage", memoryStorage({ throwOnWrite: true }));
    const input = buildSessionInput();

    const saved = saveSession(input);
    expect(saved.ok).toBe(true);
    expect(saved.storage).toBe("local");
    expect(saved.degraded).toBe(false);
    expect(loadSession()?.fileName).toBe(input.fileName);
  });

  it("两个存储区都不可用时不抛：save ok=false，load=null", () => {
    vi.stubGlobal("sessionStorage", memoryStorage({ throwOnWrite: true }));
    vi.stubGlobal("localStorage", memoryStorage({ throwOnWrite: true }));

    const saved = saveSession(buildSessionInput());
    expect(saved.ok).toBe(false);
    expect(saved.reason).toBe("quota");
    expect(loadSession()).toBeNull();
  });

  it(">3MB 时降级为 features + 证据所需的最小 conversation", () => {
    const input = buildSessionInput();
    const seed = input.conversation.messages[0];
    if (!seed) throw new Error("fixture 应该至少有一条消息");
    const filler = Array.from({ length: 30_000 }, (_, index) => ({
      ...seed,
      id: `filler-${index}`,
      text: "padding message used only to inflate the serialized session payload for this test ".repeat(
        2,
      ),
    }));
    const hugeInput: SessionSaveInput = {
      ...input,
      conversation: { ...input.conversation, messages: [...input.conversation.messages, ...filler] },
    };

    expect(estimateSessionBytes(hugeInput)).toBeGreaterThan(MAX_SESSION_BYTES);

    const saved = saveSession(hugeInput);
    expect(saved.ok).toBe(true);
    expect(saved.degraded).toBe(true);
    expect(saved.bytes).toBeLessThanOrEqual(MAX_SESSION_BYTES);

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    // 特征不受降级影响：统计口径仍按完整会话
    expect(loaded?.features.sample.messageCount).toBe(input.features.sample.messageCount);
    // conversation 只留证据引用到的消息，绝不会是 3 万条
    expect(loaded?.conversation.messages.length).toBeLessThan(input.conversation.messages.length);
    expect(loaded?.conversation.messages.length).toBeGreaterThan(0);
  });
});

describe("tell:lastInput", () => {
  it("round-trip（fileName / dateRangeLabel / messageCount）", () => {
    const meta = {
      fileName: "android-24h-dmy.txt",
      dateRangeLabel: "Mar 1 – Mar 21, 2026",
      messageCount: 42,
    };
    expect(saveLastInput(meta)).toBe(true);
    // W6：lastInput 现在也带 expiresAt（2h TTL），核心字段仍原样往返。
    expect(loadLastInput()).toMatchObject(meta);
    expect(loadLastInput()?.expiresAt).toBeTypeOf("string");
  });

  it("坏 JSON 或缺字段返回 null", () => {
    globalThis.sessionStorage.setItem(LAST_INPUT_STORAGE_KEY, "{broken");
    expect(loadLastInput()).toBeNull();

    globalThis.sessionStorage.setItem(LAST_INPUT_STORAGE_KEY, JSON.stringify({ fileName: "x.txt" }));
    expect(loadLastInput()).toBeNull();
  });
});

describe("旧 /checkout 兼容键", () => {
  it("只写文件名与双方昵称，pasted 恒为空（不落聊天原文）", () => {
    expect(saveCheckoutInput({ fileName: "chat.txt", speakerA: "Alex", speakerB: "Sam" })).toBe(true);

    const raw = globalThis.localStorage.getItem(LEGACY_CHECKOUT_INPUT_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      fileName: "chat.txt",
      speakerA: "Alex",
      speakerB: "Sam",
      pasted: "",
    });
  });
});
