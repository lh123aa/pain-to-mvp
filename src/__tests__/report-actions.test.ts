/**
 * report-actions tests (W3-1).
 *
 * The refund/delete UI is a small state machine on top of two APIs whose
 * status codes carry product meaning (7-day window, idempotent replay,
 * expired magic link, network failure). These tests pin the pure matrix so the
 * page can stay a thin renderer:
 * - request builders put the right token/orderId in the right endpoint;
 * - availability explains why a button is disabled (mock / legacy order path);
 * - every documented status maps to one concrete next step;
 * - the "clear local data" decision is explicit per action.
 *
 * No React and no fetch are imported here — that is the point.
 */
import { describe, expect, it } from "vitest";

import {
  DELETE_REPORT_ENDPOINT,
  NETWORK_FAILURE_STATUS,
  REFUND_ENDPOINT,
  REFUND_WINDOW_DAYS,
  buildDeleteRequest,
  buildRefundRequest,
  deleteAvailability,
  interpretDeleteResponse,
  interpretRefundResponse,
  refundAvailability,
  shouldClearLocalData,
  type ReportActionAvailability,
  type ReportActionOutcome,
} from "@/lib/report-actions";

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

function outcomeCopy(outcome: ReportActionOutcome): string[] {
  return outcome.kind === "success"
    ? [outcome.title, outcome.message]
    : [outcome.title, outcome.message];
}

function expectCleanEnglish(strings: string[]): void {
  for (const copy of strings) {
    expect(copy.trim().length).toBeGreaterThan(0);
    expect(/[\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(copy)).toBe(false);
    const lower = copy.toLowerCase();
    for (const term of FORBIDDEN_TERMS) {
      expect(lower.includes(term), `copy must not contain "${term}"`).toBe(false);
    }
  }
}

function expectAvailable(availability: ReportActionAvailability): void {
  expect(availability.available).toBe(true);
  expect(availability.reason).toBe("available");
  expect(availability.helper.length).toBeGreaterThan(0);
}

describe("request builders", () => {
  it("builds the refund request from a trimmed magic-link token", () => {
    const request = buildRefundRequest("  v1.payload.sig  ");
    expect(request).not.toBeNull();
    expect(request?.endpoint).toBe(REFUND_ENDPOINT);
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({ "Content-Type": "application/json" });
    expect(request?.body).toEqual({ token: "v1.payload.sig" });
  });

  it("returns null when there is no usable token", () => {
    expect(buildRefundRequest(null)).toBeNull();
    expect(buildRefundRequest(undefined)).toBeNull();
    expect(buildRefundRequest("")).toBeNull();
    expect(buildRefundRequest("   ")).toBeNull();
    expect(buildDeleteRequest({ token: null })).toBeNull();
    expect(buildDeleteRequest({ token: "  " })).toBeNull();
  });

  it("builds the delete request with an optional orderId", () => {
    const tokenOnly = buildDeleteRequest({ token: "v1.token" });
    expect(tokenOnly?.endpoint).toBe(DELETE_REPORT_ENDPOINT);
    expect(tokenOnly?.body).toEqual({ token: "v1.token" });

    const withOrder = buildDeleteRequest({ token: " v1.token ", orderId: " ord_1 " });
    expect(withOrder?.body).toEqual({ token: "v1.token", orderId: "ord_1" });

    // Blank orderId must not be sent at all.
    const blankOrder = buildDeleteRequest({ token: "v1.token", orderId: "  " });
    expect(blankOrder?.body).toEqual({ token: "v1.token" });
  });
});

describe("refundAvailability", () => {
  it("disables refunds for mock checkouts and legacy order paths", () => {
    const noToken = refundAvailability({ token: null, isMock: false });
    expect(noToken.available).toBe(false);
    expect(noToken.reason).toBe("no-token");
    expect(noToken.helper).toContain("Only available for paid orders");

    const mock = refundAvailability({ token: null, isMock: true });
    expect(mock.available).toBe(false);
    expect(mock.reason).toBe("mock-checkout");
    expect(mock.helper).toContain("Only available for paid orders");
  });

  it("allows refunds only for a completed order with a token", () => {
    expectAvailable(refundAvailability({ token: "v1.t", isMock: false, orderStatus: "completed" }));
    expectAvailable(refundAvailability({ token: "v1.t", isMock: false }));
    expect(
      refundAvailability({ token: "v1.t", isMock: false, orderStatus: "completed" }).helper,
    ).toContain(`${REFUND_WINDOW_DAYS} days`);
  });

  it("explains already-refunded, already-deleted and non-refundable orders", () => {
    const refunded = refundAvailability({ token: "v1.t", isMock: false, orderStatus: "refunded" });
    expect(refunded.available).toBe(false);
    expect(refunded.reason).toBe("order-refunded");
    expect(refunded.helper.toLowerCase()).toContain("already refunded");

    const deleted = refundAvailability({ token: "v1.t", isMock: false, orderStatus: "deleted" });
    expect(deleted.available).toBe(false);
    expect(deleted.reason).toBe("order-deleted");

    const pending = refundAvailability({ token: "v1.t", isMock: false, orderStatus: "pending" });
    expect(pending.available).toBe(false);
    expect(pending.reason).toBe("order-not-refundable");
    expect(pending.helper.length).toBeGreaterThan(0);
  });
});

describe("deleteAvailability", () => {
  it("disables server deletion for mock checkouts and legacy order paths", () => {
    const noToken = deleteAvailability({ token: null, isMock: false });
    expect(noToken.available).toBe(false);
    expect(noToken.reason).toBe("no-token");
    expect(noToken.helper).toContain("Only available for paid orders");

    const mock = deleteAvailability({ token: null, isMock: true });
    expect(mock.available).toBe(false);
    expect(mock.reason).toBe("mock-checkout");
  });

  it("stays available when the order was already deleted (idempotent + local clear)", () => {
    expectAvailable(deleteAvailability({ token: "v1.t", isMock: false, orderStatus: "deleted" }));
    expect(
      deleteAvailability({ token: "v1.t", isMock: false, orderStatus: "deleted" }).helper.toLowerCase(),
    ).toContain("already deleted");
    expectAvailable(deleteAvailability({ token: "v1.t", isMock: false, orderStatus: "completed" }));
  });
});

describe("shouldClearLocalData", () => {
  it("clears the browser copy for delete actions but not for refunds", () => {
    expect(shouldClearLocalData("refund")).toBe(false);
    expect(shouldClearLocalData("delete")).toBe(true);
    expect(shouldClearLocalData("delete-local")).toBe(true);
  });

  it("follows the success outcome's explicit decision", () => {
    expect(shouldClearLocalData(interpretDeleteResponse(200, { ok: true }))).toBe(true);
    expect(shouldClearLocalData(interpretRefundResponse(200, { ok: true }))).toBe(false);
    expect(shouldClearLocalData(interpretDeleteResponse(500, { ok: false }))).toBe(false);
    expect(shouldClearLocalData(interpretRefundResponse(401, { ok: false }))).toBe(false);
  });
});

describe("interpretRefundResponse", () => {
  it("maps a fresh 200 to the exact success copy with revoked access", () => {
    const outcome = interpretRefundResponse(200, { ok: true, mode: "local" });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("expected success");
    expect(outcome.title).toBe("Refunded. Access revoked.");
    expect(outcome.alreadyDone).toBe(false);
    expect(outcome.accessRevoked).toBe(true);
    expect(outcome.clearLocalData).toBe(false);
  });

  it("maps an idempotent replay to 'Already refunded'", () => {
    const outcome = interpretRefundResponse(200, { ok: true, alreadyRefunded: true });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("expected success");
    expect(outcome.alreadyDone).toBe(true);
    expect(outcome.title).toBe("Already refunded");
  });

  it("maps expired / invalid / revoked links without inviting a blind retry", () => {
    const expired = interpretRefundResponse(401, { ok: false, reason: "expired" });
    expect(expired.kind).toBe("error");
    if (expired.kind !== "error") throw new Error("expected error");
    expect(expired.title.toLowerCase()).toContain("expired");
    expect(expired.retryable).toBe(false);

    const invalid = interpretRefundResponse(401, { ok: false, reason: "invalid_signature" });
    expect(invalid.kind).toBe("error");
    expect(invalid.kind === "error" && invalid.retryable).toBe(false);

    const revoked = interpretRefundResponse(401, { ok: false, reason: "revoked" });
    expect(revoked.kind).toBe("error");
    expect(revoked.kind === "error" && revoked.title).toContain("no longer active");
  });

  it("maps the 7-day window expiry to a non-retryable 'past the window' message", () => {
    const outcome = interpretRefundResponse(422, {
      ok: false,
      error: `refund window expired (${REFUND_WINDOW_DAYS} days)`,
      windowDays: REFUND_WINDOW_DAYS,
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") throw new Error("expected error");
    expect(outcome.title).toContain(`${REFUND_WINDOW_DAYS}-day`);
    expect(outcome.message).toContain(`${REFUND_WINDOW_DAYS} days`);
    expect(outcome.retryable).toBe(false);
    expect(outcome.offerLocalDelete).toBe(false);
  });

  it("distinguishes a not-yet-refundable 422 from the window expiry", () => {
    const outcome = interpretRefundResponse(422, {
      ok: false,
      error: 'order status "pending" is not refundable',
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") throw new Error("expected error");
    expect(outcome.title.toLowerCase()).toContain("can't be refunded yet");
    expect(outcome.retryable).toBe(true);
  });

  it("marks transient server/provider failures retryable", () => {
    for (const status of [400, 500, 502]) {
      const outcome = interpretRefundResponse(status, { ok: false, error: "boom" });
      expect(outcome.kind).toBe("error");
      expect(outcome.kind === "error" && outcome.retryable).toBe(true);
    }
    const provider = interpretRefundResponse(502, { ok: false, error: "LS down" });
    expect(provider.kind === "error" && provider.title).toContain("payment provider");
  });

  it("treats a 404 / 409 as terminal and network failure as retryable", () => {
    const notFound = interpretRefundResponse(404, { ok: false, error: "order not found" });
    expect(notFound.kind === "error" && notFound.retryable).toBe(false);
    const deleted = interpretRefundResponse(409, { ok: false, error: "order deleted" });
    expect(deleted.kind === "error" && deleted.retryable).toBe(false);

    const network = interpretRefundResponse(NETWORK_FAILURE_STATUS, null);
    expect(network.kind).toBe("error");
    if (network.kind !== "error") throw new Error("expected error");
    expect(network.retryable).toBe(true);
    expect(network.title.toLowerCase()).toContain("reach the server");

    const unknown = interpretRefundResponse(418, {});
    expect(unknown.kind === "error" && unknown.retryable).toBe(true);
  });
});

describe("interpretDeleteResponse", () => {
  it("maps a fresh 200 to the exact deletion copy and clears local data", () => {
    const outcome = interpretDeleteResponse(200, { ok: true, deletedAt: "2026-03-15T10:00:00.000Z" });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("expected success");
    expect(outcome.title).toBe("Your data has been deleted");
    expect(outcome.message).toBe(
      "Your analysis data has been deleted from this browser and from our servers.",
    );
    expect(outcome.clearLocalData).toBe(true);
    expect(outcome.accessRevoked).toBe(true);
    expect(outcome.alreadyDone).toBe(false);
  });

  it("maps an idempotent replay to 'Already deleted' and still clears local data", () => {
    const outcome = interpretDeleteResponse(200, { ok: true, alreadyDeleted: true });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("expected success");
    expect(outcome.alreadyDone).toBe(true);
    expect(outcome.title).toBe("Already deleted");
    expect(outcome.clearLocalData).toBe(true);
  });

  it("offers the local-only fallback when the server can't delete the data", () => {
    for (const status of [401, 403, 404, 500, NETWORK_FAILURE_STATUS]) {
      const outcome = interpretDeleteResponse(status, { ok: false, reason: "expired" });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") throw new Error("expected error");
      expect(outcome.message.toLowerCase()).toContain("local copy");
      expect(outcome.offerLocalDelete).toBe(true);
    }
  });

  it("marks only transient delete failures retryable", () => {
    const retryable = interpretDeleteResponse(400, { ok: false });
    expect(retryable.kind === "error" && retryable.retryable).toBe(true);
    const forbidden = interpretDeleteResponse(403, { ok: false });
    expect(forbidden.kind === "error" && forbidden.retryable).toBe(false);
    const notFound = interpretDeleteResponse(404, { ok: false });
    expect(notFound.kind === "error" && notFound.retryable).toBe(false);
    const server = interpretDeleteResponse(500, { ok: false });
    expect(server.kind === "error" && server.retryable).toBe(true);
  });
});

describe("copy discipline", () => {
  it("keeps every outcome and availability string English and non-clinical", () => {
    const outcomes: ReportActionOutcome[] = [
      interpretRefundResponse(200, { ok: true }),
      interpretRefundResponse(200, { ok: true, alreadyRefunded: true }),
      interpretRefundResponse(401, { ok: false, reason: "expired" }),
      interpretRefundResponse(422, { ok: false, windowDays: 7 }),
      interpretRefundResponse(500, { ok: false }),
      interpretRefundResponse(NETWORK_FAILURE_STATUS, null),
      interpretDeleteResponse(200, { ok: true }),
      interpretDeleteResponse(200, { ok: true, alreadyDeleted: true }),
      interpretDeleteResponse(401, { ok: false, reason: "revoked" }),
      interpretDeleteResponse(404, { ok: false }),
      interpretDeleteResponse(500, { ok: false }),
      interpretDeleteResponse(NETWORK_FAILURE_STATUS, null),
    ];
    for (const outcome of outcomes) expectCleanEnglish(outcomeCopy(outcome));

    const availability: ReportActionAvailability[] = [
      refundAvailability({ token: null, isMock: false }),
      refundAvailability({ token: null, isMock: true }),
      refundAvailability({ token: "v1.t", isMock: false }),
      refundAvailability({ token: "v1.t", isMock: false, orderStatus: "refunded" }),
      refundAvailability({ token: "v1.t", isMock: false, orderStatus: "deleted" }),
      deleteAvailability({ token: null, isMock: false }),
      deleteAvailability({ token: "v1.t", isMock: false, orderStatus: "deleted" }),
      deleteAvailability({ token: "v1.t", isMock: false }),
    ];
    for (const entry of availability) expectCleanEnglish([entry.helper]);
  });
});
