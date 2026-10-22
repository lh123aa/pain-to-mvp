/**
 * report-sync tests (W3-2 plan A).
 *
 * The sync flow talks to a backend that lives in another task, so every test
 * injects a fake fetch and asserts the exact wire contract:
 * - mock / no-token / no-local-features never sync;
 * - order-status must be `ready` and carry an `uploadToken` before upload;
 * - the upload body is built from an explicit report whitelist (no
 *   conversation, no features, no raw chat);
 * - GET /api/report maps 200 / 404 / 410 / errors to render decisions;
 * - UI copy: only `saved` is visible and carries the exact product string.
 */
import { describe, expect, it } from "vitest";

import { REPORT_CHAPTER_IDS, type ReportDataV2 } from "@/lib/report-contract";
import {
  CHECKOUT_REF_STORAGE_KEY,
  CONTRACT_CHECKOUT_REF_STORAGE_KEY,
  ORDER_STATUS_ENDPOINT,
  REPORT_ENDPOINT,
  REPORT_UPLOAD_TOP_LEVEL_KEYS,
  buildReportUploadPayload,
  interpretSyncResult,
  isServerReportPayload,
  loadServerReport,
  shouldSyncReport,
  syncReportToServer,
  type ReportSyncResult,
  type SyncFetch,
  type SyncResponseLike,
} from "@/lib/report-sync";

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

function sampleReport(): ReportDataV2 {
  const base = {
    meta: {
      schemaVersion: "report_v2",
      weightsVersion: "weights_v1",
      metricsVersion: "metrics_v1",
      attachmentRuleVersion: "attachment_v1",
      generatedAt: "2026-03-15T10:00:00.000Z",
      sample: {
        messages: 42,
        dateRange: "Mar 1 – Mar 21, 2026",
        durationDays: 20.08,
        timestampedMessages: 42,
      },
    },
    headline: {
      score: 76,
      grade: "B",
      scoreLabel: "Fair",
      oneLineSummary: "A fair read with room to rebalance who starts conversations.",
      confidence: 0.29,
      confidenceLabel: "low",
    },
    chapters: REPORT_CHAPTER_IDS.map((id, index) => ({
      id,
      number: index + 1,
      title: id,
      summary: `Summary for ${id}`,
    })),
    evidence: [
      { messageId: "m1", quote: "Morning! Did you sleep okay?", timestamp: 1, chapterId: "attachment" },
    ],
    disclaimer: "Observable message patterns only.",
    whatWeDontKnow: ["We cannot know what either of you was feeling."],
    dataQuality: {
      confidence: 0.29,
      confidenceLabel: "low",
      lowSample: true,
      timestampCoverage: 1,
      needsDateConfirmation: false,
      warnings: [],
    },
  };
  return base as unknown as ReportDataV2;
}

/** The report plus fields that must never leave the browser. */
function reportWithLocalExtras(): ReportDataV2 {
  return {
    ...sampleReport(),
    conversation: { messages: [{ id: "m1", text: "raw chat text" }] },
    features: { schemaVersion: "features_v1" },
    speakers: { user: "Alex", partner: "Sam" },
  } as unknown as ReportDataV2;
}

type Responder = () => SyncResponseLike | Promise<SyncResponseLike>;
interface FetchCall {
  url: string;
  init?: RequestInit;
}

function makeFakeFetch(responses: Responder[]): { impl: SyncFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const remaining = [...responses];
  const impl: SyncFetch = async (url, init) => {
    calls.push({ url, init });
    const responder = remaining.shift();
    if (responder === undefined) throw new Error(`unexpected fetch call: ${url}`);
    return responder();
  };
  return { impl, calls };
}

function jsonResponder(status: number, body: unknown): Responder {
  return () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function throwingResponder(): Responder {
  return () => {
    throw new Error("offline");
  };
}

function parsedBody(call: FetchCall | undefined): Record<string, unknown> {
  const raw = call?.init?.body;
  if (typeof raw !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(raw) as Record<string, unknown>;
}

const READY_ORDER = { status: "completed", ready: true, uploadToken: "upload-token-1" };

describe("shouldSyncReport", () => {
  it("only syncs for a live paid visit with local features", () => {
    expect(shouldSyncReport({ isMock: false, token: "v1.token", hasLocalFeatures: true })).toBe(true);
  });

  it("never syncs in mock mode, without a token, or without local features", () => {
    expect(shouldSyncReport({ isMock: true, token: "v1.token", hasLocalFeatures: true })).toBe(false);
    expect(shouldSyncReport({ isMock: false, token: null, hasLocalFeatures: true })).toBe(false);
    expect(shouldSyncReport({ isMock: false, token: "  ", hasLocalFeatures: true })).toBe(false);
    expect(shouldSyncReport({ isMock: false, token: "v1.token", hasLocalFeatures: false })).toBe(false);
  });
});

describe("syncReportToServer · device 1 silent upload", () => {
  it("skips without any network call when the checkout reference is missing", async () => {
    const { impl, calls } = makeFakeFetch([]);
    const result = await syncReportToServer({ checkoutRef: null, report: sampleReport(), fetchImpl: impl });
    expect(result).toEqual({ status: "skipped", reason: "missing-checkout-ref" });
    expect(calls).toHaveLength(0);
  });

  it("skips an invalid/foreign report without any network call", async () => {
    const { impl, calls } = makeFakeFetch([]);
    const foreign = { ...sampleReport(), meta: { schemaVersion: "features_v1" } } as unknown as ReportDataV2;
    const result = await syncReportToServer({ checkoutRef: "tell_1", report: foreign, fetchImpl: impl });
    expect(result).toEqual({ status: "skipped", reason: "invalid-report" });
    expect(calls).toHaveLength(0);
  });

  it("queries order-status with the encoded client reference", async () => {
    const { impl, calls } = makeFakeFetch([jsonResponder(200, { status: "pending", ready: false })]);
    const result = await syncReportToServer({ checkoutRef: " tell_ab c ", report: sampleReport(), fetchImpl: impl });
    expect(result).toEqual({ status: "queued", reason: "order-not-ready" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ORDER_STATUS_ENDPOINT}?ref=tell_ab%20c`);
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("queues when the order is ready but no uploadToken was issued", async () => {
    const { impl, calls } = makeFakeFetch([jsonResponder(200, { status: "completed", ready: true })]);
    const result = await syncReportToServer({ checkoutRef: "tell_1", report: sampleReport(), fetchImpl: impl });
    expect(result).toEqual({ status: "queued", reason: "missing-upload-token" });
    expect(calls).toHaveLength(1);
  });

  it("uploads exactly the whitelisted report fields after the order is ready", async () => {
    const { impl, calls } = makeFakeFetch([
      jsonResponder(200, READY_ORDER),
      jsonResponder(200, { ok: true, savedAt: "2026-03-15T10:05:00.000Z" }),
    ]);
    const result = await syncReportToServer({
      checkoutRef: "tell_1",
      report: reportWithLocalExtras(),
      fetchImpl: impl,
    });

    expect(result).toEqual({
      status: "saved",
      reason: "saved",
      savedAt: "2026-03-15T10:05:00.000Z",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe(REPORT_ENDPOINT);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.headers).toEqual({ "Content-Type": "application/json" });

    const body = parsedBody(calls[1]);
    expect(Object.keys(body).sort()).toEqual(["report", "uploadToken"]);
    expect(body.uploadToken).toBe(READY_ORDER.uploadToken);
    const report = body.report as Record<string, unknown>;
    expect(Object.keys(report).sort()).toEqual([...REPORT_UPLOAD_TOP_LEVEL_KEYS].sort());
    // Local-only fields must be physically absent, not just undefined.
    const serialized = JSON.stringify(body);
    for (const forbidden of ['"conversation"', '"features"', '"speakers"', "raw chat text", '"features_v1"']) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  it("never throws when the upload is rejected", async () => {
    const { impl, calls } = makeFakeFetch([
      jsonResponder(200, READY_ORDER),
      jsonResponder(500, { ok: false, error: "report store unavailable" }),
    ]);
    const result = await syncReportToServer({ checkoutRef: "tell_1", report: sampleReport(), fetchImpl: impl });
    expect(result).toEqual({ status: "failed", reason: "upload-rejected", httpStatus: 500 });
    expect(calls).toHaveLength(2);
  });

  it("maps transport failures on either step to failed/network-error", async () => {
    const statusDown = makeFakeFetch([throwingResponder()]);
    expect(
      await syncReportToServer({
        checkoutRef: "tell_1",
        report: sampleReport(),
        fetchImpl: statusDown.impl,
      }),
    ).toEqual({ status: "failed", reason: "network-error" });

    const uploadDown = makeFakeFetch([jsonResponder(200, READY_ORDER), throwingResponder()]);
    expect(
      await syncReportToServer({
        checkoutRef: "tell_1",
        report: sampleReport(),
        fetchImpl: uploadDown.impl,
      }),
    ).toEqual({ status: "failed", reason: "network-error" });
  });

  it("maps a non-200 order-status response to a diagnosable failure", async () => {
    const { impl } = makeFakeFetch([jsonResponder(404, { ok: false })]);
    const result = await syncReportToServer({ checkoutRef: "tell_1", report: sampleReport(), fetchImpl: impl });
    expect(result).toEqual({
      status: "failed",
      reason: "order-status-unavailable",
      httpStatus: 404,
    });
  });
});

describe("buildReportUploadPayload", () => {
  it("is a strict top-level whitelist and never mutates the report", () => {
    const report = reportWithLocalExtras();
    const payload = buildReportUploadPayload(report, "token-1");
    expect(Object.keys(payload)).toEqual(["uploadToken", "report"]);
    expect(Object.keys(payload.report).sort()).toEqual([...REPORT_UPLOAD_TOP_LEVEL_KEYS].sort());
    expect(payload.report.chapters).toBe(report.chapters);
    expect(Object.keys(report)).toContain("conversation");
  });

  it("pins the checkout reference key used by /checkout", () => {
    // Actual key written by lib/checkout.ts#CHECKOUT_CLIENT_REF_STORAGE_KEY.
    expect(CHECKOUT_REF_STORAGE_KEY).toBe("tell:checkout-client-ref");
    // Spec key stays available as a read fallback.
    expect(CONTRACT_CHECKOUT_REF_STORAGE_KEY).toBe("tell:checkout_ref");
  });
});

describe("loadServerReport · device 2 by magic link", () => {
  it("skips without any network call when there is no token", async () => {
    const { impl, calls } = makeFakeFetch([]);
    expect(await loadServerReport({ token: null, fetchImpl: impl })).toEqual({
      status: "skipped",
      reason: "no-token",
    });
    expect(calls).toHaveLength(0);
  });

  it("loads the saved report and savedAt from GET /api/report", async () => {
    const report = sampleReport();
    const { impl, calls } = makeFakeFetch([
      jsonResponder(200, { ok: true, report, savedAt: "2026-03-15T10:05:00.000Z" }),
    ]);
    const result = await loadServerReport({ token: "v1.token.signature", fetchImpl: impl });
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") throw new Error("expected loaded");
    expect(result.report).toEqual(report);
    expect(result.savedAt).toBe("2026-03-15T10:05:00.000Z");
    expect(calls[0]?.url).toBe(`${REPORT_ENDPOINT}?token=v1.token.signature`);
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("maps 404 to not-found (page keeps the waiting state)", async () => {
    const { impl } = makeFakeFetch([jsonResponder(404, { ok: false })]);
    expect(await loadServerReport({ token: "v1.token", fetchImpl: impl })).toEqual({
      status: "not-found",
    });
  });

  it("maps 410 to deleted (page shows the deleted state)", async () => {
    const { impl } = makeFakeFetch([jsonResponder(410, { ok: false, error: "report deleted" })]);
    expect(await loadServerReport({ token: "v1.token", fetchImpl: impl })).toEqual({
      status: "deleted",
    });
  });

  it("maps server errors, invalid payloads and transport failures to error", async () => {
    const serverError = makeFakeFetch([jsonResponder(500, { ok: false })]);
    expect(await loadServerReport({ token: "v1.token", fetchImpl: serverError.impl })).toEqual({
      status: "error",
      httpStatus: 500,
    });

    const invalidPayload = makeFakeFetch([jsonResponder(200, { ok: true, report: { nope: true } })]);
    expect(await loadServerReport({ token: "v1.token", fetchImpl: invalidPayload.impl })).toEqual({
      status: "error",
      httpStatus: 200,
    });

    const offline = makeFakeFetch([throwingResponder()]);
    expect(await loadServerReport({ token: "v1.token", fetchImpl: offline.impl })).toEqual({
      status: "error",
      httpStatus: null,
    });
  });

  it("accepts only the report_v2 six-chapter shape", () => {
    expect(isServerReportPayload(sampleReport())).toBe(true);
    expect(isServerReportPayload({ ...sampleReport(), chapters: [] })).toBe(false);
    expect(
      isServerReportPayload({ ...sampleReport(), meta: { ...sampleReport().meta, schemaVersion: "report_v1" } }),
    ).toBe(false);
    expect(isServerReportPayload(null)).toBe(false);
  });
});

describe("interpretSyncResult · UI policy", () => {
  function cleanCopy(text: string): void {
    expect(text.trim().length).toBeGreaterThan(0);
    expect(/[\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(text)).toBe(false);
    const lower = text.toLowerCase();
    for (const term of FORBIDDEN_TERMS) expect(lower.includes(term)).toBe(false);
  }

  it("makes the product string for a successful save the only visible state", () => {
    const saved = interpretSyncResult({ status: "saved", reason: "saved" });
    expect(saved.title).toBe("Saved — open this link on any device");
    expect(saved.tone).toBe("success");
    expect(saved.visible).toBe(true);
    cleanCopy(saved.title);
    cleanCopy(saved.message);

    const results: ReportSyncResult[] = [
      { status: "queued", reason: "order-not-ready" },
      { status: "skipped", reason: "missing-checkout-ref" },
      { status: "failed", reason: "network-error" },
    ];
    for (const result of results) {
      const copy = interpretSyncResult(result);
      expect(copy.visible).toBe(false);
      expect(copy.status).toBe(result.status);
      cleanCopy(copy.title);
      cleanCopy(copy.message);
    }
  });

  it("explains skipped reasons and transient states in English", () => {
    expect(interpretSyncResult({ status: "queued", reason: "missing-upload-token" }).tone).toBe("pending");
    expect(interpretSyncResult({ status: "skipped", reason: "invalid-report" }).tone).toBe("muted");
    expect(interpretSyncResult({ status: "failed", reason: "upload-rejected" }).tone).toBe("error");
    const skipped = interpretSyncResult({ status: "skipped", reason: "no-local-features" });
    expect(skipped.message).toContain("browser");
  });
});
