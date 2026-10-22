/**
 * 最小运行观测（进程内，不依赖外部服务）。
 *
 * 设计约束：
 * - 只记录计数/金额/枚举，不记录 PII、聊天内容、邮箱、token；
 * - 进程内计数在 serverless 冷启动/多实例下会被重置/分裂，仅适合
 *   staging 与「快速发现异常」；长期指标应接外部时序库；
 * - 成本帽按 UTC 日桶，超过 `COST_DAILY_CAP_USD`（默认 50）时
 *   `capExceeded=true`，调用方（narrative 等）应据此停止付费调用。
 */

import { getOrderStoreKind } from "./orders";
import { getReportStoreKind } from "./report-store";

export const DEFAULT_COST_DAILY_CAP_USD = 50;

export type CounterName =
  | "webhook_received"
  | "webhook_rejected"
  | "webhook_ignored"
  | "order_upserted"
  | "order_created"
  | "order_completed"
  | "order_refunded"
  | "order_canceled"
  | "order_deleted"
  | "report_saved"
  | "report_fetched"
  | "report_deleted"
  | "narrative_calls"
  | "narrative_failures"
  | "generation_failures";

const COUNTER_NAMES: readonly CounterName[] = [
  "webhook_received",
  "webhook_rejected",
  "webhook_ignored",
  "order_upserted",
  "order_created",
  "order_completed",
  "order_refunded",
  "order_canceled",
  "order_deleted",
  "report_saved",
  "report_fetched",
  "report_deleted",
  "narrative_calls",
  "narrative_failures",
  "generation_failures",
];

const startedAt = Date.now();

let counters: Record<CounterName, number> = emptyCounters();
let costDayKey = utcDayKey(new Date());
let costTodayUsd = 0;

function emptyCounters(): Record<CounterName, number> {
  const init = {} as Record<CounterName, number>;
  for (const name of COUNTER_NAMES) init[name] = 0;
  return init;
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 递增一个计数器（未知名称忽略，避免脏写）。 */
export function increment(name: CounterName, by = 1): void {
  if (!(name in counters)) return;
  counters[name] += Math.trunc(by);
}

/** 记录一笔 LLM 成本（USD）；跨 UTC 日自动归零。 */
export function recordCostUsd(usd: number, now: Date = new Date()): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const key = utcDayKey(now);
  if (key !== costDayKey) {
    costDayKey = key;
    costTodayUsd = 0;
  }
  costTodayUsd = Math.round((costTodayUsd + usd) * 1e6) / 1e6;
}

export function getCostCapUsd(): number {
  const raw = process.env.COST_DAILY_CAP_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COST_DAILY_CAP_USD;
}

export function getCostTodayUsd(): number {
  return costTodayUsd;
}

export function isCostCapExceeded(now: Date = new Date()): boolean {
  if (utcDayKey(now) !== costDayKey) return false;
  return costTodayUsd >= getCostCapUsd();
}

export interface HealthSnapshot {
  ok: boolean;
  uptimeSec: number;
  stores: { order: string | null; report: string | null };
  counters: Record<CounterName, number>;
  costTodayUsd: number;
  capUsd: number;
  capExceeded: boolean;
  degraded: boolean;
  time: string;
}

/**
 * 健康快照。store kind 读取失败不抛异常，只标记 degraded。
 * 注意：这里绝不返回环境变量或密钥。
 */
export function getHealthSnapshot(now: Date = new Date()): HealthSnapshot {
  let orderKind: string | null = null;
  let reportKind: string | null = null;
  let degraded = false;
  try {
    orderKind = getOrderStoreKind();
  } catch {
    degraded = true;
  }
  try {
    reportKind = getReportStoreKind();
  } catch {
    degraded = true;
  }

  const capExceeded = isCostCapExceeded(now);
  return {
    ok: !degraded && !capExceeded,
    uptimeSec: Math.round((now.getTime() - startedAt) / 1000),
    stores: { order: orderKind, report: reportKind },
    counters: { ...counters },
    costTodayUsd,
    capUsd: getCostCapUsd(),
    capExceeded,
    degraded,
    time: now.toISOString(),
  };
}

/** 测试钩子：重置计数/成本/起始时间/日桶。 */
export function resetObservability(now: Date = new Date()): void {
  counters = emptyCounters();
  costDayKey = utcDayKey(now);
  costTodayUsd = 0;
}
