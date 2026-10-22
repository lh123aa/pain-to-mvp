/**
 * /api/report —— 跨设备报告存取（W3-2）
 * ====================================
 * 只存「浏览器里已生成的 ReportDataV2」（含 ≤200 字符证据引用，不含原文/完整会话），
 * 按 orderId 落库；之后任何设备凭魔链 token 都能读到同一份报告。
 *
 * POST /api/report
 *   body: { uploadToken, report }
 *   - uploadToken: GET /api/order-status 在订单 completed 时签发的 24h token
 *     （scope=report-upload，HMAC，绑定 orderId）
 *   - report: ReportDataV2（schemaVersion="report_v2"，JSON ≤1MB，evidence.quote ≤200 字）
 *   成功 200 { ok:true, savedAt }；同订单重复上传 = 幂等覆盖。
 *   错误：400 请求体/报告形状非法；401 缺/坏/过期 token；403 token scope 不对；
 *        409 订单不存在或未完成/已吊销；413 报告超过 1MB。
 *
 * GET /api/report?token=<魔链 token>
 *   - 验魔链签名/过期/吊销 → 订单必须 completed → 返回 { ok:true, report, savedAt }
 *   - 未就绪 404；魔链过期/订单已退款或删除 410；签名非法 401。
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrderStore } from "@/lib/orders";
import { verifyMagicLinkToken } from "@/lib/magic-link";
import {
  MAX_REPORT_REQUEST_BYTES,
  getReportStore,
  validateReportPayload,
  verifyReportUploadToken,
} from "@/lib/report-store";

// Node.js runtime 是 App Router 默认；不声明 runtime（Next 16 cacheComponents 与该配置互斥）。

/* ===== POST：上传已生成的报告 ===== */

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REPORT_REQUEST_BYTES) {
    return NextResponse.json(
      { ok: false, error: "report payload too large" },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 }
    );
  }
  if (!isRecord(body)) {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 }
    );
  }

  const uploadToken =
    typeof body.uploadToken === "string" ? body.uploadToken.trim() : "";
  if (!uploadToken) {
    return NextResponse.json(
      { ok: false, error: "uploadToken required" },
      { status: 401 }
    );
  }

  const verified = verifyReportUploadToken(uploadToken);
  if (!verified.ok) {
    return jsonForUploadTokenFailure(verified.reason);
  }

  const orderId = verified.payload.orderId;
  const order = await getOrderStore().get(orderId);
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "order not found" },
      { status: 409 }
    );
  }
  if (order.status !== "completed") {
    // 未支付 / 已退款 / 已删除：不允许再上传
    return NextResponse.json(
      { ok: false, error: `order is not completed (${order.status})` },
      { status: 409 }
    );
  }

  const validation = validateReportPayload(body.report);
  if (!validation.ok) {
    if (validation.reason === "too-large") {
      return NextResponse.json(
        { ok: false, error: "report payload too large" },
        { status: 413 }
      );
    }
    return NextResponse.json(
      { ok: false, error: `invalid report: ${validation.reason}` },
      { status: 400 }
    );
  }

  const stored = await getReportStore().save(orderId, validation.report);

  return NextResponse.json({ ok: true, savedAt: stored.savedAt });
}

/* ===== GET：凭魔链读取报告 ===== */

export async function GET(req: NextRequest) {
  const token = (new URL(req.url).searchParams.get("token") || "").trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "token required" },
      { status: 400 }
    );
  }

  const verified = verifyMagicLinkToken(token, { checkRevocation: true });
  if (!verified.ok) {
    return jsonForMagicLinkFailure(verified.reason);
  }

  const orderId = verified.payload.orderId;
  const order = await getOrderStore().get(orderId);
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "order not found" },
      { status: 404 }
    );
  }

  if (order.status !== "completed") {
    if (order.status === "pending") {
      // 订单还没完成：报告尚未就绪
      return NextResponse.json(
        { ok: false, error: "report not ready" },
        { status: 404 }
      );
    }
    // refunded / canceled / deleted：访问已吊销
    return NextResponse.json(
      { ok: false, error: "report no longer available" },
      { status: 410 }
    );
  }

  const stored = await getReportStore().get(orderId);
  if (!stored) {
    return NextResponse.json(
      { ok: false, error: "report not ready" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    report: stored.report,
    savedAt: stored.savedAt,
  });
}

/* ===== 错误映射 ===== */

function jsonForUploadTokenFailure(
  reason:
    | "malformed"
    | "invalid_signature"
    | "expired"
    | "wrong_scope"
    | "not_configured"
): NextResponse {
  if (reason === "not_configured") {
    return NextResponse.json(
      { ok: false, error: "report upload secret not configured" },
      { status: 500 }
    );
  }
  if (reason === "wrong_scope") {
    return NextResponse.json(
      { ok: false, error: "upload token has wrong scope" },
      { status: 403 }
    );
  }
  const error =
    reason === "expired" ? "upload token expired" : "invalid upload token";
  return NextResponse.json(
    { ok: false, error, reason },
    { status: 401 }
  );
}

function jsonForMagicLinkFailure(
  reason:
    | "malformed"
    | "invalid_signature"
    | "expired"
    | "revoked"
    | "not_configured"
): NextResponse {
  if (reason === "not_configured") {
    return NextResponse.json(
      { ok: false, error: "magic link secret not configured" },
      { status: 500 }
    );
  }
  if (reason === "expired" || reason === "revoked") {
    return NextResponse.json(
      { ok: false, error: "report link expired or revoked", reason },
      { status: 410 }
    );
  }
  return NextResponse.json(
    { ok: false, error: "invalid report link", reason },
    { status: 401 }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
