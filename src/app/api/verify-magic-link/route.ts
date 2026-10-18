import { NextRequest, NextResponse } from "next/server";
import { verifyOrder } from "../../../../src/lib/checkout";

/**
 * GET /api/verify-magic-link?order_id=xxx
 * 报告页回访时调用：验订单是否已完成，返回订单信息（含 custom 字段）。
 * 未完成 / 退款 / 取消 / 不存在 → 403/404，报告页拒绝展示。
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const orderId = sp.get("order_id") || "";
  if (!orderId) {
    return NextResponse.json({ error: "order_id required" }, { status: 400 });
  }
  try {
    const order = await verifyOrder(orderId);
    if (order.status === "pending") {
      return NextResponse.json(
        { ok: false, reason: "pending", order },
        { status: 202 }
      );
    }
    return NextResponse.json({ ok: true, order });
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
