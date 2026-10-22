import { beforeEach, describe, expect, it } from "vitest";

import {
  FEATURES_STORAGE_KEY,
  LAST_INPUT_STORAGE_KEY,
  SESSION_TTL_MS,
  loadLastInput,
  loadSession,
  purgeExpiredSessions,
  saveLastInput,
  saveSession,
} from "@/lib/client-session";
import type { Conversation } from "@/parser";
import type { ReportFeatures } from "@/rules";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const features = {
  schemaVersion: "features_v1",
  preview: { cards: [] },
  health: { dimensions: [] },
  attachment: { user: {}, partner: {} },
  metrics: {},
  sample: {},
} as unknown as ReportFeatures;
const conversation = {
  messages: [],
  meta: {},
  user: { names: [] },
  partner: { names: [] },
} as unknown as Conversation;

const T0 = new Date("2026-10-22T10:00:00.000Z");

beforeEach(() => {
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = new MemoryStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
});

function storedSession(): Record<string, unknown> {
  const raw = globalThis.sessionStorage.getItem(FEATURES_STORAGE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw as string) as Record<string, unknown>;
}

describe("session TTL (2h)", () => {
  it("keeps sessions inside the window and loads them", () => {
    saveSession({ features, conversation, fileName: "chat.txt" }, { now: T0 });
    const loaded = loadSession({ now: T0.getTime() + 60 * 60 * 1000 });
    expect(loaded?.fileName).toBe("chat.txt");
    expect(storedSession().expiresAt).toBeTypeOf("string");
  });

  it("expires exactly at createdAt + 2h and clears the record", () => {
    saveSession({ features, conversation, fileName: "chat.txt" }, { now: T0 });
    const justBefore = loadSession({ now: T0.getTime() + SESSION_TTL_MS - 1 });
    expect(justBefore).not.toBeNull();
    const after = loadSession({ now: T0.getTime() + SESSION_TTL_MS + 1 });
    expect(after).toBeNull();
    expect(globalThis.sessionStorage.getItem(FEATURES_STORAGE_KEY)).toBeNull();
  });

  it("treats legacy records without expiresAt as createdAt + TTL", () => {
    saveSession({ features, conversation, fileName: "legacy.txt" }, { now: T0 });
    const record = storedSession();
    delete record.expiresAt;
    globalThis.sessionStorage.setItem(FEATURES_STORAGE_KEY, JSON.stringify(record));

    expect(loadSession({ now: T0.getTime() + 60 * 60 * 1000 })?.fileName).toBe("legacy.txt");
    expect(loadSession({ now: T0.getTime() + SESSION_TTL_MS + 1 })).toBeNull();
  });

  it("purgeExpiredSessions only clears expired records", () => {
    saveSession({ features, conversation, fileName: "chat.txt" }, { now: T0 });
    expect(purgeExpiredSessions({ now: T0.getTime() + 1000 })).toBe(false);
    expect(purgeExpiredSessions({ now: T0.getTime() + SESSION_TTL_MS + 1 })).toBe(true);
    expect(globalThis.sessionStorage.getItem(FEATURES_STORAGE_KEY)).toBeNull();
  });

  it("applies the same TTL to lastInput metadata", () => {
    saveLastInput(
      { fileName: "chat.txt", dateRangeLabel: "Mar 1 - Mar 2", messageCount: 10 },
      { now: T0 },
    );
    expect(loadLastInput({ now: T0.getTime() + 1000 })?.fileName).toBe("chat.txt");
    expect(loadLastInput({ now: T0.getTime() + SESSION_TTL_MS + 1 })).toBeNull();
    expect(globalThis.sessionStorage.getItem(LAST_INPUT_STORAGE_KEY)).toBeNull();
  });
});
