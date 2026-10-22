import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/verify-magic-link/route";
import {
  MAGIC_LINK_TTL_SECONDS,
  buildMagicLinkUrl,
  issueMagicLinkToken,
  verifyMagicLinkToken,
} from "@/lib/magic-link";
import { getOrderStore, resetOrderStore, type OrderRecord } from "@/lib/orders";

/**
 * 魔链单测（全部离线：不 import 任何会发真实请求的实现分支）
 *
 * 覆盖：
 * - token 签发 / 验证：7 天 exp、orderId 往返、纯函数可注入 now
 * - 失败：篡改 payload、篡改签名、错误密钥、过期、格式非法、production 缺密钥
 * - route GET：有效 token 200 + 订单/报告状态；无效/过期 401
 * - 兼容：旧版 ?order_id=MOCK-xxx 仍可用（现有 report/page.tsx 的调用方式）
 * - 报告状态：pending 202、refunded 403
 */

const SECRET = "magic_test_secret";
const ORIGINAL_ENV: Record<string, string | undefined> = {
  MAGIC_LINK_SECRET: process.env.MAGIC_LINK_SECRET,
  LEMON_SQUEEZY_WEBHOOK_SECRET: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
  NODE_ENV: process.env.NODE_ENV,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function seedOrder(overrides: Partial<OrderRecord> = {}): Promise<OrderRecord> {
  const now = new Date().toISOString();
  const order: OrderRecord = {
    orderId: "ord_1001",
    variantId: "456",
    email: "buyer@example.com",
    status: "completed",
    custom: {
      fileName: "chat.txt",
      speakerA: "Alex",
      speakerB: "Sam",
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    lastEventName: "order_created",
    testMode: false,
    ...overrides,
  };
  await getOrderStore().upsert(order);
  return order;
}

function makeGet(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/verify-magic-link${query}`);
}

/** 确定性篡改签名（改首字符，长度不变，避免随机撞上原值） */
function tamperSignature(token: string): string {
  const [version, payload, signature] = token.split(".");
  const first = signature[0] === "A" ? "B" : "A";
  return `${version}.${payload}.${first}${signature.slice(1)}`;
}

beforeEach(() => {
  process.env.MAGIC_LINK_SECRET = SECRET;
  delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  vi.stubEnv("NODE_ENV", "test");
  resetOrderStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  restoreEnv();
});

describe("magic-link token 签发 / 验证", () => {
  it("签发 7 天有效 token，验证后 orderId / iat / exp 往返一致", () => {
    const now = 1_700_000_000;
    const token = issueMagicLinkToken("ord_1001", { now });

    expect(token.startsWith("v1.")).toBe(true);

    const verified = verifyMagicLinkToken(token, { now: now + 60 });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.orderId).toBe("ord_1001");
    expect(verified.payload.iat).toBe(now);
    expect(verified.payload.exp).toBe(now + MAGIC_LINK_TTL_SECONDS);
  });

  it("恰好到 exp 视为过期，exp 前 1 秒仍有效", () => {
    const now = 1_700_000_000;
    const token = issueMagicLinkToken("ord_1001", { now });

    expect(verifyMagicLinkToken(token, { now: now + MAGIC_LINK_TTL_SECONDS - 1 }).ok).toBe(true);
    expect(verifyMagicLinkToken(token, { now: now + MAGIC_LINK_TTL_SECONDS })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("篡改 payload（换成别的订单号）→ invalid_signature", () => {
    const token = issueMagicLinkToken("ord_1001", { now: 1_700_000_000 });
    const [version, , signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        orderId: "ord_evil",
        iat: 1_700_000_000,
        exp: 1_700_000_000 + MAGIC_LINK_TTL_SECONDS,
      }),
      "utf8"
    ).toString("base64url");

    const forged = `${version}.${forgedPayload}.${signature}`;
    expect(verifyMagicLinkToken(forged)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("篡改签名 → invalid_signature", () => {
    const token = issueMagicLinkToken("ord_1001", { now: 1_700_000_000 });
    expect(verifyMagicLinkToken(tamperSignature(token))).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("用错误密钥验证 → invalid_signature", () => {
    const token = issueMagicLinkToken("ord_1001", {
      now: 1_700_000_000,
      secret: SECRET,
    });
    expect(verifyMagicLinkToken(token, { secret: "other_secret" })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it.each(["", "v1", "v1.abc", "v2.abc.def", "v1..sig", "v1.payload."])(
    "格式非法 token %j → malformed",
    (token) => {
      expect(verifyMagicLinkToken(token)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  );

  it("production 未配置密钥：签发抛错、验证返回 not_configured", () => {
    const token = issueMagicLinkToken("ord_1001", {
      now: 1_700_000_000,
      secret: SECRET,
    });

    try {
      // NODE_ENV 被 Next 的类型声明标成 readonly，直接赋值 ts 会报错，用 vitest stub
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.MAGIC_LINK_SECRET;
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

      expect(() => issueMagicLinkToken("ord_1001")).toThrow(/MAGIC_LINK_SECRET/);
      expect(verifyMagicLinkToken(token)).toEqual({
        ok: false,
        reason: "not_configured",
      });
    } finally {
      vi.unstubAllEnvs();
      process.env.MAGIC_LINK_SECRET = SECRET;
    }
  });

  it("buildMagicLinkUrl 拼接 /report?token=... 且不产生双斜杠", () => {
    const url = buildMagicLinkUrl("v1.payload.sig", "https://thetell.app/");
    expect(url).toBe("https://thetell.app/report?token=v1.payload.sig");
  });
});

describe("GET /api/verify-magic-link — token 流程", () => {
  it("有效 token + 已完成订单 → 200，返回订单与报告状态 ready", async () => {
    await seedOrder();
    const token = issueMagicLinkToken("ord_1001");

    const res = await GET(makeGet(`?token=${encodeURIComponent(token)}`));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      via: string;
      report: { status: string; ready: boolean };
      order: { orderId: string; custom: Record<string, unknown> };
    };
    expect(body.ok).toBe(true);
    expect(body.via).toBe("token");
    expect(body.report).toEqual({ status: "ready", ready: true });
    expect(body.order.orderId).toBe("ord_1001");
    expect(body.order.custom.fileName).toBe("chat.txt");
  });

  it("无效 token → 401", async () => {
    const res = await GET(makeGet("?token=garbage"));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid magic link");
  });

  it("篡改 token → 401", async () => {
    await seedOrder();
    const token = issueMagicLinkToken("ord_1001");
    const tampered = tamperSignature(token);

    const res = await GET(makeGet(`?token=${encodeURIComponent(tampered)}`));
    expect(res.status).toBe(401);
  });

  it("过期 token → 401", async () => {
    await seedOrder();
    const token = issueMagicLinkToken("ord_1001", { now: 1_700_000_000 });

    const res = await GET(makeGet(`?token=${encodeURIComponent(token)}`));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { reason: string; error: string };
    expect(body.reason).toBe("expired");
    expect(body.error).toBe("magic link expired");
  });

  it("待支付订单 → 202 且 report.status=pending", async () => {
    await seedOrder({ status: "pending" });
    const token = issueMagicLinkToken("ord_1001");

    const res = await GET(makeGet(`?token=${encodeURIComponent(token)}`));

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      ok: boolean;
      reason: string;
      report: { status: string };
    };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("pending");
    expect(body.report.status).toBe("pending");
  });

  it("已退款订单 → 403 且 report.status=revoked", async () => {
    await seedOrder({ status: "refunded" });
    const token = issueMagicLinkToken("ord_1001");

    const res = await GET(makeGet(`?token=${encodeURIComponent(token)}`));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { report: { status: string } };
    expect(body.report.status).toBe("revoked");
  });
});

describe("GET /api/verify-magic-link — 旧 order_id 兼容", () => {
  it("?order_id=MOCK-xxx 仍走 mock 放行（现有 report/page.tsx 调用方式）", async () => {
    const res = await GET(makeGet("?order_id=MOCK-DEMO123"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      via: string;
      order: { orderId: string; status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.via).toBe("order_id");
    expect(body.order.status).toBe("completed");
  });

  it("?order_id= 命中 webhook 落库订单 → 200（无需网络）", async () => {
    await seedOrder();

    const res = await GET(makeGet("?order_id=ord_1001"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; order: { orderId: string } };
    expect(body.ok).toBe(true);
    expect(body.order.orderId).toBe("ord_1001");
  });

  it("缺少 token 与 order_id → 400", async () => {
    const res = await GET(makeGet(""));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("order_id or token required");
  });
});
