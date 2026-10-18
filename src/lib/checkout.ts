/**
 * 结账 mock / 真 Lemon Squeezy 切换层
 * ------------------------------------
 * 默认 mock 模式（无真实 key），链路可完整走完。
 * 真实接入后：填 .env.local 的 LEMON_SQUEEZY_API_KEY / STORE_ID / VARIANT_ID，
 * 把 LE_MOCK=false（或不设）。
 *
 * Mock 返回一个"假 checkout url"，前端照常跳转，落到 /report（带 token=mock），
 * 报告页对 mock token 直接展示演示报告（不验签）。
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

/**
 * 创建结账（mock）
 * 真实实现（后续）：
 *   POST https://api.lemonsqueezy.com/v1/checkouts
 *   { variant_id, redirect_url: `${base}/report?checkout=...`,
 *     checkout_data: { email, custom: { fileName, speakers } } }
 *   响应 data.attributes.checkout_url 即托管页 URL。
 */
export async function createCheckout(
  req: CheckoutRequest,
  baseUrl: string
): Promise<CheckoutResult> {
  // mock：本地伪造一个可展示的订单 id + 假 URL
  const id = "MOCK-" + Date.now().toString(36).toUpperCase();
  const payload = JSON.stringify(req);
  const enc = Buffer.from(payload, "utf8").toString("base64url");
  const mockUrl = `${baseUrl}/report?checkout=${id}&preview=${enc}`;
  return { mock: true, url: mockUrl, checkoutId: id, priceUsd: 14.99 };
}
