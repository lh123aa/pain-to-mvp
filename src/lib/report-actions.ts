/**
 * Report-page action logic (`W3-1`)
 * =================================
 * Pure functions and types for the two self-serve privacy actions on `/report`:
 *
 *   - `POST /api/refund`         — refund the purchase (7-day window) and revoke access
 *   - `POST /api/delete-report`  — delete the analysis data server-side and revoke access
 *
 * This module owns **all** the decisions the page needs and none of the effects:
 * no React, no `fetch`, no storage access. The page keeps a thin `fetch` wrapper
 * and calls `clearSession()` (from `lib/client-session.ts`) when
 * `shouldClearLocalData()` says so. Keeping it pure means the status-code /
 * copy matrix is unit-testable without mocking React or the network.
 *
 * Copy discipline: English only, written for US/EU users. Each failure maps to
 * one concrete next step ("try again", "open a newer link", "contact support")
 * instead of a generic error toast.
 */

/** Unconditional refund window, mirrored from `lib/refund.ts` (kept local: no imports here). */
export const REFUND_WINDOW_DAYS = 7;

export const REFUND_ENDPOINT = "/api/refund" as const;
export const DELETE_REPORT_ENDPOINT = "/api/delete-report" as const;

/**
 * Status code used by the page's fetch wrapper when the request never reached
 * the server (offline / DNS / CORS). Keeping it a normal number lets
 * `interpret*Response` handle the network case in the same matrix.
 */
export const NETWORK_FAILURE_STATUS = 0;

export type ReportActionKind = "refund" | "delete" | "delete-local";

/** Body of `POST /api/refund`. */
export interface RefundRequestBody {
  token: string;
}

/** Body of `POST /api/delete-report` (`orderId` optional; the token alone is enough). */
export interface DeleteRequestBody {
  token: string;
  orderId?: string;
}

export interface ReportActionRequest {
  endpoint: typeof REFUND_ENDPOINT | typeof DELETE_REPORT_ENDPOINT;
  method: "POST";
  headers: { "Content-Type": "application/json" };
  body: RefundRequestBody | DeleteRequestBody;
}

function cleanToken(token: string | null | undefined): string | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Build the refund request, or `null` when there is no magic-link token to send. */
export function buildRefundRequest(token: string | null | undefined): ReportActionRequest | null {
  const cleaned = cleanToken(token);
  if (cleaned === null) return null;
  return {
    endpoint: REFUND_ENDPOINT,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { token: cleaned },
  };
}

/**
 * Build the delete request, or `null` when there is no magic-link token.
 * `orderId` is only attached when the page actually knows it (legacy
 * `?order_id=` path) — the API validates it against the token when present.
 */
export function buildDeleteRequest(input: {
  token?: string | null;
  orderId?: string | null;
}): ReportActionRequest | null {
  const token = cleanToken(input.token);
  if (token === null) return null;
  const orderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
  return {
    endpoint: DELETE_REPORT_ENDPOINT,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: orderId.length > 0 ? { token, orderId } : { token },
  };
}

/* -------------------------------------------------------------------------------------------------
 * Outcomes
 * ------------------------------------------------------------------------------------------------*/

export interface ReportActionSuccess {
  kind: "success";
  /** true = the server says the work was already done (idempotent replay). */
  alreadyDone: boolean;
  title: string;
  message: string;
  /** true = delete the browser copy of the analysis (features / last input). */
  clearLocalData: boolean;
  /** true = server-side report access is now revoked. */
  accessRevoked: boolean;
}

export interface ReportActionError {
  kind: "error";
  title: string;
  message: string;
  /** true = retrying the same request can reasonably succeed. */
  retryable: boolean;
  /** true = offer the local-only delete fallback from the error panel. */
  offerLocalDelete: boolean;
}

export type ReportActionOutcome = ReportActionSuccess | ReportActionError;

/* -------------------------------------------------------------------------------------------------
 * Availability (button enable/disable + explanation)
 * ------------------------------------------------------------------------------------------------*/

export type ReportActionUnavailableReason =
  | "no-token"
  | "mock-checkout"
  | "order-refunded"
  | "order-deleted"
  | "order-not-refundable";

export interface ReportActionAvailability {
  available: boolean;
  reason: "available" | ReportActionUnavailableReason;
  /** Human-readable reason / next step, always English. */
  helper: string;
}

export interface ReportActionAvailabilityInput {
  /** Magic-link token from `?token=`. */
  token?: string | null;
  /** true = mock checkout (no real order exists server-side). */
  isMock: boolean;
  /** Verified order status when the page has it ("completed" / "refunded" / "deleted" / ...). */
  orderStatus?: string | null;
}

/** Shared "no server action possible" copy — the task's exact product wording. */
const PAID_ONLY_HELPER =
  "Only available for paid orders. Open the magic link from your purchase email to use this.";

function normalizeStatus(status: string | null | undefined): string | null {
  if (typeof status !== "string") return null;
  const trimmed = status.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function hasToken(token: string | null | undefined): boolean {
  return cleanToken(token) !== null;
}

/** Can the page call `POST /api/refund` right now, and why not? */
export function refundAvailability(
  input: ReportActionAvailabilityInput,
): ReportActionAvailability {
  if (input.isMock) {
    return {
      available: false,
      reason: "mock-checkout",
      helper: `Only available for paid orders. This is a demo checkout.`,
    };
  }
  if (!hasToken(input.token)) {
    return { available: false, reason: "no-token", helper: PAID_ONLY_HELPER };
  }
  const status = normalizeStatus(input.orderStatus);
  if (status === "refunded") {
    return {
      available: false,
      reason: "order-refunded",
      helper: "This order was already refunded, so access is already revoked.",
    };
  }
  if (status === "deleted") {
    return {
      available: false,
      reason: "order-deleted",
      helper: "This order was deleted, so there is nothing left to refund.",
    };
  }
  if (status !== null && status !== "completed") {
    return {
      available: false,
      reason: "order-not-refundable",
      helper: "This order isn't refundable yet. Wait for the receipt, then try again.",
    };
  }
  return {
    available: true,
    reason: "available",
    helper: `Self-serve refunds are available within ${REFUND_WINDOW_DAYS} days of purchase.`,
  };
}

/** Can the page call `POST /api/delete-report` right now, and why not? */
export function deleteAvailability(
  input: ReportActionAvailabilityInput,
): ReportActionAvailability {
  if (input.isMock) {
    return {
      available: false,
      reason: "mock-checkout",
      helper: `Only available for paid orders. This is a demo checkout.`,
    };
  }
  if (!hasToken(input.token)) {
    return { available: false, reason: "no-token", helper: PAID_ONLY_HELPER };
  }
  const status = normalizeStatus(input.orderStatus);
  if (status === "deleted") {
    return {
      available: true,
      reason: "available",
      helper: "Server data is already deleted; this button will also clear this browser.",
    };
  }
  return {
    available: true,
    reason: "available",
    helper: "Deletes your analysis data from our servers and from this browser.",
  };
}

/**
 * Should the page clear the local analysis after this action?
 * - `"delete"` / `"delete-local"` → yes (privacy deletion includes the browser copy).
 * - `"refund"` → no (refund revokes access; it is not a data-deletion request).
 * - A success outcome carries the same decision explicitly.
 */
export function shouldClearLocalData(
  action: ReportActionKind | ReportActionOutcome,
): boolean {
  if (typeof action === "string") {
    return action === "delete" || action === "delete-local";
  }
  return action.kind === "success" && action.clearLocalData;
}

/* -------------------------------------------------------------------------------------------------
 * Response interpretation
 * ------------------------------------------------------------------------------------------------*/

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function readReason(body: Record<string, unknown>): string {
  return readString(body, "reason").trim().toLowerCase();
}

function readErrorText(body: Record<string, unknown>): string {
  return readString(body, "error").trim();
}

function isBodyOk(body: Record<string, unknown>): boolean {
  return body.ok === true;
}

function networkError(): ReportActionError {
  return {
    kind: "error",
    title: "We couldn't reach the server",
    message: "Check your connection and try again. Nothing has been changed.",
    retryable: true,
    offerLocalDelete: false,
  };
}

function genericError(): ReportActionError {
  return {
    kind: "error",
    title: "We couldn't complete that",
    message: "Something went wrong on our side. Nothing has been changed - try again in a moment.",
    retryable: true,
    offerLocalDelete: false,
  };
}

function invalidRequestError(retryable: boolean): ReportActionError {
  return {
    kind: "error",
    title: "That request didn't go through",
    message: retryable
      ? "Nothing has been changed. Refresh the page and try again."
      : "Nothing has been changed. Open the magic link from your purchase email again.",
    retryable,
    offerLocalDelete: false,
  };
}

/** 401 mapping shared by both endpoints (magic-link reasons returned by the API). */
function linkError(body: Record<string, unknown>, offerLocalDelete: boolean): ReportActionError {
  const reason = readReason(body);
  if (reason === "expired") {
    return {
      kind: "error",
      title: "Your magic link has expired",
      message: offerLocalDelete
        ? "Magic links are valid for 7 days. Request a fresh link from your purchase email. You can also remove the local copy from this device."
        : "Magic links are valid for 7 days. Request a fresh link from your purchase email, then try again.",
      retryable: false,
      offerLocalDelete,
    };
  }
  if (reason === "revoked") {
    return {
      kind: "error",
      title: "This link is no longer active",
      message: offerLocalDelete
        ? "Access to this report was already revoked. You can still remove the local copy from this device."
        : "This order was refunded or deleted, so access is already revoked.",
      retryable: false,
      offerLocalDelete,
    };
  }
  return {
    kind: "error",
    title: "That link isn't valid",
    message: offerLocalDelete
      ? "Open the newest magic link from your purchase email. You can also remove the local copy from this device."
      : "Open the newest magic link from your purchase email, then try again.",
    retryable: false,
    offerLocalDelete,
  };
}

/**
 * Map `POST /api/refund` (status, body) to a renderable outcome.
 *
 * API matrix: 200 ok / 200 alreadyRefunded / 400 / 401 / 404 / 409 / 422
 * (past 7-day window or not refundable) / 500 / 502.
 */
export function interpretRefundResponse(status: number, body: unknown): ReportActionOutcome {
  if (status === NETWORK_FAILURE_STATUS) return networkError();
  const payload = asRecord(body);

  if (status === 200) {
    if (!isBodyOk(payload)) return genericError();
    if (payload.alreadyRefunded === true) {
      return {
        kind: "success",
        alreadyDone: true,
        title: "Already refunded",
        message: "This order was already refunded, so access stays revoked.",
        clearLocalData: false,
        accessRevoked: true,
      };
    }
    return {
      kind: "success",
      alreadyDone: false,
      title: "Refunded. Access revoked.",
      message:
        "Your payment has been refunded and this report link no longer opens the report. " +
        "Refunds can take a few business days to appear on your statement.",
      clearLocalData: false,
      accessRevoked: true,
    };
  }

  if (status === 400) return invalidRequestError(true);
  if (status === 401) return linkError(payload, false);
  if (status === 404) {
    return {
      kind: "error",
      title: "We couldn't find that order",
      message: "If you were charged and this keeps happening, contact support and we'll sort it out.",
      retryable: false,
      offerLocalDelete: false,
    };
  }
  if (status === 409) {
    return {
      kind: "error",
      title: "This order was deleted",
      message: "Deleted orders can't be refunded. Contact support if you were charged for this one.",
      retryable: false,
      offerLocalDelete: false,
    };
  }
  if (status === 422) {
    const errorText = readErrorText(payload).toLowerCase();
    const pastWindow = typeof payload.windowDays === "number" || errorText.includes("window");
    if (pastWindow) {
      return {
        kind: "error",
        title: `Past the ${REFUND_WINDOW_DAYS}-day refund window`,
        message:
          `Refunds are available for ${REFUND_WINDOW_DAYS} days after purchase. Nothing has changed and your report access is still active.`,
        retryable: false,
        offerLocalDelete: false,
      };
    }
    return {
      kind: "error",
      title: "This order can't be refunded yet",
      message: "The payment may still be processing. Wait for the receipt email, then try again.",
      retryable: true,
      offerLocalDelete: false,
    };
  }
  if (status === 500) {
    return {
      kind: "error",
      title: "Refunds aren't available right now",
      message: "Nothing has been changed. Try again in a moment, or contact support.",
      retryable: true,
      offerLocalDelete: false,
    };
  }
  if (status === 502) {
    return {
      kind: "error",
      title: "The payment provider didn't complete the refund",
      message: "Nothing has been changed - try again in a moment.",
      retryable: true,
      offerLocalDelete: false,
    };
  }
  return genericError();
}

/**
 * Map `POST /api/delete-report` (status, body) to a renderable outcome.
 *
 * API matrix: 200 ok / 200 alreadyDeleted / 400 / 401 / 403 / 404.
 */
export function interpretDeleteResponse(status: number, body: unknown): ReportActionOutcome {
  if (status === NETWORK_FAILURE_STATUS) {
    return {
      ...networkError(),
      message: "Check your connection and try again. You can also remove the local copy from this device.",
      offerLocalDelete: true,
    };
  }
  const payload = asRecord(body);

  if (status === 200) {
    if (!isBodyOk(payload)) return genericError();
    if (payload.alreadyDeleted === true) {
      return {
        kind: "success",
        alreadyDone: true,
        title: "Already deleted",
        message:
          "This analysis was already deleted from our servers. We also cleared this browser.",
        clearLocalData: true,
        accessRevoked: true,
      };
    }
    return {
      kind: "success",
      alreadyDone: false,
      title: "Your data has been deleted",
      message: "Your analysis data has been deleted from this browser and from our servers.",
      clearLocalData: true,
      accessRevoked: true,
    };
  }

  if (status === 400) return invalidRequestError(true);
  if (status === 401) return linkError(payload, true);
  if (status === 403) {
    return {
      kind: "error",
      title: "We couldn't verify this order",
      message:
        "This link doesn't match the order you're trying to delete. Nothing has been changed. You can still remove the local copy from this device.",
      retryable: false,
      offerLocalDelete: true,
    };
  }
  if (status === 404) {
    return {
      kind: "error",
      title: "We couldn't find that order",
      message:
        "There may be nothing left to delete on our side. You can still remove the local copy from this device.",
      retryable: false,
      offerLocalDelete: true,
    };
  }
  if (status === 500) {
    return {
      kind: "error",
      title: "Deletion couldn't be completed",
      message:
        "Nothing has been changed on our servers. Try again in a moment, or remove the local copy from this device.",
      retryable: true,
      offerLocalDelete: true,
    };
  }
  return {
    ...genericError(),
    message: `${genericError().message} You can also remove the local copy from this device.`,
    offerLocalDelete: true,
  };
}
