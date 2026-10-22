/**
 * Report contract tests (`report_v2`).
 *
 * The contract is the shared boundary between `/analyze` (writer of
 * `tell:features:v1`) and `/report` (reader). These tests pin:
 * - version / key / chapter constants so a rename cannot silently break the
 *   two pages;
 * - copy discipline on the exported strings (English, no clinical vocabulary,
 *   no Chinese);
 * - the defensive session-envelope validator: valid payloads pass, corrupted
 *   or version-mismatched payloads are rejected (the page then falls back
 *   instead of crashing).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  conversationFromChat,
  createSpeakerMap,
  parseWhatsAppTxt,
  type Conversation,
} from "@/parser";
import { buildReportFeatures, type ReportFeatures } from "@/rules";
import {
  FALLBACK_WHAT_WE_DONT_KNOW,
  MAX_EVIDENCE_ITEMS,
  MAX_EVIDENCE_QUOTE_CHARS,
  REPORT_CHAPTER_IDS,
  REPORT_DISCLAIMER,
  REPORT_SCHEMA_VERSION,
  REPORT_STORAGE_KEY,
  REPORT_STORAGE_SCHEMA_VERSION,
  containsCjk,
  isStoredReportInput,
  type StoredReportInput,
} from "@/lib/report-contract";

const FORBIDDEN_TERMS = [
  "therapist",
  "therapy",
  "counseling",
  "counselling",
  "diagnosis",
  "diagnose",
  "clinical",
  "mental health",
];

function expectUserCopyIsClean(copy: string, label: string): void {
  expect(copy.trim().length, `${label} must not be empty`).toBeGreaterThan(0);
  expect(containsCjk(copy), `${label} must not contain Chinese characters`).toBe(false);
  const lower = copy.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    expect(lower.includes(term), `${label} must not contain "${term}"`).toBe(false);
  }
}

function fixtureConversation(): Conversation {
  const text = readFileSync(
    fileURLToPath(new URL("../../fixtures/whatsapp/android-24h-dmy.txt", import.meta.url)),
    "utf8",
  );
  const parsed = parseWhatsAppTxt(text);
  expect(parsed.ok).toBe(true);
  const map = createSpeakerMap(parsed.chat, { user: "Alex", partner: "Sam" });
  if (map.status !== "confirmed") throw new Error("fixture needs speaker confirmation");
  return conversationFromChat(parsed.chat, map.map);
}

function validPayload(): {
  payload: StoredReportInput;
  features: ReportFeatures;
  conversation: Conversation;
} {
  const conversation = fixtureConversation();
  const features = buildReportFeatures(conversation);
  return {
    features,
    conversation,
    payload: {
      schemaVersion: 1,
      features,
      conversation,
      speakers: { user: "Alex", partner: "Sam" },
      fileName: "android-24h-dmy.txt",
      createdAt: "2026-03-15T10:00:00.000Z",
    },
  };
}

describe("report contract constants", () => {
  it("pins the schema version, storage key and chapter order", () => {
    expect(REPORT_SCHEMA_VERSION).toBe("report_v2");
    expect(REPORT_STORAGE_KEY).toBe("tell:features:v1");
    expect(REPORT_STORAGE_SCHEMA_VERSION).toBe(1);
    expect(MAX_EVIDENCE_QUOTE_CHARS).toBe(200);
    expect(MAX_EVIDENCE_ITEMS).toBeGreaterThan(0);
    expect([...REPORT_CHAPTER_IDS]).toEqual([
      "at-a-glance",
      "attachment",
      "health",
      "turning-points",
      "evidence-confidence",
      "next-7-days",
    ]);
  });

  it("keeps the disclaimer and fallback unknowns English and non-clinical", () => {
    expectUserCopyIsClean(REPORT_DISCLAIMER, "REPORT_DISCLAIMER");
    expect(FALLBACK_WHAT_WE_DONT_KNOW.length).toBeGreaterThan(0);
    for (const [index, copy] of FALLBACK_WHAT_WE_DONT_KNOW.entries()) {
      expectUserCopyIsClean(copy, `FALLBACK_WHAT_WE_DONT_KNOW[${index}]`);
    }
  });
});

describe("isStoredReportInput", () => {
  it("accepts the envelope written by /analyze", () => {
    const { payload } = validPayload();
    expect(isStoredReportInput(payload)).toBe(true);
    // Round-trips through sessionStorage's JSON representation.
    expect(isStoredReportInput(JSON.parse(JSON.stringify(payload)) as unknown)).toBe(true);
  });

  it("rejects a mismatched envelope schemaVersion", () => {
    const { payload } = validPayload();
    expect(isStoredReportInput({ ...payload, schemaVersion: 2 })).toBe(false);
    expect(isStoredReportInput({ ...payload, schemaVersion: "1" })).toBe(false);
  });

  it("rejects a mismatched feature schemaVersion", () => {
    const { payload } = validPayload();
    expect(
      isStoredReportInput({
        ...payload,
        features: { ...payload.features, schemaVersion: "features_v0" },
      }),
    ).toBe(false);
  });

  it("rejects a missing or malformed conversation", () => {
    const { payload } = validPayload();
    const { conversation, ...withoutConversation } = payload;
    expect(conversation.messages.length).toBeGreaterThan(0);
    expect(isStoredReportInput(withoutConversation)).toBe(false);
    expect(isStoredReportInput({ ...payload, conversation: { messages: [] } })).toBe(false);
    expect(isStoredReportInput({ ...payload, conversation: { ...conversation, messages: "nope" } })).toBe(
      false,
    );
  });

  it("rejects missing speakers, fileName or createdAt", () => {
    const { payload } = validPayload();
    expect(isStoredReportInput({ ...payload, speakers: { user: "Alex" } })).toBe(false);
    expect(isStoredReportInput({ ...payload, speakers: null })).toBe(false);
    expect(isStoredReportInput({ ...payload, fileName: 42 })).toBe(false);
    expect(isStoredReportInput({ ...payload, createdAt: null })).toBe(false);
  });

  it("rejects non-object payloads (corrupted JSON degrades to fallback)", () => {
    expect(isStoredReportInput(null)).toBe(false);
    expect(isStoredReportInput(undefined)).toBe(false);
    expect(isStoredReportInput("tell:features:v1")).toBe(false);
    expect(isStoredReportInput(42)).toBe(false);
    expect(isStoredReportInput([])).toBe(false);
    expect(isStoredReportInput({})).toBe(false);
  });
});

describe("containsCjk", () => {
  it("detects CJK and leaves English copy alone", () => {
    expect(containsCjk("在的，怎么了？")).toBe(true);
    expect(containsCjk("Lena: Ich wollte nur reden.")).toBe(false);
    expect(containsCjk("Emoji only 😅 and punctuation?")).toBe(false);
    expect(containsCjk("")).toBe(false);
  });
});
