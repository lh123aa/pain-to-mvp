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
 *      header: Authorization: Bearer <key> + Accept/Content-Type: application/vnd.api+json
 *      body（JSON:API）:
 *        { data: { type: "checkouts",
 *                  attributes: { checkout_data: {...}, product_options: { redirect_url } },
 *                  relationships: { store: {data:{type:"stores",id}}, variant: {data:{type:"variants",id}} } } }
 *   2. 响应里的 `data.attributes.url` 即托管页 URL（不是旧版的 checkout_url）
 *   3. 用户在托管页付款 → 回跳 /report（LS 的 redirect_url 是静态的，订单号靠 webhook 提供）
 *   4. 支付事件由 /api/webhook/lemonsqueezy 验签后落库到 src/lib/orders.ts
 *   5. 邮件里的魔链 token → GET /api/verify-magic-link?token=xxx 验签 + 取订单
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
  /**
   * W3-2 跨设备报告：checkout 页生成的随机关联 id（`tell_<random>`）。
   * 原样放进 LS `checkout_data.custom.client_ref`，webhook 回传后落 OrderRecord.clientRef。
   * 不传时 checkout 流程仍然可用（旧调用方 / 测试兼容），但没有跨设备关联。
   */
  clientRef?: string;
};

/**
 * checkout 页把 clientRef 写到 sessionStorage 的 key（W3-2 跨页契约）。
 * `report` 页（report-engineer 在接线）读取它后调 `GET /api/order-status?ref=`。
 */
export const CHECKOUT_CLIENT_REF_STORAGE_KEY = "tell:checkout-client-ref";

const CLIENT_REF_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * 生成 clientRef：`tell_<16 字节随机 base36>`。
 * 用 Web Crypto（浏览器 / Node 18+ 都有），没有时退回 Math.random（仅本地降级）。
 */
export function generateClientRef(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let suffix = "";
  for (const byte of bytes) {
    suffix += CLIENT_REF_ALPHABET[byte % CLIENT_REF_ALPHABET.length];
  }
  return `tell_${suffix}`;
}

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

const LEMON_SQUEEZY_API_BASE = "https://api.lemonsqueezy.com/v1";
/** Lemon Squeezy v1 是 JSON:API，Accept / Content-Type 都必须用它，用 application/json 会被 406/415 */
const JSON_API_CONTENT_TYPE = "application/vnd.api+json";

/** Lemon Squeezy JSON:API 认证 header；写请求才带 Content-Type */
function apiHeaders(options: { jsonBody?: boolean } = {}): Record<string, string> {
  const key = process.env.LEMON_SQUEEZY_API_KEY?.trim() || "";
  const headers: Record<string, string> = {
    Accept: JSON_API_CONTENT_TYPE,
    Authorization: `Bearer ${key}`,
  };
  if (options.jsonBody) headers["Content-Type"] = JSON_API_CONTENT_TYPE;
  return headers;
}

export type LemonCheckoutBody = {
  data: {
    type: "checkouts";
    attributes: {
      checkout_data: {
        email?: string;
        custom: Record<string, string>;
      };
      product_options: {
        redirect_url: string;
      };
    };
    relationships: {
      store: { data: { type: "stores"; id: string } };
      variant: { data: { type: "variants"; id: string } };
    };
  };
};

/**
 * 构造 Lemon Squeezy v1 创建结账的 JSON:API 请求体（纯函数，便于单测断言形状）。
 * 官方文档：POST /v1/checkouts
 * https://docs.lemonsqueezy.com/api/checkouts#create-a-checkout
 */
export function buildCheckoutBody(
  req: CheckoutRequest,
  options: {
    storeId: string;
    variantId: string;
    redirectUrl: string;
    /** W3-2：透传 clientRef；只在有值时写入 custom（旧调用方/测试形状不变） */
    clientRef?: string;
  }
): LemonCheckoutBody {
  const custom: Record<string, string> = {
    fileName: req.fileName || "",
    speakerA: req.speakerA || "",
    speakerB: req.speakerB || "",
    pastedLen: String((req.pasted || "").length),
  };
  const clientRef = options.clientRef?.trim();
  if (clientRef) custom.client_ref = clientRef;

  const checkoutData: LemonCheckoutBody["data"]["attributes"]["checkout_data"] = {
    // custom 的值统一用字符串，避免 JSON:API 序列化差异
    custom,
  };
  if (req.email) checkoutData.email = req.email;

  return {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: checkoutData,
        product_options: { redirect_url: options.redirectUrl },
      },
      relationships: {
        store: { data: { type: "stores", id: options.storeId } },
        variant: { data: { type: "variants", id: options.variantId } },
      },
    },
  };
}

/** 可注入依赖（单测替换 fetch，避免任何真实网络请求） */
export type LemonApiOptions = {
  fetchImpl?: typeof fetch;
};

/**
 * 创建结账
 * - mock：本地伪造一个可展示的订单 id + 假 URL（落到 /report 带 preview 参数）
 * - live：POST Lemon Squeezy /v1/checkouts，返回托管页 URL
 */
export async function createCheckout(
  req: CheckoutRequest,
  baseUrl: string,
  options: LemonApiOptions = {}
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

  const fetchImpl = options.fetchImpl ?? fetch;
  // LS 的 redirect_url 是静态 URL，不能带真实订单号；订单号由 webhook / 魔链邮件提供。
  const redirectUrl = `${baseUrl}/report?checkout=PENDING`;
  const res = await fetchImpl(`${LEMON_SQUEEZY_API_BASE}/checkouts`, {
    method: "POST",
    headers: apiHeaders({ jsonBody: true }),
    body: JSON.stringify(
      buildCheckoutBody(req, {
        storeId,
        variantId,
        redirectUrl,
        clientRef: req.clientRef,
      })
    ),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[checkout] Lemon Squeezy API 错误:", res.status, text);
    throw new Error(`Lemon Squeezy checkout 创建失败 (HTTP ${res.status})`);
  }

  const data = (await res.json()) as {
    data?: { id?: string; attributes?: { url?: string } };
  };
  const checkoutUrl = data?.data?.attributes?.url;
  const checkoutId = data?.data?.id || "UNKNOWN";
  if (!checkoutUrl) {
    console.error(
      "[checkout] 响应缺少 data.attributes.url:",
      JSON.stringify(data).slice(0, 500)
    );
    throw new Error("Lemon Squeezy 响应缺少 data.attributes.url");
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
export async function verifyOrder(
  orderId: string,
  options: LemonApiOptions = {}
): Promise<OrderInfo> {
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

  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `${LEMON_SQUEEZY_API_BASE}/orders/${encodeURIComponent(orderId)}`,
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
  const data = (await res.json()) as {
    data?: { id?: string; attributes?: Record<string, unknown> };
  };
  const attrs: Record<string, unknown> = data?.data?.attributes || {};
  const rawStatus = String(attrs.status ?? attrs.order_status ?? "").toLowerCase();
  const status: OrderInfo["status"] =
    rawStatus === "paid" || rawStatus === "completed"
      ? "completed"
      : rawStatus === "refunded" || rawStatus === "partially_refunded"
        ? "refunded"
        : rawStatus === "cancelled" || rawStatus === "canceled"
          ? "canceled"
          : "pending";
  const order: OrderInfo = {
    orderId: String(data?.data?.id || orderId),
    variantId: String(attrs.variant_id || ""),
    email: String(attrs.user_email || attrs.email || attrs.billing_email || ""),
    completedAt: String(attrs.completed_at || attrs.created_at || ""),
    status,
    custom:
      (attrs.custom_data as Record<string, unknown> | undefined) ||
      (attrs.custom as Record<string, unknown> | undefined) ||
      {},
  };
  if (order.status === "refunded" || order.status === "canceled") {
    throw new Error(`订单状态为 ${order.status}，拒绝访问`);
  }
  return order;
}
