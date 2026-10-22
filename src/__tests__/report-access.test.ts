import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhook/lemonsqueezy/route";
import {
  sendMagicLinkForOrder,
  setEmailProviderOverride,
  type EmailMessage,
  type EmailProvider,
} from "@/lib/email";
import { verifyMagicLinkToken } from "@/lib/magic-link";
import { getOrderStore, resetOrderStore } from "@/lib/orders";
import {
  decideInitialAccess,
  detectLiveMode,
  extractVerifiedOrder,
  interpretVerifyResponse,
} from "@/lib/report-access";

/**
 * 报告访问门 + webhook 邮件触发 单测（全离线，不发真实请求）
 *
 * A. decideInitialAccess：live/mock × 有效/无效凭证 × PENDING
 *    —— 关键断言：live 模式下任何缺凭证情况都**不能**得到 show-report（即不能渲染 DEMO_REPORT）
 * B. interpretVerifyResponse：verify API 状态码 → 报告/等待/无效
 * C. extractVerifiedOrder：从 verify 响应提取 custom
 * D. sendMagicLinkForOrder：可注入依赖、跳过条件、错误不抛
 * E. webhook：首次落库发 magic link、重复投递不重发、未完成/无邮箱不发
 */

/* ===== A. 模式判定 ===== */

describe("detectLiveMode", () => {
  it.each([
    [{ NEXT_PUBLIC_LEMON_SQUEEZY_LIVE: "true" }, true],
    [{ NEXT_PUBLIC_LEMON_SQUEEZY_LIVE: " TRUE " }, true],
    [{ LEMON_SQUEEZY_LIVE: "true" }, true],
    [{ LEMON_SQUEEZY_LIVE: "false" }, false],
    [{ LEMON_SQUEEZY_LIVE: "1" }, false],
    [{}, false],
    [{ NEXT_PUBLIC_LEMON_SQUEEZY_LIVE: "" }, false],
  ])("env %j → %s", (env, expected) => {
    expect(detectLiveMode(env)).toBe(expected);
  });
});

/* ===== B. 初始访问决策 ===== */

describe("decideInitialAccess — live 模式绝不渲染演示报告", () => {
  it("无任何凭证 → 等待态（missing-credential），不是 show-report", () => {
    const decision = decideInitialAccess({ mode: "live", token: null, checkout: null, orderId: null, preview: null });
    expect(decision).toEqual({ kind: "show-waiting", reason: "missing-credential" });
  });

  it("?checkout=PENDING → 等待态（payment-pending）", () => {
    const decision = decideInitialAccess({ mode: "live", checkout: "PENDING" });
    expect(decision).toEqual({ kind: "show-waiting", reason: "payment-pending" });
  });

  it("live 模式下 MOCK- 演示订单号 → 无效态（不能拿 demo id 看报告）", () => {
    const decision = decideInitialAccess({ mode: "live", checkout: "MOCK-ABC123" });
    expect(decision.kind).toBe("show-invalid");
  });

  it("live 模式下裸 preview 参数不能绕过访问门", () => {
    const decision = decideInitialAccess({ mode: "live", preview: "eyJmaWxlTmFtZSI6IngifQ" });
    expect(decision).toEqual({ kind: "show-waiting", reason: "missing-credential" });
  });

  it("有效 token → 先验 token", () => {
    const decision = decideInitialAccess({ mode: "live", token: "v1.payload.sig" });
    expect(decision).toEqual({ kind: "verify-token", token: "v1.payload.sig" });
  });

  it("?order_id → 先验订单", () => {
    const decision = decideInitialAccess({ mode: "live", orderId: "ord_1001" });
    expect(decision).toEqual({ kind: "verify-order", orderId: "ord_1001" });
  });

  it("?checkout=<真实订单号>（LS 若带回）→ 先验订单", () => {
    const decision = decideInitialAccess({ mode: "live", checkout: "ord_2002" });
    expect(decision).toEqual({ kind: "verify-order", orderId: "ord_2002" });
  });

  it("空白 token 视为没有", () => {
    const decision = decideInitialAccess({ mode: "live", token: "   " });
    expect(decision).toEqual({ kind: "show-waiting", reason: "missing-credential" });
  });
});

describe("decideInitialAccess — mock 模式保持演示体验", () => {
  it("裸访问 → 直接展示演示报告", () => {
    expect(decideInitialAccess({ mode: "mock" })).toEqual({
      kind: "show-report",
      source: "mock",
    });
  });

  it("MOCK- 订单号 → 演示报告", () => {
    expect(decideInitialAccess({ mode: "mock", checkout: "MOCK-ABC123" })).toEqual({
      kind: "show-report",
      source: "mock",
    });
  });

  it("preview 参数 → 演示报告", () => {
    expect(
      decideInitialAccess({ mode: "mock", preview: "eyJmaWxlTmFtZSI6IngifQ" })
    ).toEqual({ kind: "show-report", source: "mock" });
  });

  it("PENDING 仍然等待（mock 流不会产生 PENDING，出现即按 live 回跳处理）", () => {
    expect(decideInitialAccess({ mode: "mock", checkout: "PENDING" })).toEqual({
      kind: "show-waiting",
      reason: "payment-pending",
    });
  });

  it("token 优先于 mock 演示", () => {
    expect(decideInitialAccess({ mode: "mock", token: "v1.payload.sig" })).toEqual({
      kind: "verify-token",
      token: "v1.payload.sig",
    });
  });
});

/* ===== C. verify 响应翻译 ===== */

describe("interpretVerifyResponse", () => {
  it("200 + ok:true → 展示报告（source 透传）", () => {
    expect(
      interpretVerifyResponse(200, { ok: true, order: { orderId: "ord_1" } }, "token")
    ).toEqual({ kind: "show-report", source: "token" });
    expect(interpretVerifyResponse(200, { ok: true }, "order")).toEqual({
      kind: "show-report",
      source: "order",
    });
  });

  it("202 pending → 等待态", () => {
    expect(interpretVerifyResponse(202, { ok: false, reason: "pending" })).toEqual({
      kind: "show-waiting",
      reason: "payment-pending",
    });
  });

  it("401 + reason=expired → 链接过期", () => {
    expect(
      interpretVerifyResponse(401, { ok: false, reason: "expired", error: "magic link expired" })
    ).toMatchObject({ kind: "show-invalid", reason: "expired" });
  });

  it("401 签名/格式错误 → 链接无效", () => {
    expect(
      interpretVerifyResponse(401, { ok: false, reason: "invalid_signature" })
    ).toMatchObject({ kind: "show-invalid", reason: "invalid" });
  });

  it("403 退款/取消 → revoked", () => {
    expect(interpretVerifyResponse(403, { ok: false, error: "revoked" })).toMatchObject({
      kind: "show-invalid",
      reason: "revoked",
    });
  });

  it("404 订单不存在 → not-found", () => {
    expect(interpretVerifyResponse(404, { ok: false })).toMatchObject({
      kind: "show-invalid",
      reason: "not-found",
    });
  });

  it("500 / 形状异常 → error，绝不 show-report", () => {
    expect(interpretVerifyResponse(500, null)).toMatchObject({
      kind: "show-invalid",
      reason: "error",
    });
    expect(interpretVerifyResponse(200, { ok: false })).toMatchObject({
      kind: "show-invalid",
      reason: "error",
    });
    expect(interpretVerifyResponse(200, "garbage")).toMatchObject({
      kind: "show-invalid",
      reason: "error",
    });
  });
});

/* ===== D. extractVerifiedOrder ===== */

describe("extractVerifiedOrder", () => {
  it("提取 orderId / status / custom", () => {
    const view = extractVerifiedOrder({
      ok: true,
      order: {
        orderId: "ord_1001",
        status: "completed",
        custom: { fileName: "chat.txt", speakerA: "Alex" },
      },
    });
    expect(view).toEqual({
      orderId: "ord_1001",
      status: "completed",
      custom: { fileName: "chat.txt", speakerA: "Alex" },
    });
  });

  it("缺 order / 缺 orderId / custom 非对象 → null 或空对象", () => {
    expect(extractVerifiedOrder(null)).toBeNull();
    expect(extractVerifiedOrder({ ok: true })).toBeNull();
    expect(extractVerifiedOrder({ ok: true, order: { status: "completed" } })).toBeNull();
    expect(
      extractVerifiedOrder({ ok: true, order: { orderId: "ord_1", custom: "nope" } })
    ).toEqual({ orderId: "ord_1", status: "", custom: {} });
  });
});

/* ===== E. sendMagicLinkForOrder（依赖注入） ===== */

function createProviderSpy() {
  const send = vi.fn<EmailProvider["send"]>(async () => ({
    ok: true,
    provider: "spy",
  }));
  const provider: EmailProvider = { name: "spy", enabled: true, send };
  return { provider, send };
}

describe("sendMagicLinkForOrder", () => {
  it("已完成订单 + 注入 issue/build/provider → 发一封带魔法链的邮件", async () => {
    const { provider, send } = createProviderSpy();

    const result = await sendMagicLinkForOrder(
      { orderId: "ord_1001", email: "buyer@example.com", status: "completed" },
      {
        provider,
        issueToken: (orderId) => `token_for_${orderId}`,
        buildLink: (token) => `https://thetell.app/report?token=${token}`,
      }
    );

    expect(result).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0] as EmailMessage;
    expect(message.to).toBe("buyer@example.com");
    expect(message.subject).toMatch(/magic link/i);
    expect(message.html).toContain(
      "https://thetell.app/report?token=token_for_ord_1001"
    );
  });

  it("没有邮箱 → 跳过且不发", async () => {
    const { provider, send } = createProviderSpy();
    const result = await sendMagicLinkForOrder(
      { orderId: "ord_1", email: "", status: "completed" },
      { provider }
    );
    expect(result).toEqual({ sent: false, skipped: "no-email" });
    expect(send).not.toHaveBeenCalled();
  });

  it("订单未完成 → 跳过且不发", async () => {
    const { provider, send } = createProviderSpy();
    const result = await sendMagicLinkForOrder(
      { orderId: "ord_1", email: "buyer@example.com", status: "pending" },
      { provider }
    );
    expect(result).toEqual({ sent: false, skipped: "not-completed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("provider 失败 → 返回 error，不抛出", async () => {
    const failing: EmailProvider = {
      name: "failing",
      enabled: true,
      send: async () => ({ ok: false, provider: "failing", error: "boom" }),
    };
    const result = await sendMagicLinkForOrder(
      { orderId: "ord_1", email: "buyer@example.com", status: "completed" },
      {
        provider: failing,
        issueToken: () => "tok",
        buildLink: () => "https://x/report?token=tok",
      }
    );
    expect(result).toEqual({ sent: false, error: "boom" });
  });

  it("token 签发抛错 → 返回 error，不抛出", async () => {
    const { provider } = createProviderSpy();
    const result = await sendMagicLinkForOrder(
      { orderId: "ord_1", email: "buyer@example.com", status: "completed" },
      {
        provider,
        issueToken: () => {
          throw new Error("no secret");
        },
      }
    );
    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/no secret/);
  });
});

/* ===== F. webhook 首次落库发信 + 幂等 ===== */

const WEBHOOK_SECRET = "whsec_test_secret";
const MAGIC_SECRET = "magic_test_secret";
const ORIGINAL_ENV: Record<string, string | undefined> = {
  LEMON_SQUEEZY_WEBHOOK_SECRET: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
  MAGIC_LINK_SECRET: process.env.MAGIC_LINK_SECRET,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function sign(raw: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(raw, "utf8").digest("hex");
}

function makeWebhookRequest(raw: string): NextRequest {
  return new NextRequest("http://localhost/api/webhook/lemonsqueezy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": sign(raw),
    },
    body: raw,
  });
}

function orderCreatedPayload(overrides: {
  status?: string;
  email?: string;
  orderId?: string;
} = {}): string {
  const attributes: Record<string, unknown> = {
    status: overrides.status ?? "paid",
    first_order_item: { variant_id: 456 },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:05.000Z",
  };
  const email = overrides.email ?? "buyer@example.com";
  if (email) attributes.user_email = email;

  return JSON.stringify({
    meta: {
      event_name: "order_created",
      test_mode: false,
      custom_data: { fileName: "chat.txt", speakerA: "Alex", speakerB: "Sam" },
    },
    data: {
      type: "orders",
      id: overrides.orderId ?? "ord_1001",
      attributes,
    },
  });
}

function refundPayload(): string {
  return JSON.stringify({
    meta: { event_name: "order_refunded" },
    data: {
      type: "orders",
      id: "ord_1001",
      attributes: { status: "refunded", updated_at: "2026-01-02T00:00:00.000Z" },
    },
  });
}

describe("webhook → magic link 邮件（幂等）", () => {
  let providerSpy: ReturnType<typeof createProviderSpy>;

  beforeEach(() => {
    process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.MAGIC_LINK_SECRET = MAGIC_SECRET;
    resetOrderStore();
    providerSpy = createProviderSpy();
    setEmailProviderOverride(providerSpy.provider);
  });

  afterEach(() => {
    setEmailProviderOverride(null);
    resetOrderStore();
    restoreEnv();
  });

  it("首次 order_created（已完成）→ 发 1 封 magic link，token 可验签", async () => {
    const res = await POST(makeWebhookRequest(orderCreatedPayload()));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: boolean;
      magicLinkEmail: string;
    };
    expect(body.created).toBe(true);
    expect(body.magicLinkEmail).toBe("sent");
    expect(providerSpy.send).toHaveBeenCalledTimes(1);

    const message = providerSpy.send.mock.calls[0]![0] as EmailMessage;
    expect(message.to).toBe("buyer@example.com");
    expect(message.subject).toMatch(/magic link/i);
    expect(message.html).toContain("/report?token=");

    // 邮件里的 token 必须能通过签名校验（端到端契约）
    const match = /\/report\?token=([^"&]+)/.exec(message.html);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]!);
    const verified = verifyMagicLinkToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload.orderId).toBe("ord_1001");
  });

  it("同一事件重复投递（LS 重试）→ 不重复发信", async () => {
    const raw = orderCreatedPayload();

    const first = await POST(makeWebhookRequest(raw));
    expect(((await first.json()) as { magicLinkEmail: string }).magicLinkEmail).toBe(
      "sent"
    );

    const second = await POST(makeWebhookRequest(raw));
    const secondBody = (await second.json()) as {
      created: boolean;
      magicLinkEmail: string;
    };
    expect(secondBody.created).toBe(false);
    expect(secondBody.magicLinkEmail).toBe("not-triggered");
    expect(providerSpy.send).toHaveBeenCalledTimes(1);
  });

  it("order_created 但付款未完成（pending）→ 不发信", async () => {
    const res = await POST(
      makeWebhookRequest(orderCreatedPayload({ status: "pending" }))
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { magicLinkEmail: string };
    expect(body.magicLinkEmail).toBe("skipped:not-completed");
    expect(providerSpy.send).not.toHaveBeenCalled();
  });

  it("订单没有邮箱 → 不发信，但仍 200 落库", async () => {
    const res = await POST(makeWebhookRequest(orderCreatedPayload({ email: "" })));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { magicLinkEmail: string };
    expect(body.magicLinkEmail).toBe("skipped:no-email");
    expect(providerSpy.send).not.toHaveBeenCalled();
  });

  it("退款事件（非首次完成）→ 不发信", async () => {
    const res = await POST(makeWebhookRequest(refundPayload()));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { magicLinkEmail: string };
    expect(body.magicLinkEmail).toBe("not-triggered");
    expect(providerSpy.send).not.toHaveBeenCalled();
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("refunded");
  });
});
