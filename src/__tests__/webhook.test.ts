import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhook/lemonsqueezy/route";
import { getOrderStore, resetOrderStore } from "@/lib/orders";

/**
 * webhook 单测（全部离线）
 *
 * 覆盖：
 * - 官方验签口径：X-Signature = HMAC-SHA256 hex(raw body)，通过 → 200 + 落库
 * - 验签失败 / 缺签名 / 被篡改 body → 401，且不落库
 * - secret 未配置 → 500（fail closed）
 * - 非法 JSON（签名正确）→ 400
 * - 幂等：同一事件重复投递 → 200 且不新增记录；退款终态不被旧事件覆盖
 * - 非订单事件 → 200 ignored（不落库）
 */

const SECRET = "whsec_test_secret";
const ORIGINAL_SECRET = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

function sign(raw: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

type MakeRequestOptions = {
  /** undefined = 按默认 secret 自动签名；null = 不带签名头 */
  signature?: string | null;
  eventName?: string;
  secret?: string;
};

function makeRequest(raw: string, options: MakeRequestOptions = {}): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const signature =
    options.signature === undefined
      ? sign(raw, options.secret ?? SECRET)
      : options.signature;
  if (signature) headers["x-signature"] = signature;
  if (options.eventName) headers["x-event-name"] = options.eventName;

  return new NextRequest("http://localhost/api/webhook/lemonsqueezy", {
    method: "POST",
    headers,
    body: raw,
  });
}

function orderCreatedPayload(): string {
  return JSON.stringify({
    meta: {
      event_name: "order_created",
      test_mode: false,
      custom_data: {
        fileName: "chat.txt",
        speakerA: "Alex",
        speakerB: "Sam",
      },
    },
    data: {
      type: "orders",
      id: "ord_1001",
      attributes: {
        store_id: 1,
        status: "paid",
        user_email: "buyer@example.com",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:05.000Z",
        first_order_item: { variant_id: 456 },
      },
    },
  });
}

function orderRefundedPayload(): string {
  return JSON.stringify({
    meta: { event_name: "order_refunded" },
    data: {
      type: "orders",
      id: "ord_1001",
      attributes: {
        status: "refunded",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    },
  });
}

beforeEach(() => {
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = SECRET;
  resetOrderStore();
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  } else {
    process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = ORIGINAL_SECRET;
  }
});

describe("POST /api/webhook/lemonsqueezy — 验签", () => {
  it("X-Signature 正确时 200 并落库订单", async () => {
    const raw = orderCreatedPayload();
    const res = await POST(makeRequest(raw));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      created: boolean;
      status: string;
      orderId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.orderId).toBe("ord_1001");
    expect(body.status).toBe("completed");

    const stored = await getOrderStore().get("ord_1001");
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("completed");
    expect(stored?.email).toBe("buyer@example.com");
    expect(stored?.variantId).toBe("456");
    expect(stored?.custom).toEqual({
      fileName: "chat.txt",
      speakerA: "Alex",
      speakerB: "Sam",
    });
    expect(stored?.testMode).toBe(false);
  });

  it("事件名可来自 X-Event-Name header（新版 LS 投递方式）", async () => {
    const raw = orderRefundedPayload();
    const res = await POST(
      makeRequest(raw, { eventName: "order_refunded", signature: sign(raw) })
    );

    expect(res.status).toBe(200);
    const stored = await getOrderStore().get("ord_1001");
    expect(stored?.status).toBe("refunded");
  });

  it("签名错误 → 401，且不落库", async () => {
    const raw = orderCreatedPayload();
    const res = await POST(makeRequest(raw, { signature: sign(raw, "wrong_secret") }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid signature" });
    expect(await getOrderStore().list()).toHaveLength(0);
  });

  it("签名正确但 body 被篡改 → 401", async () => {
    const signedRaw = orderCreatedPayload();
    const tamperedRaw = signedRaw.replace("buyer@example.com", "attacker@example.com");
    const res = await POST(makeRequest(tamperedRaw, { signature: sign(signedRaw) }));

    expect(res.status).toBe(401);
    expect(await getOrderStore().list()).toHaveLength(0);
  });

  it("缺少 X-Signature → 401", async () => {
    const res = await POST(makeRequest(orderCreatedPayload(), { signature: null }));

    expect(res.status).toBe(401);
    expect(await getOrderStore().list()).toHaveLength(0);
  });

  it("webhook secret 未配置 → 500（fail closed，不放行未验签请求）", async () => {
    delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    const raw = orderCreatedPayload();
    const res = await POST(makeRequest(raw));

    expect(res.status).toBe(500);
    expect(await getOrderStore().list()).toHaveLength(0);
  });

  it("验签通过但 JSON 非法 → 400", async () => {
    const raw = "{not-json";
    const res = await POST(makeRequest(raw, { signature: sign(raw) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });
});

describe("POST /api/webhook/lemonsqueezy — 幂等", () => {
  it("同一事件重复投递：第二次返回 200 且 created=false、不新增记录", async () => {
    const raw = orderCreatedPayload();

    const first = await POST(makeRequest(raw));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { created: boolean }).created).toBe(true);

    const second = await POST(makeRequest(raw));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      created: boolean;
      idempotent: boolean;
    };
    expect(secondBody.created).toBe(false);
    expect(secondBody.idempotent).toBe(true);

    const orders = await getOrderStore().list();
    expect(orders).toHaveLength(1);
  });

  it("completed → refunded 可更新；重复 refunded 事件保持幂等且不回退终态", async () => {
    const createdRaw = orderCreatedPayload();
    const refundedRaw = orderRefundedPayload();

    await POST(makeRequest(createdRaw));
    const refundRes = await POST(makeRequest(refundedRaw));
    expect(refundRes.status).toBe(200);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("refunded");

    // 重复退款事件：幂等
    const duplicateRefund = await POST(makeRequest(refundedRaw));
    expect(duplicateRefund.status).toBe(200);
    const duplicateBody = (await duplicateRefund.json()) as { idempotent: boolean };
    expect(duplicateBody.idempotent).toBe(true);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("refunded");

    // 迟到的 order_created（LS 重试乱序）：不能把已退款订单改回 completed
    const lateCreated = await POST(makeRequest(createdRaw));
    expect(lateCreated.status).toBe(200);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("refunded");
  });
});

describe("POST /api/webhook/lemonsqueezy — 非订单事件", () => {
  it("subscription_created 等事件 → 200 ignored，不落库", async () => {
    const raw = JSON.stringify({
      meta: { event_name: "subscription_created" },
      data: { type: "subscriptions", id: "sub_1", attributes: {} },
    });
    const res = await POST(makeRequest(raw, { eventName: "subscription_created" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored: boolean };
    expect(body.ignored).toBe(true);
    expect(await getOrderStore().list()).toHaveLength(0);
  });
});
