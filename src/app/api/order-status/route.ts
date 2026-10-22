/**
 * GET /api/order-status?ref=<clientRef>
 * =====================================
 * W3-2 跨设备报告链路：checkout 页生成 `clientRef`（tell_<random>）→ 随 LS checkout
 * 的 `checkout_data.custom.client_ref` 提交 → webhook 落库到 OrderRecord.clientRef →
 * 支付完成后报告页用本接口轮询并拿到「上传报告」的短期 token。
 *
 * 返回（契约）：
 *   { status, ready: boolean, uploadToken?: string }
 *   - status: 内部订单状态 completed / pending / refunded / canceled / deleted
 *   - ready: status === "completed"（且未吊销）；true 时带 uploadToken
 *   - uploadToken: 24h、scope=report-upload 的 HMAC token，只能用于 POST /api/report
 *
 * 错误：400 缺 ref；404 找不到订单；500 上传密钥未配置。
 */

import { NextRequest, NextResponse } from "next/server";
import { findOrderByClientRef } from "@/lib/orders";
import { issueReportUploadToken } from "@/lib/report-store";

// Node.js runtime 是 App Router 默认；不声明 runtime（Next 16 cacheComponents 与该配置互斥）。

export async function GET(req: NextRequest) {
  const ref = (new URL(req.url).searchParams.get("ref") || "").trim();
  if (!ref) {
    return NextResponse.json(
      { error: "ref required" },
      { status: 400 }
    );
  }

  const order = await findOrderByClientRef(ref);
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  const ready = order.status === "completed";
  if (!ready) {
    return NextResponse.json({ status: order.status, ready: false });
  }

  let uploadToken: string;
  try {
    uploadToken = issueReportUploadToken(order.orderId);
  } catch (err) {
    console.error(
      "[order-status] 无法签发 report-upload token:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "report upload secret not configured" },
      { status: 500 }
    );
  }

  // 契约字段：status / ready / uploadToken（额外不返回，避免 report 端误用）
  return NextResponse.json({ status: order.status, ready: true, uploadToken });
}
