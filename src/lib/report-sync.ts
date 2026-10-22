/**
 * Cross-device report sync (W3-2, "plan A")
 * =========================================
 * Device 1 analyses the chat locally and then pays. Device 2 (or a new browser)
 * only has the magic link. Plan A syncs the **already generated
 * `ReportDataV2`** (six chapters + short evidence quotes), never the raw
 * conversation: the upload payload is built from an explicit top-level
 * whitelist, so a `conversation`/`features` field can never leak even if the
 * caller passes a wider object.
 *
 * Fixed API contract (implemented in parallel by the backend task):
 *   GET  /api/order-status?ref=<clientRef> -> { status, ready, uploadToken? }
 *   POST /api/report { uploadToken, report } -> { ok, savedAt }
 *   GET  /api/report?token=<magic token> -> { ok, report, savedAt } / 404 / 410
 *
 * Pure-ish module: no React, no direct `fetch` — the fetch implementation is
 * injectable and defaults to the global (the page passes the real one, tests
 * pass a fake). No function throws for expected failures; every branch returns
 * a diagnosable result the page can decide to show or ignore.
 *
 * UI policy: only the `saved` result is shown ("Saved — open this link on any
 * device"). `queued` / `skipped` / `failed` stay silent so sync can never
 * block or clutter the report.
 */
import { REPORT_CHAPTER_IDS } from "./report-contract";
import type { ReportDataV2 } from "./report-contract";

export const ORDER_STATUS_ENDPOINT = "/api/order-status";
export const REPORT_ENDPOINT = "/api/report";

/**
 * sessionStorage key for the checkout client reference.
 * The checkout task owns writing it: the actual key in
 * `lib/checkout.ts#CHECKOUT_CLIENT_REF_STORAGE_KEY` is "tell:checkout-client-ref"
 * (the W3-2 spec named it `tell:checkout_ref`; per the task, the real code wins
 * and the spec key is kept as a read fallback).
 */
export const CHECKOUT_REF_STORAGE_KEY = "tell:checkout-client-ref";

/** Spec/legacy key kept as a fallback when reading the client reference. */
export const CONTRACT_CHECKOUT_REF_STORAGE_KEY = "tell:checkout_ref";

/** Top-level report fields allowed in the upload payload (whitelist, in order). */
export const REPORT_UPLOAD_TOP_LEVEL_KEYS = [
  "meta",
  "headline",
  "chapters",
  "evidence",
  "disclaimer",
  "whatWeDontKnow",
  "dataQuality",
] as const;

export type ReportUploadReport = Pick<
  ReportDataV2,
  (typeof REPORT_UPLOAD_TOP_LEVEL_KEYS)[number]
>;

export interface ReportUploadPayload {
  uploadToken: string;
  report: ReportUploadReport;
}

/** Just enough of `Response` for the sync flow; injectable in tests. */
export interface SyncResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type SyncFetch = (url: string, init?: RequestInit) => Promise<SyncResponseLike>;

/* -------------------------------------------------------------------------------------------------
 * Should the page sync at all?
 * ------------------------------------------------------------------------------------------------*/

export interface ShouldSyncReportInput {
  /** Mock checkout: never touch the network. */
  isMock: boolean;
  /** Magic-link token from `?token=` (proof the order is paid). */
  token?: string | null;
  /** true = this browser holds `tell:features:v1` and built the report locally. */
  hasLocalFeatures: boolean;
}

/**
 * Cross-device sync only makes sense when the report was generated *here*
 * (device 1), the visit is a paid live visit (token verified) and the mode is
 * live. Everything else (mock, magic link on a device without local features,
 * bare `?order_id=`) must stay network-free.
 */
export function shouldSyncReport(input: ShouldSyncReportInput): boolean {
  if (input.isMock) return false;
  if (!input.hasLocalFeatures) return false;
  return cleanString(input.token) !== null;
}

/* -------------------------------------------------------------------------------------------------
 * Result types
 * ------------------------------------------------------------------------------------------------*/

export type SyncResultStatus = "queued" | "saved" | "skipped" | "failed";

export type SyncResultReason =
  | "saved"
  | "mock"
  | "no-token"
  | "no-local-features"
  | "missing-checkout-ref"
  | "invalid-report"
  | "order-not-ready"
  | "missing-upload-token"
  | "order-status-unavailable"
  | "network-error"
  | "upload-rejected";

export interface ReportSyncResult {
  status: SyncResultStatus;
  reason: SyncResultReason;
  /** ISO timestamp returned by `POST /api/report` when saved. */
  savedAt?: string;
  /** HTTP status of the failing request, when there was one. */
  httpStatus?: number | null;
}

export type SyncCopyTone = "success" | "pending" | "muted" | "error";

export interface SyncResultCopy {
  status: SyncResultStatus;
  title: string;
  message: string;
  tone: SyncCopyTone;
  /** Page shows only `saved`; the rest stay silent (never blocks the report). */
  visible: boolean;
}

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------------------------------*/

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Build the exact upload body from the whitelist. Anything not listed in
 * `REPORT_UPLOAD_TOP_LEVEL_KEYS` is dropped by construction, so the raw
 * conversation can never be uploaded even by accident.
 */
export function buildReportUploadPayload(
  report: ReportDataV2,
  uploadToken: string,
): ReportUploadPayload {
  return {
    uploadToken,
    report: {
      meta: report.meta,
      headline: report.headline,
      chapters: report.chapters,
      evidence: report.evidence,
      disclaimer: report.disclaimer,
      whatWeDontKnow: report.whatWeDontKnow,
      dataQuality: report.dataQuality,
    },
  };
}

/** Shallow shape check for a report fetched from the server before rendering it. */
export function isServerReportPayload(value: unknown): value is ReportDataV2 {
  if (!isRecord(value)) return false;
  const meta = value.meta;
  if (!isRecord(meta) || meta.schemaVersion !== "report_v2") return false;
  if (!isRecord(value.headline)) return false;
  if (!Array.isArray(value.chapters) || value.chapters.length !== REPORT_CHAPTER_IDS.length) {
    return false;
  }
  if (!Array.isArray(value.evidence)) return false;
  if (!Array.isArray(value.whatWeDontKnow)) return false;
  if (typeof value.disclaimer !== "string") return false;
  if (!isRecord(value.dataQuality)) return false;
  return true;
}

/* -------------------------------------------------------------------------------------------------
 * Device 1: silently upload the locally built report
 * ------------------------------------------------------------------------------------------------*/

export interface SyncReportOptions {
  /** Client reference written by /checkout (actual key: CHECKOUT_REF_STORAGE_KEY). */
  checkoutRef?: string | null;
  report: ReportDataV2;
  fetchImpl?: SyncFetch;
}

/**
 * Two-step upload:
 *   1. `GET /api/order-status?ref=` → wait for `ready:true` + `uploadToken`
 *   2. `POST /api/report { uploadToken, report }`
 *
 * Never throws: a not-ready order returns `queued`, transport/shape problems
 * return `failed` with a diagnostic `reason`/`httpStatus`.
 */
export async function syncReportToServer(options: SyncReportOptions): Promise<ReportSyncResult> {
  const fetchImpl: SyncFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const checkoutRef = cleanString(options.checkoutRef);
  if (checkoutRef === null) {
    return { status: "skipped", reason: "missing-checkout-ref" };
  }
  if (options.report.meta?.schemaVersion !== "report_v2") {
    return { status: "skipped", reason: "invalid-report" };
  }

  let statusResponse: SyncResponseLike;
  try {
    statusResponse = await fetchImpl(
      `${ORDER_STATUS_ENDPOINT}?ref=${encodeURIComponent(checkoutRef)}`,
      { method: "GET", cache: "no-store" },
    );
  } catch {
    return { status: "failed", reason: "network-error" };
  }
  if (!statusResponse.ok) {
    return { status: "failed", reason: "order-status-unavailable", httpStatus: statusResponse.status };
  }

  let statusBody: unknown = null;
  try {
    statusBody = await statusResponse.json();
  } catch {
    statusBody = null;
  }
  const order = isRecord(statusBody) ? statusBody : {};
  if (order.ready !== true) {
    return { status: "queued", reason: "order-not-ready" };
  }
  const uploadToken = readString(order, "uploadToken");
  if (uploadToken === null) {
    return { status: "queued", reason: "missing-upload-token" };
  }

  const payload = buildReportUploadPayload(options.report, uploadToken);
  let uploadResponse: SyncResponseLike;
  try {
    uploadResponse = await fetchImpl(REPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return { status: "failed", reason: "network-error" };
  }

  let uploadBody: unknown = null;
  try {
    uploadBody = await uploadResponse.json();
  } catch {
    uploadBody = null;
  }
  const saved = isRecord(uploadBody) ? uploadBody : {};
  if (!uploadResponse.ok || saved.ok !== true) {
    return { status: "failed", reason: "upload-rejected", httpStatus: uploadResponse.status };
  }
  const savedAt = readString(saved, "savedAt");
  return savedAt === null
    ? { status: "saved", reason: "saved" }
    : { status: "saved", reason: "saved", savedAt };
}

/* -------------------------------------------------------------------------------------------------
 * Device 2: load the saved report by magic-link token
 * ------------------------------------------------------------------------------------------------*/

export type ServerReportLoadResult =
  | { status: "loaded"; report: ReportDataV2; savedAt: string | null }
  | { status: "not-found" }
  | { status: "deleted" }
  | { status: "error"; httpStatus: number | null }
  | { status: "skipped"; reason: "no-token" };

export interface LoadServerReportOptions {
  token?: string | null;
  fetchImpl?: SyncFetch;
}

/**
 * `GET /api/report?token=`:
 * - 200 + valid report → `loaded` (page renders it through RealReportView)
 * - 404 → `not-found` (page keeps the existing waiting state)
 * - 410 → `deleted` (page shows the deleted state)
 * - anything else / transport error → `error` (page degrades gracefully)
 */
export async function loadServerReport(
  options: LoadServerReportOptions,
): Promise<ServerReportLoadResult> {
  const token = cleanString(options.token);
  if (token === null) return { status: "skipped", reason: "no-token" };
  const fetchImpl: SyncFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));

  let response: SyncResponseLike;
  try {
    response = await fetchImpl(`${REPORT_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "GET",
      cache: "no-store",
    });
  } catch {
    return { status: "error", httpStatus: null };
  }

  if (response.status === 404) return { status: "not-found" };
  if (response.status === 410) return { status: "deleted" };
  if (!response.ok) return { status: "error", httpStatus: response.status };

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = isRecord(body) ? body : {};
  if (record.ok !== true || !isServerReportPayload(record.report)) {
    return { status: "error", httpStatus: response.status };
  }
  return {
    status: "loaded",
    report: record.report,
    savedAt: readString(record, "savedAt"),
  };
}

/* -------------------------------------------------------------------------------------------------
 * Copy for the sync result
 * ------------------------------------------------------------------------------------------------*/

function skippedMessage(reason: SyncResultReason): string {
  switch (reason) {
    case "mock":
      return "Demo checkouts don't save reports across devices.";
    case "no-token":
      return "A magic link is required to save this report across devices.";
    case "no-local-features":
      return "This report was not generated in this browser, so there is nothing new to save.";
    case "missing-checkout-ref":
      return "This browser no longer has the checkout reference needed to save the report.";
    case "invalid-report":
      return "This report can't be saved in its current form.";
    default:
      return "Cross-device saving does not apply to this report.";
  }
}

/**
 * English copy for the sync state machine. The page only renders the `saved`
 * copy; the others exist for diagnostics, tests and the optional silent track
 * event, and never block the report.
 */
export function interpretSyncResult(result: ReportSyncResult): SyncResultCopy {
  if (result.status === "saved") {
    return {
      status: "saved",
      title: "Saved — open this link on any device",
      message:
        "We saved this report to your order, so your magic link now opens it on any device.",
      tone: "success",
      visible: true,
    };
  }
  if (result.status === "queued") {
    return {
      status: "queued",
      title: "Saving your report",
      message:
        "Your payment is still being processed. We'll save the report as soon as the order is ready.",
      tone: "pending",
      visible: false,
    };
  }
  if (result.status === "skipped") {
    return {
      status: "skipped",
      title: "Cross-device save skipped",
      message: skippedMessage(result.reason),
      tone: "muted",
      visible: false,
    };
  }
  return {
    status: "failed",
    title: "Cross-device save unavailable",
    message:
      "We couldn't save a cross-device copy right now. Your report still opens in this browser.",
    tone: "error",
    visible: false,
  };
}
