import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/webhook/lemonsqueezy
 * 接 Lemon Squeezy 订单 webhook（checkout 完成 / 退款 / 取消）。
 *
 * 验签：Lemon Squeezy 在 header 带 `x-lemonsqueezy-signature`，
 * 格式 `t=<ts>,v1=<hex>`。签名 = HMAC-SHA256(
 *   `<ts>.<rawBody>`, secret = `lemonsqueezy_secret` + `.` + `lemonsqueezy_api_key`
 * )。
 *
 * MVP 简化：先用 LEMON_SQUEEZY_WEBHOOK_SECRET 做 HMAC-SHA256 验签（标准做法），
 * 不通过直接 401。
 *
 * 事件：
 * - checkout.completed → 订单创建（magic link 可访问报告）
 * - order.refunded     → 吊销访问 + 删数据（FR-7）
 * - order.canceled     → 标记
 *
 * MVP 数据库未到位前：写 console.log 留痕，订单数据靠 verifyOrder 按需查 Lemon Squeezy。
 * 后续 P4 接 SQLite/Postgres 时在这里落库。
 */

const LS_API_KEY = () => process.env.LEMON_SQUEEZY_API_KEY?.trim() || "";
const LS_SECRET = () => process.env.LEMON_SQUEEZY_WEBHOOK_SECRET?.trim() || "";

import { createHmac } from "crypto";

function verifySignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = LS_SECRET();
  const apiKey = LS_API_KEY();
  if (!secret || !apiKey) {
    // 未配置 webhook secret 时：开发期放行（仅 local），生产必须配
    if (process.env.NODE_ENV === "production") return false;
    console.warn("[webhook] LEMON_SQUEEZY_WEBHOOK_SECRET 未配置，开发期放行");
    return true;
  }
  // Lemon Squeezy 签名算法：secret 为 `LEMONSQUEEZY_SIGNING_SECRET`（dashboard 可取）
  // 标准实现：HMAC-SHA256(`${ts}.${rawBody}`, secret)
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return expected === signature;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ts = req.headers.get("x-lemonsqueezy-signature-timestamp") || "";
  const sig = (req.headers.get("x-lemonsqueezy-signature") || "").replace(/^v1=/, "");

  if (!verifySignature(raw, ts, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: { event?: string; data?: { attributes?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const evt = event.event || "";
  const attrs = event.data?.attributes || {};
  const orderId = attrs.order_id || attrs.id || "";
  const status = attrs.order_status || attrs.status || "";

  console.log(
    `[webhook] ${evt} order=${orderId} status=${status} ts=${new Date().toISOString()}`
  );

  // MVP：按事件类型留痕；后续接 DB 时按 orderId 落库
  switch (evt) {
    case "checkout.completed":
    case "order.completed":
      // 订单完成：magic link 可访问报告（verifyOrder 会复核）
      break;
    case "order.refunded":
      // 退款：吊销访问（verifyOrder 查 Lemon Squeezy 当前状态会拒绝）
      console.log(`[webhook] 订单 ${orderId} 已退款，访问将被 verifyOrder 拒绝`);
      break;
    case "order.canceled":
      console.log(`[webhook] 订单 ${orderId} 已取消`);
      break;
    default:
      // 其他事件（如 subscription.* 未来扩展）暂忽略
      break;
  }

  // 快速 200，避免 Lemon Squeezy 重试
  return NextResponse.json({ ok: true });
}
