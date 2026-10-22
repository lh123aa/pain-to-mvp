import { NextResponse } from "next/server";
import { getHealthSnapshot } from "@/lib/observability";

/**
 * GET /api/health — 运行状态快照。
 * 只返回计数/成本/存储类型，不返回 env、密钥、订单或聊天数据。
 * 用途：staging 冒烟、uptime 探针、手工排查（成本帽/degraded）。
 */
export async function GET() {
  const snapshot = getHealthSnapshot();
  return NextResponse.json(snapshot, {
    status: snapshot.degraded ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}
