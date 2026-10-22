import { NextRequest, NextResponse } from "next/server";
import { enhanceNarrative } from "@/lib/report-narrative";
import {
  increment,
  isCostCapExceeded,
  recordCostUsd,
} from "@/lib/observability";
import type { ReportDataV2 } from "@/lib/report-contract";

/**
 * POST /api/narrative
 *
 * 服务端叙事增强。LLM_API_KEY 只存在服务端；无 key / 超预算 / 失败时
 * 返回规则版报告（source="rules"），客户端无感。
 *
 * 隐私：请求体只接受已生成的 ReportDataV2（含 ≤200 字符引用），
 * 显式拒绝 conversation / messages / raw 等原文键；不记录报告内容。
 */

const MAX_BODY_BYTES = 1024 * 1024;
const FORBIDDEN_BODY_KEYS = ["conversation", "messages", "raw", "rawConversation", "features"];

export async function POST(request: NextRequest) {
  increment("narrative_calls");

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  for (const key of FORBIDDEN_BODY_KEYS) {
    if (key in record) {
      return NextResponse.json({ ok: false, error: "raw conversation not accepted" }, { status: 400 });
    }
  }

  const report = record.report;
  if (!isReportDataV2(report)) {
    return NextResponse.json({ ok: false, error: "invalid report" }, { status: 400 });
  }

  // 成本帽：超过当日上限就不再调用模型，直接回规则版。
  if (isCostCapExceeded()) {
    return NextResponse.json({
      ok: true,
      report,
      source: "rules",
      fallbackReason: "cost-cap",
      attempts: 0,
    });
  }

  const result = await enhanceNarrative(report);

  if (result.source === "llm") {
    recordCostUsd(result.costUsd ?? 0);
  } else if (result.fallbackReason && result.fallbackReason !== "no-provider") {
    increment("narrative_failures");
  }

  return NextResponse.json({
    ok: true,
    report: result.report,
    source: result.source,
    model: result.model,
    costUsd: result.costUsd,
    attempts: result.attempts,
    fallbackReason: result.fallbackReason,
  });
}

function isReportDataV2(value: unknown): value is ReportDataV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "report_v2") return false;
  if (!Array.isArray(record.chapters) || record.chapters.length !== 6) return false;
  if (typeof record.headline !== "object" || record.headline === null) return false;
  return true;
}
