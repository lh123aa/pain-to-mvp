/**
 * 结账 mock / 真 Lemon Squeezy 切换层
 * ------------------------------------
 * 默认 mock 模式（无 LEMON_SQUEEZY_API_KEY），链路可完整走完。
 * 真实接入后：在 Vercel 后台 / .env.local 填：
 *   LEMON_SQUEEZY_API_KEY   （Test 或 Live 模式，Test 用 4242 卡片不扣真钱）
 *   LEMON_SQUEEZY_STORE_ID
 *   LEMON_SQUEEZY_VARIANT_ID
 *   LEMON_SQUEEZY_LIVE=true
 * 三者齐备且 LEMON_SQUEEZY_LIVE=true 时走真 API；否则 mock。
 *
 * 真模式流程：
 *   1. POST https://api.lemonsqueezy.com/v1/checkouts
 *      body: { variant_id, checkout_data: { email, custom: {...}, redirect_url } }
 *   2. 响应 data.attributes.checkout_url 即托管页 URL
 *   3. 用户在托管页付款 → 跳回 `${baseUrl}/report?checkout=<order_id>&order_id=<order_id>`
 *   4. 报告页调 GET /api/verify-magic-link?order_id=xxx 验签 + 取订单
 *   5. webhook 落订单数据（后续补数据库）
 */

import { makeReportFromInput, ReportData } from "./demo-report";

export type CheckoutResult = {
  mock: boolean;
  /** mock 时为占位，真实时是 Lemon Squeezy 托管页 URL */
  url: string;
  /** 订单/checkout id，报告页凭此取数据 */
  checkoutId: string;
  priceUsd: number;
};

export type CheckoutRequest = {
  /** 上传的文件名（demo） */
  fileName: string;
  speakerA: string;
  speakerB: string;
  pasted?: string;
  email?: string;
};

/** 生成演示报告（mock 数据源；真实内核到位后替换为解析+规则+LLM 结果） */
export function buildDemoReport(req: CheckoutRequest): ReportData {
  return makeReportFromInput(
    req.fileName || "(pasted)",
    req.speakerA || "You",
    req.speakerB || "Them"
  );
}

function isLive(): boolean {
  const key = process.env.LEMON_SQUEEZY_API_KEY?.trim();
  const live = process.env.LEMON_SQUEEZY_LIVE?.toLowerCase() === "true";
  return !!key && live;
}

function apiHeaders() {
  const key = process.env.LEMON_SQUEEZY_API_KEY!.trim();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

/**
 * 创建结账
 * - mock：本地伪造一个可展示的订单 id + 假 URL（落到 /report 带 preview 参数）
 * - live：POST Lemon Squeezy /v1/checkouts，返回托管页 URL
 */
export async function createCheckout(
  req: CheckoutRequest,
  baseUrl: string
): Promise<CheckoutResult> {
  const priceUsd = 14.99;

  if (!isLive()) {
    // mock 分支：本地伪造
    const id = "MOCK-" + Date.now().toString(36).toUpperCase();
    const payload = JSON.stringify(req);
    const enc = Buffer.from(payload, "utf8").toString("base64url");
    const mockUrl = `${baseUrl}/report?checkout=${id}&preview=${enc}`;
    return { mock: true, url: mockUrl, checkoutId: id, priceUsd };
  }

  // live 分支：真 Lemon Squeezy
  const storeId = process.env.LEMON_SQUEEZY_STORE_ID?.trim();
  const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID?.trim();
  if (!storeId || !variantId) {
    throw new Error(
      "LEMON_SQUEEZY_LIVE=true 但 LEMON_SQUEEZY_STORE_ID / LEMON_SQUEEZY_VARIANT_ID 未配置"
    );
  }

  const redirectUrl = `${baseUrl}/report?checkout=${encodeURIComponent("PENDING")}`;
  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      variant_id: variantId,
      checkout_data: {
        email: req.email || "",
        redirect_url: redirectUrl,
        custom: {
          fileName: req.fileName,
          speakerA: req.speakerA,
          speakerB: req.speakerB,
          pastedLen: (req.pasted || "").length,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[checkout] Lemon Squeezy API 错误:", res.status, text);
    throw new Error(`Lemon Squeezy checkout 创建失败 (HTTP ${res.status})`);
  }

  const data = await res.json();
  const checkoutUrl: string = data?.data?.attributes?.checkout_url;
  const checkoutId: string = data?.data?.id || "UNKNOWN";
  if (!checkoutUrl) {
    console.error("[checkout] 响应无 checkout_url:", JSON.stringify(data).slice(0, 500));
    throw new Error("Lemon Squeezy 响应缺少 checkout_url");
  }

  return { mock: false, url: checkoutUrl, checkoutId, priceUsd };
}

/* ===== 订单验证（魔链）===== */

export type OrderInfo = {
  orderId: string;
  variantId: string;
  email: string;
  completedAt: string;
  /** Lemon Squeezy 订单状态：completed / refunded / canceled */
  status: "completed" | "refunded" | "canceled" | "pending";
  /** 下单时挂的 custom 字段（fileName / speakerA / speakerB） */
  custom: Record<string, unknown>;
};

/**
 * 验订单是否已完成（魔链回访 / 报告页取数前置）
 * 真模式：调 Lemon Squeezy /v1/orders/:id
 * mock 模式：直接放行（MOCK- 前缀的订单 id 视为已完成）
 */
export async function verifyOrder(orderId: string): Promise<OrderInfo> {
  if (orderId.startsWith("MOCK-")) {
    return {
      orderId,
      variantId: "MOCK",
      email: "guest",
      completedAt: new Date().toISOString(),
      status: "completed",
      custom: {},
    };
  }

  if (!isLive()) {
    // live 未开但收到非 MOCK 订单：拒绝（防未配置时误放行）
    throw new Error("订单验证需 LEMON_SQUEEZY_LIVE=true");
  }

  const res = await fetch(
    `https://api.lemonsqueezy.com/v1/orders/${encodeURIComponent(orderId)}`,
    { headers: apiHeaders() }
  );
  if (res.status === 404) {
    throw new Error(`订单 ${orderId} 不存在`);
  }
  if (!res.ok) {
    const text = await res.text();
    console.error("[verifyOrder] 错误:", res.status, text);
    throw new Error(`订单验证失败 (HTTP ${res.status})`);
  }
  const data = await res.json();
  const attrs = data?.data?.attributes || {};
  const order: OrderInfo = {
    orderId: String(data?.data?.id || orderId),
    variantId: String(attrs.variant_id || ""),
    email: String(attrs.email || attrs.billing_email || ""),
    completedAt: String(attrs.completed_at || attrs.created_at || ""),
    status: (["completed", "refunded", "canceled"].includes(attrs.order_status)
      ? attrs.order_status
      : "pending") as OrderInfo["status"],
    custom: attrs.custom || {},
  };
  if (order.status === "refunded" || order.status === "canceled") {
    throw new Error(`订单状态为 ${order.status}，拒绝访问`);
  }
  return order;
}
