/**
 * GET /api/verify-magic-link
 * 报告页回访时调用：验魔链 token（或旧版 order_id），返回订单 + 报告状态。
 *
 * 两种调用方式（token 优先）：
 *   ?token=v1.<payload>.<sig>  邮件魔链里的签名 token（7 天有效）
 *                              - 无效 / 过期 / 签名错误 → 401
 *   ?order_id=xxx              旧版直查（保留兼容现有 report/page.tsx）
 *                              - 先查 webhook 落库的订单，未命中再回落到 Lemon Squeezy API
 *
 * 返回：
 *   { ok: true,  order, report: { status: "ready",   ready: true  } }  200 已完成
 *   { ok: false, reason: "pending", order, report }                    202 未完成
 *   { ok: false, error }                                               401/403/404/500
 *
 * 报告状态映射：completed → ready；pending → pending；refunded/canceled → revoked + 403。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyOrder, type OrderInfo } from "@/lib/checkout";
import { verifyMagicLinkToken } from "@/lib/magic-link";
import { getOrderStore, type OrderRecord, type OrderStatus } from "@/lib/orders";

type ReportStatus = "ready" | "pending" | "revoked";
type Via = "token" | "order_id";

function reportState(status: OrderStatus): {
  status: ReportStatus;
  ready: boolean;
} {
  if (status === "completed") return { status: "ready", ready: true };
  if (status === "pending") return { status: "pending", ready: false };
  return { status: "revoked", ready: false };
}

function respondWithOrder(
  order: OrderInfo | OrderRecord,
  via: Via
): NextResponse {
  const report = reportState(order.status);

  if (report.status === "revoked") {
    return NextResponse.json(
      {
        ok: false,
        error: `订单状态为 ${order.status}，拒绝访问`,
        order,
        report,
        via,
      },
      { status: 403 }
    );
  }

  if (report.status === "pending") {
    return NextResponse.json(
      { ok: false, reason: "pending", order, report, via },
      { status: 202 }
    );
  }

  return NextResponse.json({ ok: true, order, report, via });
}

/** 内存存储未命中时，用 Lemon Squeezy API 实时复核（webhook 丢失 / 新实例冷启动） */
async function verifyWithLemonSqueezy(
  orderId: string,
  via: Via
): Promise<NextResponse> {
  try {
    const order = await verifyOrder(orderId);
    return respondWithOrder(order, via);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNotFound = msg.includes("不存在");
    const isDenied = msg.includes("拒绝") || msg.includes("LEMON_SQUEEZY_LIVE");
    return NextResponse.json(
      { ok: false, error: msg },
      { status: isNotFound ? 404 : isDenied ? 403 : 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const searchParams = new URL(req.url).searchParams;
  const token = (searchParams.get("token") || "").trim();

  // 1) 魔链 token（新流程）
  if (token) {
    const verified = verifyMagicLinkToken(token);
    if (!verified.ok) {
      const status = verified.reason === "not_configured" ? 500 : 401;
      const error =
        verified.reason === "expired"
          ? "magic link expired"
          : verified.reason === "not_configured"
            ? "magic link secret not configured"
            : "invalid magic link";
      return NextResponse.json(
        { ok: false, error, reason: verified.reason },
        { status }
      );
    }

    const orderId = verified.payload.orderId;
    const stored = await getOrderStore().get(orderId);
    if (stored) return respondWithOrder(stored, "token");
    return verifyWithLemonSqueezy(orderId, "token");
  }

  // 2) 旧版 order_id 直查（兼容现有 report/page.tsx）
  const orderId = (searchParams.get("order_id") || "").trim();
  if (!orderId) {
    return NextResponse.json(
      { ok: false, error: "order_id or token required" },
      { status: 400 }
    );
  }

  const stored = await getOrderStore().get(orderId);
  if (stored) return respondWithOrder(stored, "order_id");
  return verifyWithLemonSqueezy(orderId, "order_id");
}
