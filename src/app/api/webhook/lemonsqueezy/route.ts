/**
 * POST /api/webhook/lemonsqueezy
 * 接 Lemon Squeezy 订单 webhook（下单 / 退款 / 取消）。
 *
 * 验签（官方口径）：
 *   - header: `X-Signature`
 *   - 值：HMAC-SHA256(secret = LEMON_SQUEEZY_WEBHOOK_SECRET, 原始 request body) 的小写 hex
 *   - 用原始 body 验签（不要先 JSON.parse 再序列化），常量时间比较
 *   - 失败 → 401；secret 未配置 → 500（fail closed，绝不放过未验签请求）
 *
 * 幂等：同一订单的重复投递（LS 重试）→ `orders.upsert()` 判定 changed=false，
 * 仍返回 200 但不产生新记录；终态（refunded/canceled）不会被旧事件改回去。
 *
 * 事件：
 *   order_created / order.completed / checkout.completed → 订单完成，魔链可访问报告
 *   order_refunded / order.refunded                     → 吊销访问（FR-7）
 *   order_cancelled / order.canceled                    → 标记取消
 * 其它事件（如 subscription.*）→ 200 忽略，避免 LS 反复重试。
 *
 * 数据库：当前写进程内 Map（src/lib/orders.ts，见其中 DB 接入口说明），
 * serverless 多实例 / 冷启动会丢数据，上线前必须换 OrderStore 的 DB 实现。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendMagicLinkForOrder } from "@/lib/email";
import {
  getOrderStore,
  isLemonOrderEvent,
  parseLemonOrderEvent,
  type OrderRecord,
} from "@/lib/orders";

// node:crypto + 进程内 Map 都要求 Node.js runtime。
// 不写 `export const runtime = "nodejs"`：Next 16 的 cacheComponents 与该段配置互斥，
// 而 App Router 路由默认就是 Node.js runtime（只要不显式声明 edge）。
const SIGNATURE_HEADER = "x-signature";
const EVENT_HEADER = "x-event-name";

function getWebhookSecret(): string {
  return process.env.LEMON_SQUEEZY_WEBHOOK_SECRET?.trim() || "";
}

/**
 * 常量时间比较 X-Signature 与 HMAC-SHA256 hex。
 * 兼容 `sha256=` 前缀与大小写差异（官方是小写裸 hex）。
 */
function verifySignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (!rawBody || !signature || !secret) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const provided = signature
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = getWebhookSecret();
  if (!secret) {
    // fail closed：没配 secret 时不接受任何 webhook（原先开发期放行的逻辑已移除）
    console.error("[webhook] LEMON_SQUEEZY_WEBHOOK_SECRET 未配置，拒绝处理");
    return NextResponse.json(
      { error: "webhook secret not configured" },
      { status: 500 }
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get(SIGNATURE_HEADER) || "";
  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseLemonOrderEvent(
    payload,
    req.headers.get(EVENT_HEADER)
  );

  if (!isLemonOrderEvent(parsed.eventName) || !parsed.order) {
    // 非订单事件 / 无订单 id：200 忽略，避免 LS 无限重试
    return NextResponse.json({
      ok: true,
      event: parsed.eventName,
      ignored: true,
    });
  }

  const result = await getOrderStore().upsert(parsed.order);

  // 首次落库 + 订单已完成 → 发 magic link 邮件。
  // 幂等靠 upsert 的 created：LS 重试同一事件时 created=false，不会重复发信。
  const magicLinkEmail = await maybeSendMagicLinkEmail(
    parsed.eventName,
    result.created,
    result.order
  );

  return NextResponse.json({
    ok: true,
    event: parsed.eventName,
    orderId: result.order.orderId,
    status: result.order.status,
    created: result.created,
    idempotent: !result.changed,
    magicLinkEmail,
  });
}

/** 触发 magic link 邮件的「完成」事件名（新版 snake_case + 旧版点号） */
const COMPLETION_EVENT_NAMES = new Set([
  "order_created",
  "order.completed",
  "checkout.completed",
]);

async function maybeSendMagicLinkEmail(
  eventName: string,
  created: boolean,
  order: OrderRecord
): Promise<string> {
  if (!created || !COMPLETION_EVENT_NAMES.has(eventName.toLowerCase())) {
    return "not-triggered";
  }
  if (order.status !== "completed") {
    // 例如 order_created 但 status=pending：等真正的完成事件/人工处理
    return "skipped:not-completed";
  }

  const result = await sendMagicLinkForOrder(order);
  if (result.sent) return "sent";
  if (result.skipped) return `skipped:${result.skipped}`;

  console.error(
    `[webhook] magic link 邮件发送失败 order=${order.orderId}: ${result.error ?? "unknown"}`
  );
  // 邮件失败不影响 webhook 返回 200（否则 LS 会重试并重复落库/重复发信）
  return "failed";
}
