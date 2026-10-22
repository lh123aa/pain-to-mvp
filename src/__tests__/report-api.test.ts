import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as reportGET, POST as reportPOST } from "@/app/api/report/route";
import { POST as deleteReportPOST } from "@/app/api/delete-report/route";
import {
  issueMagicLinkToken,
  resetMagicLinkRevocationStore,
  revokeMagicLinksForOrder,
  verifyMagicLinkToken,
} from "@/lib/magic-link";
import {
  getOrderStore,
  resetOrderStore,
  type OrderRecord,
} from "@/lib/orders";
import type { ReportDataV2 } from "@/lib/report-contract";
import {
  REPORT_TTL_MS,
  getReportStore,
  issueReportUploadToken,
  resetReportStore,
} from "@/lib/report-store";

/**
 * /api/report 单测（W3-2）
 *
 * 覆盖 POST：
 * - 合法 uploadToken + completed 订单 + report_v2 → 200 savedAt，落库可读
 * - 幂等覆盖：重复上传只保留最新一份
 * - 错误：400 坏 JSON/坏 report 形状/超 200 字引用/带原文；401 缺/坏/过期 token；
 *        403 scope 不对；409 订单不存在/未完成/已吊销；413 报告 >1MB
 * GET：
 * - 有效魔链 + 已就绪 → 200 { report, savedAt }
 * - 错误：400 缺 token；401 坏签名；410 魔链过期/已吊销/订单已退款或删除；
 *        404 订单 pending / 订单不存在 / 报告未上传 / 报告已过期
 *
 * 全程离线：订单/报告都用内存 store，token 本地签发。
 */

const MAGIC_SECRET = "report_api_test_secret";
const ORIGINAL_ENV: Record<string, string | undefined> = {
  MAGIC_LINK_SECRET: process.env.MAGIC_LINK_SECRET,
  REPORT_UPLOAD_SECRET: process.env.REPORT_UPLOAD_SECRET,
  REPORT_DATA_DIR: process.env.REPORT_DATA_DIR,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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
        length: 1,
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

function baseOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: "ord_1001",
    variantId: "456",
    email: "buyer@example.com",
    status: "completed",
    custom: { fileName: "chat.txt", client_ref: "tell_ref1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:05.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    lastEventName: "order_created",
    testMode: false,
    clientRef: "tell_ref1",
    ...overrides,
  };
}

async function seedOrder(overrides: Partial<OrderRecord> = {}): Promise<void> {
  await getOrderStore().upsert(baseOrder(overrides));
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function upload(body: unknown) {
  return reportPOST(makePostRequest(body));
}

async function readReport(token: string) {
  return reportGET(
    new NextRequest(
      `http://localhost/api/report?token=${encodeURIComponent(token)}`
    )
  );
}

beforeEach(() => {
  process.env.MAGIC_LINK_SECRET = MAGIC_SECRET;
  delete process.env.REPORT_UPLOAD_SECRET;
  delete process.env.REPORT_DATA_DIR;
  resetOrderStore();
  resetReportStore();
  resetMagicLinkRevocationStore();
});

afterEach(() => {
  resetOrderStore();
  resetReportStore();
  resetMagicLinkRevocationStore();
  restoreEnv();
});

describe("POST /api/report — 成功路径", () => {
  it("合法上传 → 200 savedAt，报告落库；随后魔链 GET 能读到同一份", async () => {
    await seedOrder();
    const uploadToken = issueReportUploadToken("ord_1001");
    const report = makeReport();

    const res = await upload({ uploadToken, report });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; savedAt: string };
    expect(body.ok).toBe(true);
    expect(Number.isFinite(Date.parse(body.savedAt))).toBe(true);

    expect((await getReportStore().get("ord_1001"))?.report).toEqual(report);

    const magicToken = issueMagicLinkToken("ord_1001");
    const getRes = await readReport(magicToken);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      ok: boolean;
      report: unknown;
      savedAt: string;
    };
    expect(getBody.ok).toBe(true);
    expect(getBody.report).toEqual(report);
    expect(getBody.savedAt).toBe(body.savedAt);
  });

  it("重复上传幂等覆盖：只保留最新一份", async () => {
    await seedOrder();
    const uploadToken = issueReportUploadToken("ord_1001");

    await upload({ uploadToken, report: makeReport({ disclaimer: "v1" }) });
    const second = await upload({
      uploadToken,
      report: makeReport({ disclaimer: "v2" }),
    });
    expect(second.status).toBe(200);
    expect(await getReportStore().list()).toHaveLength(1);

    const magicToken = issueMagicLinkToken("ord_1001");
    const getRes = await readReport(magicToken);
    const getBody = (await getRes.json()) as {
      report: { disclaimer: string };
    };
    expect(getBody.report.disclaimer).toBe("v2");
  });
});

describe("POST /api/report — 失败路径", () => {
  it("坏 JSON / 非对象 body → 400", async () => {
    expect((await upload("{oops")).status).toBe(400);
    expect((await upload(JSON.stringify("string-body"))).status).toBe(400);
  });

  it("缺 uploadToken / 坏 token / 过期 token → 401", async () => {
    await seedOrder();

    expect((await upload({ report: makeReport() })).status).toBe(401);
    expect(
      (await upload({ uploadToken: "garbage", report: makeReport() })).status
    ).toBe(401);

    const expired = issueReportUploadToken("ord_1001", {
      now: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const expiredRes = await upload({
      uploadToken: expired,
      report: makeReport(),
    });
    expect(expiredRes.status).toBe(401);
    expect(((await expiredRes.json()) as { reason?: string }).reason).toBe(
      "expired"
    );
  });

  it("魔链 token 冒充上传 token → 401（版本前缀不同，不能被重放）", async () => {
    await seedOrder();
    const magicToken = issueMagicLinkToken("ord_1001");

    const res = await upload({ uploadToken: magicToken, report: makeReport() });
    expect(res.status).toBe(401);
  });

  it("订单不存在 / 未完成 / 已退款 / 已删除 → 409", async () => {
    const uploadToken = issueReportUploadToken("ord_1001");

    // 未知订单
    expect(
      (await upload({ uploadToken, report: makeReport() })).status
    ).toBe(409);

    await seedOrder({ status: "pending" });
    expect(
      (await upload({ uploadToken, report: makeReport() })).status
    ).toBe(409);

    resetOrderStore();
    await seedOrder({ status: "refunded" });
    expect(
      (await upload({ uploadToken, report: makeReport() })).status
    ).toBe(409);

    resetOrderStore();
    await seedOrder({ status: "deleted" });
    expect(
      (await upload({ uploadToken, report: makeReport() })).status
    ).toBe(409);
  });

  it("report 形状非法 / 引用超 200 字 / 带原文 → 400", async () => {
    await seedOrder();
    const uploadToken = issueReportUploadToken("ord_1001");

    const badSchema = await upload({
      uploadToken,
      report: makeReport({ meta: { schemaVersion: "report_v1" } }),
    });
    expect(badSchema.status).toBe(400);

    const longQuote = await upload({
      uploadToken,
      report: makeReport({
        evidence: [
          {
            messageId: "m1",
            quote: "x".repeat(201),
            timestamp: null,
            chapterId: "at-a-glance",
          },
        ],
      }),
    });
    expect(longQuote.status).toBe(400);

    const rawConversation = await upload({
      uploadToken,
      report: makeReport({ conversation: { messages: ["raw"] } }),
    });
    expect(rawConversation.status).toBe(400);
  });

  it("报告 > 1MB → 413", async () => {
    await seedOrder();
    const uploadToken = issueReportUploadToken("ord_1001");

    const res = await upload({
      uploadToken,
      report: makeReport({ disclaimer: "x".repeat(1100 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});

describe("GET /api/report — 魔链读取", () => {
  it("缺 token → 400；坏 token → 401", async () => {
    expect(
      (
        await reportGET(new NextRequest("http://localhost/api/report"))
      ).status
    ).toBe(400);

    const bad = await reportGET(
      new NextRequest("http://localhost/api/report?token=garbage")
    );
    expect(bad.status).toBe(401);
  });

  it("魔链过期 → 410；魔链被吊销（订单删除/退款）→ 410", async () => {
    await seedOrder();
    await getReportStore().save("ord_1001", makeReport());

    const expiredMagic = issueMagicLinkToken("ord_1001", {
      now: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    expect((await readReport(expiredMagic)).status).toBe(410);

    const magicToken = issueMagicLinkToken("ord_1001");
    revokeMagicLinksForOrder("ord_1001");
    expect((await readReport(magicToken)).status).toBe(410);
  });

  it("订单 pending → 404；订单 refunded/deleted → 410", async () => {
    const magicToken = issueMagicLinkToken("ord_1001");
    await seedOrder({ status: "pending" });
    expect((await readReport(magicToken)).status).toBe(404);

    resetOrderStore();
    await seedOrder({ status: "refunded" });
    expect((await readReport(magicToken)).status).toBe(410);

    resetOrderStore();
    await seedOrder({ status: "deleted" });
    expect((await readReport(magicToken)).status).toBe(410);
  });

  it("订单 completed 但报告未上传 → 404", async () => {
    await seedOrder();
    const magicToken = issueMagicLinkToken("ord_1001");
    expect((await readReport(magicToken)).status).toBe(404);
  });

  it("报告超过 90 天过期 → 404", async () => {
    await seedOrder();
    await getReportStore().save("ord_1001", makeReport(), {
      now: Date.now() - REPORT_TTL_MS - 1000,
    });

    const magicToken = issueMagicLinkToken("ord_1001");
    expect((await readReport(magicToken)).status).toBe(404);
  });

  it("订单不存在 → 404（魔链签名本身有效）", async () => {
    const magicToken = issueMagicLinkToken("ord_missing");
    expect((await readReport(magicToken)).status).toBe(404);
  });

  it("上传 token 不能当魔链用（防止重放）", () => {
    const uploadToken = issueReportUploadToken("ord_1001");
    expect(verifyMagicLinkToken(uploadToken)).toMatchObject({ ok: false });
  });
});

describe("/api/delete-report — 同时删除跨设备报告", () => {
  function deleteRequest(token: string): NextRequest {
    return new NextRequest("http://localhost/api/delete-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  }

  it("删除订单时报告一并删除；重复删除幂等", async () => {
    await seedOrder();
    await getReportStore().save("ord_1001", makeReport());
    const magicToken = issueMagicLinkToken("ord_1001");

    const res = await deleteReportPOST(deleteRequest(magicToken));
    expect(res.status).toBe(200);

    expect(await getReportStore().get("ord_1001")).toBeNull();
    expect((await readReport(magicToken)).status).toBe(410);

    // 重复删除：订单已 deleted → 幂等分支，仍会再尝试删报告
    const again = await deleteReportPOST(deleteRequest(magicToken));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { alreadyDeleted?: boolean }).alreadyDeleted).toBe(
      true
    );
  });
});
