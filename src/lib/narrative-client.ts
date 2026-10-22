import type { ReportDataV2 } from "./report-contract";

/**
 * 客户端 → 服务端叙事增强（LLM key 只在服务端）。
 * 失败/超时/非法响应一律返回 null，调用方保持本地规则版本渲染。
 */
export interface NarrativeResult {
  report: ReportDataV2;
  source: "llm" | "rules";
  model?: string;
  costUsd?: number;
}

export const NARRATIVE_ENDPOINT = "/api/narrative";
export const NARRATIVE_TIMEOUT_MS = 15_000;
export const NARRATIVE_MAX_BYTES = 1024 * 1024;

export async function requestNarrative(
  report: ReportDataV2,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<NarrativeResult | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? NARRATIVE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(NARRATIVE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as unknown;
    return parseNarrativeResponse(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNarrativeResponse(value: unknown): NarrativeResult | null {
  if (!isRecord(value)) return null;
  if (value.ok !== true) return null;
  const report = value.report;
  if (!isRecord(report) || report.schemaVersion !== "report_v2") return null;
  const source = value.source === "llm" ? "llm" : "rules";
  const model = typeof value.model === "string" ? value.model : undefined;
  const costUsd =
    typeof value.costUsd === "number" && Number.isFinite(value.costUsd)
      ? value.costUsd
      : undefined;
  return { report: report as unknown as ReportDataV2, source, model, costUsd };
}
