/**
 * POST /api/refund
 * ================
 * 魔链退款：用户凭邮件里的 magic link token 自助退款（7 天内无条件）。
 *
 * 入参：`{ "token": "v1.<payload>.<sig>" }`
 * 流程：验签 + 过期 → 查订单 → 7 天窗口 → provider 真退款（无 key 为本地 no-op）
 *       → 本地状态机 completed→refunded → 吊销该订单所有魔链。
 *
 * 返回：
 *   200 { ok:true, refundedAt, mode:"lemon-squeezy"|"local", providerRefundId? }
 *   200 { ok:true, alreadyRefunded:true, refundedAt }       重复请求（幂等）
 *   400 请求体不是合法 JSON
 *   401 缺 token / token 无效 / 过期 / 签名错误
 *   404 订单不存在（或 LS 侧 404）
 *   409 订单已删除（不可退款）/ 本地状态变更冲突
 *   422 超过 7 天窗口 / 订单状态不可退款
 *   500 magic link secret 未配置 / 本地状态写入失败
 *   502 退款 provider 失败（未做本地状态变更，可重试）
 *
 * 注意：退款成功后用户的报告访问立即被吊销（verify-magic-link 走订单状态返回 403；
 * token 吊销表也写入，后续 route 可映射 401/410）。
 */

import { NextRequest, NextResponse } from "next/server";
import { refundOrder, getOrderStore } from "@/lib/orders";
import {
  revokeMagicLinksForOrder,
  verifyMagicLinkToken,
} from "@/lib/magic-link";
import {
  REFUND_WINDOW_DAYS,
  getRefundProvider,
  isWithinRefundWindow,
} from "@/lib/refund";

// Node.js runtime is the App Router default; do not declare it; Next 16 cacheComponents rejects the segment config.

/**
 * 商品是 $14.99 一次性买断（见 src/lib/checkout.ts priceUsd）。
 * TODO(order-amount): 接入 DB 后从订单记录读取实际金额；当前按固定价全额退款。
 */
const REFUND_AMOUNT_CENTS = 1499;

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

  const orderId = verified.payload.orderId;
  const store = getOrderStore();
  const order = await store.get(orderId);
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "order not found" },
      { status: 404 }
    );
  }

  // 幂等：已经退过款 → 仍返回成功（再次确保 token 已吊销）
  if (order.status === "refunded") {
    revokeMagicLinksForOrder(orderId);
    return NextResponse.json({
      ok: true,
      alreadyRefunded: true,
      refundedAt: order.refundedAt || order.updatedAt,
    });
  }

  if (order.status === "deleted") {
    return NextResponse.json(
      { ok: false, error: "order deleted; refund unavailable" },
      { status: 409 }
    );
  }

  if (order.status !== "completed") {
    return NextResponse.json(
      {
        ok: false,
        error: `order status "${order.status}" is not refundable`,
      },
      { status: 422 }
    );
  }

  const now = new Date();
  if (
    !isWithinRefundWindow(order.completedAt || order.createdAt, now)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `refund window expired (${REFUND_WINDOW_DAYS} days)`,
        windowDays: REFUND_WINDOW_DAYS,
        completedAt: order.completedAt || order.createdAt,
      },
      { status: 422 }
    );
  }

  const provider = getRefundProvider();
  const providerResult = await provider.refund({
    orderId,
    amountCents: REFUND_AMOUNT_CENTS,
  });
  if (!providerResult.ok) {
    if (providerResult.httpStatus === 404) {
      return NextResponse.json(
        { ok: false, error: providerResult.error },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { ok: false, error: providerResult.error, mode: providerResult.mode },
      { status: 502 }
    );
  }

  const mutation = await refundOrder(orderId, now);
  if (!mutation.ok) {
    // provider 已退款成功但本地状态写入失败（并发删除等）→ 需要人工介入
    console.error(
      `[refund] provider refunded but local state failed order=${orderId} reason=${mutation.reason}`
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          "refund processed by provider but local order state could not be updated; contact support",
        mode: providerResult.mode,
      },
      { status: 500 }
    );
  }

  revokeMagicLinksForOrder(orderId);

  return NextResponse.json({
    ok: true,
    refundedAt: mutation.order.refundedAt || now.toISOString(),
    mode: providerResult.mode,
    ...(providerResult.providerRefundId
      ? { providerRefundId: providerResult.providerRefundId }
      : {}),
    windowDays: REFUND_WINDOW_DAYS,
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
  reason: "malformed" | "invalid_signature" | "expired" | "revoked" | "not_configured"
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
