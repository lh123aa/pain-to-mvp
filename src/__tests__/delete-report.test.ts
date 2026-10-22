import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as deleteReportPOST } from "@/app/api/delete-report/route";
import { GET as verifyGET } from "@/app/api/verify-magic-link/route";
import {
  isMagicLinkRevoked,
  issueMagicLinkToken,
  resetMagicLinkRevocationStore,
  verifyMagicLinkToken,
} from "@/lib/magic-link";
import {
  getOrderStore,
  isAccessRevoked,
  resetOrderStore,
  type OrderRecord,
} from "@/lib/orders";

/**
 * POST /api/delete-report 单测（全离线）
 *
 * 覆盖：
 * - 首次删除：200 + 订单状态 deleted + PII/custom 清空 + 魔链吊销
 * - 吊销后 verify-magic-link 403；带 checkRevocation 的 token 验证 revoked
 * - 重复删除幂等（alreadyDeleted）；{orderId, token} 匹配/不匹配
 * - 缺/非法 token 401；未知订单 404；非法 JSON 400
 * - 已退款订单仍可删除（隐私优先）
 * - 删除不发起任何外部网络请求
 */

const MAGIC_SECRET = "delete_test_secret";

const ORIGINAL_ENV: Record<string, string | undefined> = {
  MAGIC_LINK_SECRET: process.env.MAGIC_LINK_SECRET,
  LEMON_SQUEEZY_WEBHOOK_SECRET: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
  LEMON_SQUEEZY_API_KEY: process.env.LEMON_SQUEEZY_API_KEY,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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

function makeJsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/delete-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function callDelete(body: unknown) {
  return deleteReportPOST(makeJsonRequest(body));
}

function tokenFor(orderId = "ord_1001"): string {
  return issueMagicLinkToken(orderId);
}

beforeEach(() => {
  process.env.MAGIC_LINK_SECRET = MAGIC_SECRET;
  delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  delete process.env.LEMON_SQUEEZY_API_KEY;
  resetOrderStore();
  resetMagicLinkRevocationStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv();
  resetMagicLinkRevocationStore();
});

describe("POST /api/delete-report — 首次删除", () => {
  it("200 + 状态 deleted + PII/custom 清空 + 魔链吊销 + 访问被拒", async () => {
    await seedOrder();
    const token = tokenFor();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await callDelete({ token });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deletedAt: string };
    expect(body.ok).toBe(true);
    expect(Number.isFinite(Date.parse(body.deletedAt))).toBe(true);

    // 删除不调用外部服务
    expect(fetchSpy).not.toHaveBeenCalled();

    const stored = await getOrderStore().get("ord_1001");
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("deleted");
    expect(stored?.email).toBe("");
    expect(stored?.variantId).toBe("");
    expect(stored?.custom).toEqual({});
    expect(stored?.deletedAt).toBeTruthy();
    // 最小骨架保留用于幂等/审计
    expect(stored?.orderId).toBe("ord_1001");
    expect(stored?.createdAt).toBeTruthy();

    expect(await isAccessRevoked("ord_1001")).toBe(true);
    expect(isMagicLinkRevoked("ord_1001")).toBe(true);

    // token 级吊销
    expect(
      verifyMagicLinkToken(token, { checkRevocation: true })
    ).toMatchObject({ ok: false, reason: "revoked" });

    // 报告访问：token 路径 → 订单状态 deleted → 403
    const verifyRes = await verifyGET(
      new NextRequest(
        `http://localhost/api/verify-magic-link?token=${encodeURIComponent(token)}`
      )
    );
    expect(verifyRes.status).toBe(403);

    // 旧版 order_id 路径同样 403
    const legacyRes = await verifyGET(
      new NextRequest("http://localhost/api/verify-magic-link?order_id=ord_1001")
    );
    expect(legacyRes.status).toBe(403);
  });

  it("重复删除 → 200 alreadyDeleted（幂等）", async () => {
    await seedOrder({
      status: "deleted",
      email: "",
      variantId: "",
      custom: {},
      deletedAt: "2026-04-01T00:00:00.000Z",
    });

    const res = await callDelete({ token: tokenFor() });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      alreadyDeleted: boolean;
      deletedAt: string;
    };
    expect(body.ok).toBe(true);
    expect(body.alreadyDeleted).toBe(true);
    expect(body.deletedAt).toBe("2026-04-01T00:00:00.000Z");
  });

  it("{orderId, token} 匹配 → 200；不匹配 → 403 且不删除", async () => {
    await seedOrder();
    const token = tokenFor();

    const mismatch = await callDelete({ token, orderId: "ord_other" });
    expect(mismatch.status).toBe(403);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("completed");

    const matched = await callDelete({ token, orderId: "ord_1001" });
    expect(matched.status).toBe(200);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("deleted");
  });

  it("已退款订单仍可删除数据（隐私优先）", async () => {
    await seedOrder({
      status: "refunded",
      refundedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await callDelete({ token: tokenFor() });

    expect(res.status).toBe(200);
    expect((await getOrderStore().get("ord_1001"))?.status).toBe("deleted");
  });
});

describe("POST /api/delete-report — 失败路径", () => {
  it("缺 token / token 非法 / 过期 → 401", async () => {
    await seedOrder();

    expect((await callDelete({})).status).toBe(401);
    expect((await callDelete({ token: "garbage" })).status).toBe(401);

    const expiredToken = issueMagicLinkToken("ord_1001", {
      now: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const expired = await callDelete({ token: expiredToken });
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as { reason: string }).reason).toBe("expired");

    expect((await getOrderStore().get("ord_1001"))?.status).toBe("completed");
  });

  it("未知订单 → 404", async () => {
    const res = await callDelete({ token: tokenFor("ord_missing") });
    expect(res.status).toBe(404);
  });

  it("请求体不是合法 JSON → 400", async () => {
    const res = await deleteReportPOST(makeJsonRequest("{oops"));
    expect(res.status).toBe(400);
  });
});
