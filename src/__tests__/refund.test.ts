import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as refundPOST } from "@/app/api/refund/route";
import { GET as verifyGET } from "@/app/api/verify-magic-link/route";
import {
  isMagicLinkRevoked,
  issueMagicLinkToken,
  resetMagicLinkRevocationStore,
  verifyMagicLinkToken,
} from "@/lib/magic-link";
import {
  deleteOrderAnalysis,
  getOrderStore,
  isAccessRevoked,
  mergeOrderStatus,
  refundOrder,
  resetOrderStore,
  type OrderRecord,
} from "@/lib/orders";
import {
  LemonSqueezyRefundProvider,
  NoopRefundProvider,
  REFUND_WINDOW_MS,
  buildRefundRequestBody,
  getRefundProvider,
  isWithinRefundWindow,
} from "@/lib/refund";

/**
 * /api/refund 单测（全离线）
 *
 * 覆盖：
 * - 7 天内成功：状态 completed→refunded + refundedAt + 魔链吊销 + verify-magic-link 403
 * - 超 7 天 422、缺/非法/过期 token 401、未知订单 404、pending/deleted 不可退
 * - provider：无 key 本地 no-op / 有 key 走 LS（注入 fetch，断言 URL/header/body）/ 失败 502/404
 * - 幂等：重复退款 200 alreadyRefunded
 * - orders 状态机：completed→refunded→deleted 终态不回退；webhook 重放不回写 PII
 * - refund.ts 纯函数：请求体、7 天窗口、provider 选择
 */

const MAGIC_SECRET = "refund_test_secret";

const ORIGINAL_ENV: Record<string, string | undefined> = {
  MAGIC_LINK_SECRET: process.env.MAGIC_LINK_SECRET,
  LEMON_SQUEEZY_WEBHOOK_SECRET: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
  LEMON_SQUEEZY_API_KEY: process.env.LEMON_SQUEEZY_API_KEY,
  LEMON_SQUEEZY_LIVE: process.env.LEMON_SQUEEZY_LIVE,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function isoAt(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function baseOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const now = new Date().toISOString();
  return {
    orderId: "ord_1001",
    variantId: "456",
    email: "buyer@example.com",
    status: "completed",
    custom: { fileName: "chat.txt", speakerA: "Alex", speakerB: "Sam" },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    lastEventName: "order_created",
    testMode: false,
    ...overrides,
  };
}

async function seedOrder(overrides: Partial<OrderRecord> = {}): Promise<OrderRecord> {
  const order = baseOrder(overrides);
  await getOrderStore().upsert(order);
  return order;
}

function makeJsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function callRefund(body: unknown) {
  return refundPOST(makeJsonRequest("/api/refund", body));
}

function tokenFor(orderId = "ord_1001"): string {
  return issueMagicLinkToken(orderId);
}

beforeEach(() => {
  process.env.MAGIC_LINK_SECRET = MAGIC_SECRET;
  delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  delete process.env.LEMON_SQUEEZY_API_KEY;
  delete process.env.LEMON_SQUEEZY_LIVE;
  resetOrderStore();
  resetMagicLinkRevocationStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv();
  resetMagicLinkRevocationStore();
});

describe("POST /api/refund — 7 天窗口内成功", () => {
  it("completed 订单退款：200 + 状态 refunded + 魔链吊销 + verify-magic-link 403", async () => {
    await seedOrder();
    const token = tokenFor();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await callRefund({ token });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      refundedAt: string;
      mode: string;
    };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("local");
    expect(Number.isFinite(Date.parse(body.refundedAt))).toBe(true);
    // 无 API key → 不调用外部服务
    expect(fetchSpy).not.toHaveBeenCalled();

    const stored = await getOrderStore().get("ord_1001");
    expect(stored?.status).toBe("refunded");
    expect(stored?.refundedAt).toBeTruthy();
    expect(await isAccessRevoked("ord_1001")).toBe(true);
    expect(isMagicLinkRevoked("ord_1001")).toBe(true);

    // token 级吊销（带 checkRevocation 的验证会拒绝）
    expect(
      verifyMagicLinkToken(token, { checkRevocation: true })
    ).toMatchObject({ ok: false, reason: "revoked" });

    // verify-magic-link 走订单状态 → 403（token route 不在本任务作用域，未改状态码映射）
    const verifyRes = await verifyGET(
      new NextRequest(
        `http://localhost/api/verify-magic-link?token=${encodeURIComponent(token)}`
      )
    );
    expect(verifyRes.status).toBe(403);
  });

  it("7 天窗口边界：窗口内 200；超过 1 分钟 422", async () => {
    await seedOrder({
      orderId: "ord_inside",
      completedAt: isoAt(-REFUND_WINDOW_MS + 60_000),
    });
    const inside = await callRefund({ token: tokenFor("ord_inside") });
    expect(inside.status).toBe(200);

    await seedOrder({
      orderId: "ord_outside",
      completedAt: isoAt(-REFUND_WINDOW_MS - 60_000),
    });
    const outside = await callRefund({ token: tokenFor("ord_outside") });
    expect(outside.status).toBe(422);
    const outsideBody = (await outside.json()) as { error: string };
    expect(outsideBody.error).toMatch(/refund window expired/);
    expect((await getOrderStore().get("ord_outside"))?.status).toBe("completed");
  });

  it("重复退款（幂等）→ 200 alreadyRefunded，不再变更 refundedAt", async () => {
    await seedOrder({
      status: "refunded",
      refundedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await callRefund({ token: tokenFor() });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      alreadyRefunded: boolean;
      refundedAt: string;
    };
    expect(body.ok).toBe(true);
    expect(body.alreadyRefunded).toBe(true);
    expect(body.refundedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(isMagicLinkRevoked("ord_1001")).toBe(true);
  });
});

describe("POST /api/refund — 失败路径", () => {
  it("缺 token / token 非法 / token 过期 → 401", async () => {
    await seedOrder();

    const missing = await callRefund({});
    expect(missing.status).toBe(401);

    const invalid = await callRefund({ token: "garbage" });
    expect(invalid.status).toBe(401);
    const invalidBody = (await invalid.json()) as { error: string; reason: string };
    expect(invalidBody.error).toBe("invalid magic link");
    expect(invalidBody.reason).toBe("malformed");

    const expiredToken = issueMagicLinkToken("ord_1001", {
      now: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const expired = await callRefund({ token: expiredToken });
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as { reason: string }).reason).toBe("expired");

    expect((await getOrderStore().get("ord_1001"))?.status).toBe("completed");
  });

  it("未知订单 → 404", async () => {
    const res = await callRefund({ token: tokenFor("ord_missing") });
    expect(res.status).toBe(404);
  });

  it("pending 未付款订单 → 422，不退款", async () => {
    await seedOrder({ status: "pending" });
    const res = await callRefund({ token: tokenFor() });
    expect(res.status).toBe(422);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("pending");
  });

  it("已删除订单 → 409", async () => {
    await seedOrder({ status: "deleted", deletedAt: new Date().toISOString() });
    const res = await callRefund({ token: tokenFor() });
    expect(res.status).toBe(409);
  });

  it("请求体不是合法 JSON → 400", async () => {
    const res = await refundPOST(makeJsonRequest("/api/refund", "{oops"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/refund — Lemon Squeezy provider（注入 fetch）", () => {
  function configureLiveKey(): void {
    process.env.LEMON_SQUEEZY_API_KEY = "test_api_key";
  }

  it("有 API key → POST /v1/orders/{id}/refund，JSON:API header + Bearer + JSON:API body", async () => {
    configureLiveKey();
    await seedOrder();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { type: "orders", id: "ord_1001", attributes: {} } }),
        { status: 200, headers: { "Content-Type": "application/vnd.api+json" } }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await callRefund({ token: tokenFor() });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mode: string };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("lemon-squeezy");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.lemonsqueezy.com/v1/orders/ord_1001/refund"
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test_api_key");
    expect(headers.Accept).toBe("application/vnd.api+json");
    expect(headers["Content-Type"]).toBe("application/vnd.api+json");
    expect(JSON.parse(String(init.body))).toEqual(
      buildRefundRequestBody("ord_1001", 1499)
    );

    expect((await getOrderStore().get("ord_1001"))?.status).toBe("refunded");
  });

  it("provider HTTP 失败 → 502，本地状态不变、token 不吊销（可重试）", async () => {
    configureLiveKey();
    await seedOrder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    const res = await callRefund({ token: tokenFor() });

    expect(res.status).toBe(502);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("completed");
    expect(isMagicLinkRevoked("ord_1001")).toBe(false);
  });

  it("provider 返回 404 → 404", async () => {
    configureLiveKey();
    await seedOrder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 }))
    );

    const res = await callRefund({ token: tokenFor() });
    expect(res.status).toBe(404);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("completed");
  });
});

describe("orders 状态机（completed → refunded → deleted，终态不回退）", () => {
  it("refundOrder：completed→refunded，重复幂等，deleted 不可退", async () => {
    await seedOrder();

    const first = await refundOrder("ord_1001", "2026-02-01T00:00:00.000Z");
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.changed).toBe(true);
      expect(first.order.status).toBe("refunded");
      expect(first.order.refundedAt).toBe("2026-02-01T00:00:00.000Z");
    }

    const second = await refundOrder("ord_1001", "2026-02-02T00:00:00.000Z");
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.changed).toBe(false);
      expect(second.order.refundedAt).toBe("2026-02-01T00:00:00.000Z");
    }

    const deleted = await deleteOrderAnalysis(
      "ord_1001",
      "2026-02-03T00:00:00.000Z"
    );
    expect(deleted.ok).toBe(true);

    const refundAfterDelete = await refundOrder("ord_1001");
    expect(refundAfterDelete).toEqual({
      ok: false,
      reason: "invalid-transition",
    });
  });

  it("deleteOrderAnalysis：清空 PII/custom，重复删除幂等", async () => {
    await seedOrder();

    const first = await deleteOrderAnalysis(
      "ord_1001",
      "2026-03-01T00:00:00.000Z"
    );
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.order.status).toBe("deleted");
      expect(first.order.email).toBe("");
      expect(first.order.variantId).toBe("");
      expect(first.order.custom).toEqual({});
      expect(first.order.deletedAt).toBe("2026-03-01T00:00:00.000Z");
      expect(first.order.createdAt).toBeTruthy();
    }

    const second = await deleteOrderAnalysis("ord_1001");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.changed).toBe(false);
  });

  it("未知订单：refundOrder / deleteOrderAnalysis → not-found；isAccessRevoked → false", async () => {
    expect(await refundOrder("ord_missing")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await deleteOrderAnalysis("ord_missing")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await isAccessRevoked("ord_missing")).toBe(false);
  });

  it("mergeOrderStatus 不回退：refunded/deleted/canceled 不会被旧事件改回 completed", () => {
    expect(mergeOrderStatus("completed", "refunded")).toBe("refunded");
    expect(mergeOrderStatus("refunded", "completed")).toBe("refunded");
    expect(mergeOrderStatus("refunded", "deleted")).toBe("deleted");
    expect(mergeOrderStatus("deleted", "completed")).toBe("deleted");
    expect(mergeOrderStatus("deleted", "refunded")).toBe("deleted");
    expect(mergeOrderStatus("completed", "deleted")).toBe("deleted");
    expect(mergeOrderStatus("canceled", "completed")).toBe("canceled");
    expect(mergeOrderStatus("completed", "canceled")).toBe("canceled");
    expect(mergeOrderStatus("pending", "completed")).toBe("completed");
    expect(mergeOrderStatus("completed", "pending")).toBe("completed");
  });

  it("deleted 后 webhook 重放不能把 PII/状态写回来", async () => {
    const original = await seedOrder();
    await deleteOrderAnalysis("ord_1001");

    const replayed = await getOrderStore().upsert(original);

    expect(replayed.created).toBe(false);
    expect(replayed.changed).toBe(false);
    expect(replayed.order.status).toBe("deleted");
    expect(replayed.order.email).toBe("");
    expect(replayed.order.custom).toEqual({});
  });

  it("isAccessRevoked：completed/pending false；refunded/canceled/deleted true", async () => {
    await seedOrder({ orderId: "ord_completed", status: "completed" });
    await seedOrder({ orderId: "ord_pending", status: "pending" });
    await seedOrder({ orderId: "ord_refunded", status: "refunded" });
    await seedOrder({ orderId: "ord_canceled", status: "canceled" });
    await seedOrder({ orderId: "ord_deleted", status: "deleted" });

    expect(await isAccessRevoked("ord_completed")).toBe(false);
    expect(await isAccessRevoked("ord_pending")).toBe(false);
    expect(await isAccessRevoked("ord_refunded")).toBe(true);
    expect(await isAccessRevoked("ord_canceled")).toBe(true);
    expect(await isAccessRevoked("ord_deleted")).toBe(true);
  });
});

describe("refund.ts — provider 与纯函数", () => {
  it("isWithinRefundWindow：窗口内 true、超期 false、缺失/非法 false", () => {
    const now = new Date("2026-06-10T00:00:00.000Z");
    const completed = new Date(now.getTime() - REFUND_WINDOW_MS + 1000);
    expect(isWithinRefundWindow(completed.toISOString(), now)).toBe(true);
    expect(
      isWithinRefundWindow(
        new Date(now.getTime() - REFUND_WINDOW_MS - 1000).toISOString(),
        now
      )
    ).toBe(false);
    expect(isWithinRefundWindow(undefined, now)).toBe(false);
    expect(isWithinRefundWindow("not-a-date", now)).toBe(false);
  });

  it("buildRefundRequestBody：JSON:API 形状 + amount 取整", () => {
    expect(buildRefundRequestBody("ord_1", 1499)).toEqual({
      data: { type: "orders", id: "ord_1", attributes: { amount: 1499 } },
    });
    expect(buildRefundRequestBody("ord_1")).toEqual({
      data: { type: "orders", id: "ord_1", attributes: {} },
    });
    expect(
      buildRefundRequestBody("ord_1", 1499.6).data.attributes.amount
    ).toBe(1500);
  });

  it("getRefundProvider：无 key → Noop(local)，有 key → LemonSqueezy", () => {
    expect(getRefundProvider({})).toBeInstanceOf(NoopRefundProvider);
    expect(getRefundProvider({ LEMON_SQUEEZY_API_KEY: "k" })).toBeInstanceOf(
      LemonSqueezyRefundProvider
    );
  });

  it("NoopRefundProvider 不发起网络请求", async () => {
    const result = await new NoopRefundProvider().refund();
    expect(result).toEqual({ ok: true, mode: "local" });
  });

  it("LemonSqueezyRefundProvider 可注入 fetchImpl 并解析成功/异常", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const okFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: { id: "ord_1" } }), {
        status: 200,
      });
    });
    const provider = new LemonSqueezyRefundProvider(
      "k",
      okFetch as unknown as typeof fetch
    );
    await expect(provider.refund({ orderId: "ord_1", amountCents: 100 })).resolves.toEqual({
      ok: true,
      mode: "lemon-squeezy",
      providerRefundId: "ord_1",
    });
    expect(calls[0]?.url).toBe(
      "https://api.lemonsqueezy.com/v1/orders/ord_1/refund"
    );

    const failFetch = vi.fn(async () => new Response("bad", { status: 400 }));
    const failProvider = new LemonSqueezyRefundProvider(
      "k",
      failFetch as unknown as typeof fetch
    );
    const failResult = await failProvider.refund({ orderId: "ord_1" });
    expect(failResult.ok).toBe(false);
    if (!failResult.ok) expect(failResult.httpStatus).toBe(400);

    const throwFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const throwProvider = new LemonSqueezyRefundProvider(
      "k",
      throwFetch as unknown as typeof fetch
    );
    const throwResult = await throwProvider.refund({ orderId: "ord_1" });
    expect(throwResult.ok).toBe(false);
    if (!throwResult.ok) expect(throwResult.error).toMatch(/network down/);
  });
});
