import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as orderStatusGET } from "@/app/api/order-status/route";
import { POST as webhookPOST } from "@/app/api/webhook/lemonsqueezy/route";
import {
  buildCheckoutBody,
  createCheckout,
  generateClientRef,
  type CheckoutRequest,
} from "@/lib/checkout";
import {
  findOrderByClientRef,
  getOrderClientRef,
  getOrderStore,
  parseLemonOrderEvent,
  resetOrderStore,
  type OrderRecord,
} from "@/lib/orders";
import {
  REPORT_UPLOAD_TOKEN_TTL_SECONDS,
  resetReportStore,
  verifyReportUploadToken,
} from "@/lib/report-store";

/**
 * /api/order-status + clientRef 链路单测（W3-2）
 *
 * 覆盖：
 * - GET /api/order-status：缺 ref 400 / 未知 404；pending → ready:false 无 token；
 *   completed → ready:true + 24h scope=report-upload token（可验证 orderId）；
 *   refunded/canceled/deleted → ready:false 无 token
 * - clientRef 契约：generateClientRef 格式；buildCheckoutBody 写入 custom.client_ref；
 *   createCheckout live 透传到 LS JSON:API body；webhook meta.custom_data.client_ref
 *   落 OrderRecord.clientRef；findOrderByClientRef 命中（含 file 回读后只剩 custom 的兜底）
 * - 端到端：webhook 落单 → order-status?ref= 拿到 uploadToken → 可验签
 */

const MAGIC_SECRET = "order_status_test_secret";
const WEBHOOK_SECRET = "whsec_order_status_test";
const ORIGINAL_ENV: Record<string, string | undefined> = {
  MAGIC_LINK_SECRET: process.env.MAGIC_LINK_SECRET,
  REPORT_UPLOAD_SECRET: process.env.REPORT_UPLOAD_SECRET,
  REPORT_DATA_DIR: process.env.REPORT_DATA_DIR,
  ORDERS_DATA_DIR: process.env.ORDERS_DATA_DIR,
  LEMON_SQUEEZY_WEBHOOK_SECRET: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
  LEMON_SQUEEZY_API_KEY: process.env.LEMON_SQUEEZY_API_KEY,
  LEMON_SQUEEZY_STORE_ID: process.env.LEMON_SQUEEZY_STORE_ID,
  LEMON_SQUEEZY_VARIANT_ID: process.env.LEMON_SQUEEZY_VARIANT_ID,
  LEMON_SQUEEZY_LIVE: process.env.LEMON_SQUEEZY_LIVE,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function baseOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: "ord_1001",
    variantId: "456",
    email: "buyer@example.com",
    status: "completed",
    custom: { fileName: "chat.txt", client_ref: "tell_ref1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:05.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    lastEventName: "order_created",
    testMode: false,
    clientRef: "tell_ref1",
    ...overrides,
  };
}

async function seedOrder(overrides: Partial<OrderRecord> = {}): Promise<void> {
  await getOrderStore().upsert(baseOrder(overrides));
}

async function getStatus(ref: string) {
  return orderStatusGET(
    new NextRequest(
      `http://localhost/api/order-status?ref=${encodeURIComponent(ref)}`
    )
  );
}

beforeEach(() => {
  process.env.MAGIC_LINK_SECRET = MAGIC_SECRET;
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.REPORT_UPLOAD_SECRET;
  delete process.env.REPORT_DATA_DIR;
  delete process.env.ORDERS_DATA_DIR;
  delete process.env.LEMON_SQUEEZY_API_KEY;
  delete process.env.LEMON_SQUEEZY_STORE_ID;
  delete process.env.LEMON_SQUEEZY_VARIANT_ID;
  delete process.env.LEMON_SQUEEZY_LIVE;
  resetOrderStore();
  resetReportStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetOrderStore();
  resetReportStore();
  restoreEnv();
});

describe("GET /api/order-status", () => {
  it("缺 ref → 400；未知 ref → 404", async () => {
    const missing = await orderStatusGET(
      new NextRequest("http://localhost/api/order-status")
    );
    expect(missing.status).toBe(400);

    expect((await getStatus("tell_unknown")).status).toBe(404);
  });

  it("pending 订单 → { status:'pending', ready:false }，无 uploadToken", async () => {
    await seedOrder({ status: "pending" });

    const res = await getStatus("tell_ref1");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "pending", ready: false });
    expect("uploadToken" in body).toBe(false);
  });

  it("completed 订单 → ready:true + 24h scope=report-upload token", async () => {
    await seedOrder();

    const res = await getStatus("tell_ref1");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      ready: boolean;
      uploadToken: string;
    };
    expect(Object.keys(body).sort()).toEqual(
      ["ready", "status", "uploadToken"].sort()
    );
    expect(body.status).toBe("completed");
    expect(body.ready).toBe(true);

    const verified = verifyReportUploadToken(body.uploadToken);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.orderId).toBe("ord_1001");
    expect(verified.payload.exp - verified.payload.iat).toBe(
      REPORT_UPLOAD_TOKEN_TTL_SECONDS
    );
  });

  it("refunded / canceled / deleted → ready:false，无 token", async () => {
    for (const status of ["refunded", "canceled", "deleted"] as const) {
      resetOrderStore();
      await seedOrder({ status });
      const res = await getStatus("tell_ref1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ status, ready: false });
    }
  });

  it("clientRef 只在 custom 里（文件存储回读场景）也能命中", async () => {
    // 模拟 FileOrderStore load 后顶层 clientRef 丢失、只剩 custom.client_ref
    await getOrderStore().upsert(
      baseOrder({ clientRef: undefined, custom: { client_ref: "tell_from_custom" } })
    );

    const res = await getStatus("tell_from_custom");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ready: boolean };
    expect(body.ready).toBe(true);
  });
});

describe("clientRef 链路", () => {
  it("generateClientRef：tell_ + 16 位小写 base36，且两次不同", () => {
    const first = generateClientRef();
    const second = generateClientRef();
    expect(first).toMatch(/^tell_[a-z0-9]{16}$/);
    expect(first).not.toBe(second);
  });

  it("buildCheckoutBody：有 clientRef 时写入 custom.client_ref，没有时不写", () => {
    const request: CheckoutRequest = {
      fileName: "chat.txt",
      speakerA: "Alex",
      speakerB: "Sam",
    };

    const withRef = buildCheckoutBody(request, {
      storeId: "1",
      variantId: "2",
      redirectUrl: "https://x/report",
      clientRef: "tell_abc",
    });
    expect(
      withRef.data.attributes.checkout_data.custom.client_ref
    ).toBe("tell_abc");

    const withoutRef = buildCheckoutBody(request, {
      storeId: "1",
      variantId: "2",
      redirectUrl: "https://x/report",
    });
    expect(
      "client_ref" in withoutRef.data.attributes.checkout_data.custom
    ).toBe(false);
  });

  it("createCheckout live：clientRef 透传进 Lemon Squeezy JSON:API body", async () => {
    process.env.LEMON_SQUEEZY_API_KEY = "test_key";
    process.env.LEMON_SQUEEZY_STORE_ID = "store_1";
    process.env.LEMON_SQUEEZY_VARIANT_ID = "variant_1";
    process.env.LEMON_SQUEEZY_LIVE = "true";

    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            type: "checkouts",
            id: "chk_1",
            attributes: { url: "https://store.lemonsqueezy.com/buy/x" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/vnd.api+json" } }
      )
    );

    const result = await createCheckout(
      {
        fileName: "chat.txt",
        speakerA: "Alex",
        speakerB: "Sam",
        clientRef: "tell_live_ref",
      },
      "https://thetell.app",
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result.mock).toBe(false);
    expect("clientRef" in result).toBe(false); // 旧返回结构不变

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as {
      data: {
        attributes: {
          checkout_data: { custom: Record<string, string> };
        };
      };
    };
    expect(body.data.attributes.checkout_data.custom.client_ref).toBe(
      "tell_live_ref"
    );
  });

  it("parseLemonOrderEvent：meta.custom_data.client_ref → OrderRecord.clientRef", async () => {
    const raw = JSON.stringify({
      meta: {
        event_name: "order_created",
        custom_data: { client_ref: "tell_parsed", fileName: "chat.txt" },
      },
      data: {
        type: "orders",
        id: "ord_parsed",
        attributes: {
          status: "paid",
          user_email: "buyer@example.com",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:05.000Z",
        },
      },
    });
    const parsed = parseLemonOrderEvent(JSON.parse(raw));
    expect(parsed.order?.clientRef).toBe("tell_parsed");
    if (!parsed.order) return;

    await getOrderStore().upsert(parsed.order);
    const found = await findOrderByClientRef("tell_parsed");
    expect(found?.orderId).toBe("ord_parsed");
  });

  it("getOrderClientRef 兜底：顶层缺失时读 custom.client_ref", () => {
    const order = baseOrder({ clientRef: undefined, custom: { client_ref: "tell_fallback" } });
    expect(getOrderClientRef(order)).toBe("tell_fallback");
    expect(getOrderClientRef(null)).toBe("");
  });

  it("端到端：webhook 落单（带 client_ref）→ order-status?ref= 拿 token", async () => {
    const raw = JSON.stringify({
      meta: {
        event_name: "order_created",
        test_mode: false,
        custom_data: { client_ref: "tell_e2e", fileName: "chat.txt" },
      },
      data: {
        type: "orders",
        id: "ord_e2e",
        attributes: {
          status: "paid",
          user_email: "buyer@example.com",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:05.000Z",
          first_order_item: { variant_id: 456 },
        },
      },
    });
    const signature = createHmac("sha256", WEBHOOK_SECRET)
      .update(raw, "utf8")
      .digest("hex");

    const webhookRes = await webhookPOST(
      new NextRequest("http://localhost/api/webhook/lemonsqueezy", {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": signature },
        body: raw,
      })
    );
    expect(webhookRes.status).toBe(200);

    const stored = await getOrderStore().get("ord_e2e");
    expect(stored?.clientRef).toBe("tell_e2e");

    const statusRes = await getStatus("tell_e2e");
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as {
      status: string;
      ready: boolean;
      uploadToken: string;
    };
    expect(body.status).toBe("completed");
    expect(body.ready).toBe(true);
    const verified = verifyReportUploadToken(body.uploadToken);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload.orderId).toBe("ord_e2e");
  });
});
