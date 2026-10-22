import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PgReportStore,
  type PgQueryResult,
} from "@/lib/report-store-pg";
import { closeSharedPgPool } from "@/lib/order-store-pg";
import type { ReportDataV2 } from "@/lib/report-contract";
import {
  REPORT_TTL_MS,
  getReportStore,
  getReportStoreKind,
  resetReportStore,
} from "@/lib/report-store";

/**
 * PgReportStore 单测（W5-2，不连真库）
 *
 * 覆盖：
 * - save：INSERT ... ON CONFLICT DO UPDATE 幂等覆盖；jsonb 参数 / savedAt+90d expiresAt
 * - get：SQL 带 `expires_at > now()`；row → StoredReport 映射；非法 data → null
 * - deleteReport（rowCount）/ list / clear
 * - 存储选择：DATABASE_URL → "postgres"（懒代理）；优先于 REPORT_DATA_DIR；无 DB 环境不变
 * - 注入 pool 对象
 */

const ORIGINAL_ENV: Record<string, string | undefined> = {
  DATABASE_URL: process.env.DATABASE_URL,
  REPORT_DATA_DIR: process.env.REPORT_DATA_DIR,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function emptyResult(): PgQueryResult {
  return { rows: [], rowCount: 0 };
}

function createQuery(queue: PgQueryResult[] = []) {
  return vi.fn(async (text: string, values?: unknown[]) => {
    void text;
    void values;
    if (queue.length > 0) return queue.shift() as PgQueryResult;
    return emptyResult();
  });
}

function callAt(
  query: ReturnType<typeof createQuery>,
  index: number
): { text: string; values: unknown[] } {
  const call = query.mock.calls[index];
  return {
    text: String(call?.[0] ?? ""),
    values: (call?.[1] as unknown[] | undefined) ?? [],
  };
}

function makeReport(overrides: Record<string, unknown> = {}): ReportDataV2 {
  const report: Record<string, unknown> = {
    meta: {
      schemaVersion: "report_v2",
      weightsVersion: "weights_v1",
      metricsVersion: "metrics_v1",
      attachmentRuleVersion: "attachment_v1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      sample: {
        messages: 10,
        dateRange: "Jan 1",
        durationDays: 1,
        timestampedMessages: 10,
      },
    },
    headline: {
      score: 80,
      grade: "B",
      scoreLabel: "Good",
      oneLineSummary: "One line.",
      confidence: 0.8,
      confidenceLabel: "high",
    },
    chapters: [
      "at-a-glance",
      "attachment",
      "health",
      "turning-points",
      "evidence-confidence",
      "next-7-days",
    ].map((id, index) => ({
      id,
      number: index + 1,
      title: "Title",
      summary: "Summary",
      dataNotEnough: false,
    })),
    evidence: [
      {
        messageId: "m1",
        quote: "short quote",
        timestamp: null,
        chapterId: "at-a-glance",
      },
    ],
    disclaimer: "Only observable patterns.",
    whatWeDontKnow: [],
    dataQuality: {
      confidence: 0.8,
      confidenceLabel: "high",
      lowSample: false,
      timestampCoverage: 1,
      needsDateConfirmation: false,
      warnings: [],
    },
    ...overrides,
  };
  return report as unknown as ReportDataV2;
}

const NOW = new Date("2026-05-01T00:00:00.000Z");
const EXPIRES = new Date(NOW.getTime() + REPORT_TTL_MS);

function reportRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "ord_1001",
    data: makeReport(),
    created_at: NOW,
    saved_at: NOW,
    expires_at: EXPIRES,
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.REPORT_DATA_DIR;
  resetReportStore();
});

afterEach(async () => {
  resetReportStore();
  restoreEnv();
  await closeSharedPgPool();
});

describe("PgReportStore — 构造与读取", () => {
  it("没有 connectionString / query / pool 时抛错", () => {
    expect(() => new PgReportStore({})).toThrow(/connectionString/);
  });

  it("get：row → StoredReport，SQL 带 90 天 TTL 条件", async () => {
    const query = createQuery([{ rows: [reportRow()], rowCount: 1 }]);
    const store = new PgReportStore({ query });

    const stored = await store.get("ord_1001");

    expect(stored?.orderId).toBe("ord_1001");
    expect(stored?.report.meta.schemaVersion).toBe("report_v2");
    expect(stored?.createdAt).toBe(NOW.toISOString());
    expect(stored?.savedAt).toBe(NOW.toISOString());
    expect(stored?.expiresAt).toBe(EXPIRES.toISOString());

    const { text, values } = callAt(query, 0);
    expect(text).toContain("FROM reports WHERE order_id = $1");
    expect(text).toContain("expires_at > now()");
    expect(values).toEqual(["ord_1001"]);
  });

  it("get：未命中 / data 非法 → null", async () => {
    const missing = new PgReportStore({ query: createQuery() });
    expect(await missing.get("ord_missing")).toBeNull();

    const invalid = new PgReportStore({
      query: createQuery([
        {
          rows: [reportRow({ data: { meta: { schemaVersion: "report_v1" } } })],
          rowCount: 1,
        },
      ]),
    });
    expect(await invalid.get("ord_1001")).toBeNull();
  });

  it("list：只返回数据库返回的未过期行；SQL 带 expires_at > now()", async () => {
    const query = createQuery([
      {
        rows: [reportRow(), reportRow({ order_id: "ord_2" })],
        rowCount: 2,
      },
    ]);
    const store = new PgReportStore({ query });

    const reports = await store.list();
    expect(reports.map((stored) => stored.orderId)).toEqual([
      "ord_1001",
      "ord_2",
    ]);
    const { text } = callAt(query, 0);
    expect(text).toContain("FROM reports");
    expect(text).toContain("expires_at > now()");
    expect(text).toContain("ORDER BY saved_at ASC");
  });

  it("注入 pool 对象也可用", async () => {
    const query = createQuery([{ rows: [reportRow()], rowCount: 1 }]);
    const store = new PgReportStore({ pool: { query } });
    expect(await store.get("ord_1001")).not.toBeNull();
  });
});

describe("PgReportStore — save / delete / clear", () => {
  it("save：INSERT ... ON CONFLICT DO UPDATE（幂等覆盖），jsonb + 90 天 expiresAt", async () => {
    const report = makeReport({ disclaimer: "v1" });
    const query = createQuery([
      {
        rows: [
          reportRow({
            data: report,
            created_at: new Date("2026-04-01T00:00:00.000Z"), // 保留首次 created_at
          }),
        ],
        rowCount: 1,
      },
    ]);
    const store = new PgReportStore({ query });

    const stored = await store.save("ord_1001", report, { now: NOW });

    expect(stored.savedAt).toBe(NOW.toISOString());
    expect(stored.expiresAt).toBe(EXPIRES.toISOString());
    // ON CONFLICT 不清 created_at，返回行保留首次保存时间
    expect(stored.createdAt).toBe("2026-04-01T00:00:00.000Z");

    const { text, values } = callAt(query, 0);
    expect(text).toContain("INSERT INTO reports");
    expect(text).toContain("ON CONFLICT (order_id) DO UPDATE");
    expect(text).toContain("saved_at = EXCLUDED.saved_at");
    expect(values[0]).toBe("ord_1001");
    expect(JSON.parse(String(values[1]))).toEqual(report);
    expect(values[2]).toBe(NOW.toISOString());
    expect(values[3]).toBe(NOW.toISOString());
    expect(values[4]).toBe(EXPIRES.toISOString());
  });

  it("deleteReport：rowCount 决定返回值", async () => {
    const hitQuery = createQuery([
      { rows: [{ order_id: "ord_1001" }], rowCount: 1 },
    ]);
    expect(
      await new PgReportStore({ query: hitQuery }).deleteReport("ord_1001")
    ).toBe(true);
    expect(callAt(hitQuery, 0).text).toContain(
      "DELETE FROM reports WHERE order_id = $1"
    );

    const missStore = new PgReportStore({ query: createQuery() });
    expect(await missStore.deleteReport("ord_missing")).toBe(false);
  });

  it("clear：DELETE FROM reports", async () => {
    const query = createQuery();
    const store = new PgReportStore({ query });
    await store.clear();
    expect(callAt(query, 0).text).toContain("DELETE FROM reports");
  });
});

describe("PgReportStore — 存储选择", () => {
  it("DATABASE_URL → getReportStoreKind()==='postgres'，优先于 REPORT_DATA_DIR", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/tell";
    process.env.REPORT_DATA_DIR = "C:/tmp/should-not-be-used";
    resetReportStore();

    expect(getReportStoreKind()).toBe("postgres");
    // 懒代理：构造不加载 pg、不建连接
    expect(getReportStore()).toBeTruthy();
  });

  it("无 DATABASE_URL 时行为不变（memory）", () => {
    delete process.env.DATABASE_URL;
    resetReportStore();
    expect(getReportStoreKind()).toBe("memory");
  });
});
