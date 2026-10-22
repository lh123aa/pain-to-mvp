/**
 * POST /api/delete-report
 * =======================
 * 用户删除自己的报告与分析数据（隐私删除，GDPR/CCPA 风格）。
 *
 * 入参（二选一）：
 *   `{ "token": "v1.<payload>.<sig>" }`
 *   `{ "orderId": "ord_123", "token": "v1...." }`   ← orderId 必须与 token 内一致
 *
 * 流程：验签 + 过期 → 查订单 → 删除分析数据（清空 custom / email / variant 等，
 *       orders.ts#deleteOrderAnalysis，DB 实现里等价于删除分析表行）→ 吊销魔链。
 *
 * 返回：
 *   200 { ok:true, deletedAt }
 *   200 { ok:true, alreadyDeleted:true, deletedAt }   重复删除（幂等）
 *   400 请求体不是合法 JSON
 *   401 缺 token / token 无效 / 过期 / 签名错误
 *   403 body.orderId 与 token 不一致（不允许删别人的订单）
 *   404 订单不存在
 *
 * 说明：删除后订单记录保留最小骨架（orderId / status=deleted / 时间戳）用于幂等与
 * 审计，其余 PII 与 custom 数据全部清空；访问吊销由订单状态（verify-magic-link 403）
 * 和魔链吊销表共同保证。
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteOrderAnalysis, getOrderStore } from "@/lib/orders";
import {
  revokeMagicLinksForOrder,
  verifyMagicLinkToken,
} from "@/lib/magic-link";

// Node.js runtime is the App Router default; do not declare it; Next 16 cacheComponents rejects the segment config.

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 }
    );
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "token required" },
      { status: 401 }
    );
  }

  const verified = verifyMagicLinkToken(token);
  if (!verified.ok) {
    return jsonForVerifyFailure(verified.reason);
  }

  const tokenOrderId = verified.payload.orderId;
  const requestedOrderId =
    typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (requestedOrderId && requestedOrderId !== tokenOrderId) {
    return NextResponse.json(
      { ok: false, error: "orderId does not match token" },
      { status: 403 }
    );
  }

  const store = getOrderStore();
  const order = await store.get(tokenOrderId);
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "order not found" },
      { status: 404 }
    );
  }

  // 幂等：已经删过 → 返回成功（并确保魔链处于吊销状态）
  if (order.status === "deleted") {
    revokeMagicLinksForOrder(tokenOrderId);
    return NextResponse.json({
      ok: true,
      alreadyDeleted: true,
      deletedAt: order.deletedAt || order.updatedAt,
    });
  }

  const mutation = await deleteOrderAnalysis(tokenOrderId);
  if (!mutation.ok) {
    return NextResponse.json(
      { ok: false, error: "order not found" },
      { status: 404 }
    );
  }

  revokeMagicLinksForOrder(tokenOrderId);

  return NextResponse.json({
    ok: true,
    deletedAt: mutation.order.deletedAt || mutation.order.updatedAt,
  });
}

/* ===== 小工具 ===== */

async function readJsonBody(
  req: NextRequest
): Promise<Record<string, unknown> | null> {
  try {
    const raw: unknown = await req.json();
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

function jsonForVerifyFailure(
  reason:
    | "malformed"
    | "invalid_signature"
    | "expired"
    | "revoked"
    | "not_configured"
): NextResponse {
  if (reason === "not_configured") {
    return NextResponse.json(
      { ok: false, error: "magic link secret not configured", reason },
      { status: 500 }
    );
  }
  const error =
    reason === "expired"
      ? "magic link expired"
      : reason === "revoked"
        ? "magic link revoked"
        : "invalid magic link";
  return NextResponse.json({ ok: false, error, reason }, { status: 401 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
