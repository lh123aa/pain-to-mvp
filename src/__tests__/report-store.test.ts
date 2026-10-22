import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ReportDataV2 } from "@/lib/report-contract";
import { issueMagicLinkToken } from "@/lib/magic-link";
import {
  InMemoryReportStore,
  REPORT_TTL_DAYS,
  REPORT_TTL_MS,
  REPORT_UPLOAD_TOKEN_TTL_SECONDS,
  REPORT_UPLOAD_SCOPE,
  buildStoredReport,
  getReportStore,
  getReportStoreKind,
  isStoredReportExpired,
  issueReportUploadToken,
  resetReportStore,
  setReportStore,
  validateReportPayload,
  verifyReportUploadToken,
} from "@/lib/report-store";
import { FileReportStore, createFileReportStore } from "@/lib/report-store-file";

/**
 * ReportStore + report-upload token 单测（W3-2）
 *
 * 覆盖：
 * - 内存/文件存储：保存、幂等覆盖、90 天过期（时钟注入）、删除、跨实例持久化
 * - 文件损坏恢复 + 存储选择（REPORT_DATA_DIR / 注入）
 * - payload 校验：schema / 6 章 / 引用 ≤200 字 / 禁止原文 / ≤1MB
 * - 24h report-upload token：签发/验证/scope/过期/篡改/未配置
 */

const SECRET = "report_upload_test_secret";
const ORIGINAL_ENV: Record<string, string | undefined> = {
  MAGIC_LINK_SECRET: process.env.MAGIC_LINK_SECRET,
  REPORT_UPLOAD_SECRET: process.env.REPORT_UPLOAD_SECRET,
  REPORT_DATA_DIR: process.env.REPORT_DATA_DIR,
  NODE_ENV: process.env.NODE_ENV,
};
let dir: string;

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

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tell-reports-"));
  process.env.MAGIC_LINK_SECRET = SECRET;
  delete process.env.REPORT_UPLOAD_SECRET;
  delete process.env.REPORT_DATA_DIR;
  resetReportStore();
});

afterEach(async () => {
  resetReportStore();
  restoreEnv();
  await rm(dir, { recursive: true, force: true });
});

describe("InMemoryReportStore", () => {
  it("保存 → 读取；90 天过期字段正确", async () => {
    const clockNow = new Date("2026-10-01T00:00:00.000Z");
    const store = new InMemoryReportStore({ now: () => clockNow });
    const report = makeReport();

    const stored = await store.save("ord_1", report, { now: clockNow });

    expect(stored.orderId).toBe("ord_1");
    expect(stored.createdAt).toBe(clockNow.toISOString());
    expect(stored.savedAt).toBe(clockNow.toISOString());
    expect(Date.parse(stored.expiresAt) - Date.parse(stored.savedAt)).toBe(
      REPORT_TTL_MS
    );
    expect(REPORT_TTL_DAYS).toBe(90);
    expect(await store.get("ord_1")).toEqual(stored);
  });

  it("重复保存幂等覆盖：只保留一份、createdAt 保留、savedAt 刷新", async () => {
    let clockNow = new Date("2026-10-01T00:00:00.000Z");
    const store = new InMemoryReportStore({ now: () => clockNow });
    const first = await store.save("ord_1", makeReport());
    clockNow = new Date("2026-10-02T00:00:00.000Z");
    const second = await store.save(
      "ord_1",
      makeReport({ headline: { score: 42 } })
    );

    expect(await store.list()).toHaveLength(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.savedAt).toBe("2026-10-02T00:00:00.000Z");
    expect((await store.get("ord_1"))?.report.headline).toEqual({ score: 42 });
  });

  it("过期后 get 返回 null 并删除；list 不含过期", async () => {
    let now = new Date("2026-05-01T00:00:00.000Z");
    const store = new InMemoryReportStore({ now: () => now });
    await store.save("ord_1", makeReport());
    expect(isStoredReportExpired((await store.get("ord_1"))!, now)).toBe(false);

    now = new Date(now.getTime() + REPORT_TTL_MS + 1000);
    expect(await store.list()).toEqual([]);
    expect(await store.get("ord_1")).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("deleteReport 幂等", async () => {
    const store = new InMemoryReportStore();
    await store.save("ord_1", makeReport());
    expect(await store.deleteReport("ord_1")).toBe(true);
    expect(await store.deleteReport("ord_1")).toBe(false);
    expect(await store.get("ord_1")).toBeNull();
  });
});

describe("FileReportStore", () => {
  it("跨实例持久化（写 → 新实例读）", async () => {
    const writer = createFileReportStore(dir);
    await writer.save("ord_1", makeReport({ disclaimer: "persisted" }));

    const reader = createFileReportStore(dir);
    const stored = await reader.get("ord_1");
    expect(stored).not.toBeNull();
    expect(stored?.report.disclaimer).toBe("persisted");
    expect(stored?.expiresAt).toBeTruthy();
  });

  it("覆盖保存 / 删除跨实例生效", async () => {
    const base = Date.now();
    const writer = createFileReportStore(dir);
    await writer.save("ord_1", makeReport(), { now: base });
    await writer.save("ord_1", makeReport({ disclaimer: "v2" }), {
      now: base + 1000,
    });

    const reader = createFileReportStore(dir);
    expect(await reader.list()).toHaveLength(1);
    expect((await reader.get("ord_1"))?.report.disclaimer).toBe("v2");

    expect(await reader.deleteReport("ord_1")).toBe(true);
    expect(await createFileReportStore(dir).get("ord_1")).toBeNull();
  });

  it("90 天过期（时钟注入）：读不到，且文件被惰性清理", async () => {
    let now = new Date("2026-05-01T00:00:00.000Z");
    const store = new FileReportStore(dir, { now: () => now });
    await store.save("ord_1", makeReport());

    now = new Date(now.getTime() + REPORT_TTL_MS + 1000);
    expect(await store.get("ord_1")).toBeNull();

    const raw = await readFile(path.join(dir, "reports.json"), "utf8");
    const parsed = JSON.parse(raw) as { reports: Record<string, unknown> };
    expect(Object.keys(parsed.reports)).toHaveLength(0);
  });

  it("损坏 JSON → 备份 .corrupt-<ts> + 空库继续", async () => {
    await writeFile(path.join(dir, "reports.json"), "{not json", "utf8");

    const store = createFileReportStore(dir);
    expect(await store.list()).toEqual([]);
    const files = await readdir(dir);
    expect(
      files.some((name) => name.startsWith("reports.json.corrupt-"))
    ).toBe(true);

    await store.save("ord_after", makeReport());
    expect(await createFileReportStore(dir).get("ord_after")).not.toBeNull();
  });

  it("buildStoredReport 过期后覆盖保存会重置 createdAt", () => {
    const now = new Date("2026-05-01T00:00:00.000Z");
    const old = buildStoredReport("ord_1", makeReport(), now, null);
    const later = new Date(now.getTime() + REPORT_TTL_MS + 1000);
    const next = buildStoredReport("ord_1", makeReport(), later, old);
    expect(next.createdAt).toBe(later.toISOString());
    expect(next.savedAt).toBe(later.toISOString());
  });
});

describe("ReportStore 选择", () => {
  it("无 REPORT_DATA_DIR → memory；setReportStore → injected", () => {
    delete process.env.REPORT_DATA_DIR;
    resetReportStore();
    expect(getReportStoreKind()).toBe("memory");
    expect(getReportStore()).toBeInstanceOf(InMemoryReportStore);

    const injected = new InMemoryReportStore();
    setReportStore(injected);
    expect(getReportStoreKind()).toBe("injected");
    expect(getReportStore()).toBe(injected);
  });

  it("REPORT_DATA_DIR → file，且跨 reset 持久化", async () => {
    process.env.REPORT_DATA_DIR = dir;
    resetReportStore();
    expect(getReportStoreKind()).toBe("file");

    await getReportStore().save("ord_file", makeReport());

    resetReportStore();
    expect(getReportStoreKind()).toBe("file");
    expect(await getReportStore().get("ord_file")).not.toBeNull();
  });
});

describe("validateReportPayload", () => {
  it("合法 report_v2 通过", () => {
    expect(validateReportPayload(makeReport())).toMatchObject({ ok: true });
  });

  it("schemaVersion 不对 / 章数不对 → shape", () => {
    expect(validateReportPayload(null)).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(
      validateReportPayload(
        makeReport({
          meta: { schemaVersion: "report_v1" },
        })
      )
    ).toEqual({ ok: false, reason: "shape" });
    expect(validateReportPayload(makeReport({ chapters: [] }))).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("证据引用 >200 字符 → quote-too-long", () => {
    const result = validateReportPayload(
      makeReport({
        evidence: [
          {
            messageId: "m1",
            quote: "x".repeat(201),
            timestamp: null,
            chapterId: "at-a-glance",
          },
        ],
      })
    );
    expect(result).toEqual({ ok: false, reason: "quote-too-long" });
  });

  it("携带原文/完整会话字段 → raw-conversation", () => {
    expect(
      validateReportPayload(makeReport({ conversation: { messages: [] } }))
    ).toEqual({ ok: false, reason: "raw-conversation" });
    expect(validateReportPayload(makeReport({ messages: [] }))).toEqual({
      ok: false,
      reason: "raw-conversation",
    });
  });

  it("序列化 >1MB → too-large", () => {
    const result = validateReportPayload(
      makeReport({ disclaimer: "x".repeat(1100 * 1024) })
    );
    expect(result).toEqual({ ok: false, reason: "too-large" });
  });
});

describe("report-upload token（24h / scope=report-upload）", () => {
  it("签发后可验证：scope / orderId / 24h 过期", () => {
    const now = 1_700_000_000;
    const token = issueReportUploadToken("ord_1001", { now });

    const verified = verifyReportUploadToken(token, { now: now + 60 });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.scope).toBe(REPORT_UPLOAD_SCOPE);
    expect(verified.payload.orderId).toBe("ord_1001");
    expect(verified.payload.exp - verified.payload.iat).toBe(
      REPORT_UPLOAD_TOKEN_TTL_SECONDS
    );
  });

  it("过期 / 篡改 / 格式非法 / 错误 scope", () => {
    const now = 1_700_000_000;
    const token = issueReportUploadToken("ord_1001", { now });

    expect(
      verifyReportUploadToken(token, { now: now + REPORT_UPLOAD_TOKEN_TTL_SECONDS })
    ).toEqual({ ok: false, reason: "expired" });

    const [version, payload, signature] = token.split(".");
    const tampered = `${version}.${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(verifyReportUploadToken(tampered)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });

    expect(verifyReportUploadToken("garbage")).toEqual({
      ok: false,
      reason: "malformed",
    });

    // 魔链 token 冒充上传 token：版本前缀不同（v1 vs ru1）→ malformed
    const magicToken = issueMagicLinkToken("ord_1001", { now });
    expect(verifyReportUploadToken(magicToken)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("签名有效但 scope 不对 → wrong_scope", () => {
    const now = 1_700_000_000;
    const payload = {
      scope: "some-other-scope",
      orderId: "ord_1",
      iat: now,
      exp: now + 60,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url"
    );
    const signature = createHmac("sha256", SECRET)
      .update(`ru1.${payloadB64}`, "utf8")
      .digest("base64url");

    expect(
      verifyReportUploadToken(`ru1.${payloadB64}.${signature}`, { now: now + 1 })
    ).toEqual({ ok: false, reason: "wrong_scope" });
  });

  it("production 无密钥 → not_configured；签发抛错", () => {
    const token = issueReportUploadToken("ord_1001", {
      secret: "some_secret",
      now: 1_700_000_000,
    });
    try {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.MAGIC_LINK_SECRET;
      delete process.env.REPORT_UPLOAD_SECRET;

      expect(verifyReportUploadToken(token)).toEqual({
        ok: false,
        reason: "not_configured",
      });
      expect(() => issueReportUploadToken("ord_1001")).toThrow(
        /REPORT_UPLOAD_SECRET|MAGIC_LINK_SECRET/
      );
    } finally {
      vi.unstubAllEnvs();
      process.env.MAGIC_LINK_SECRET = SECRET;
    }
  });

  it("REPORT_UPLOAD_SECRET 优先于 MAGIC_LINK_SECRET", () => {
    process.env.REPORT_UPLOAD_SECRET = "dedicated_secret";
    const now = 1_700_000_000;
    const token = issueReportUploadToken("ord_1", { now });
    expect(
      verifyReportUploadToken(token, { secret: "dedicated_secret", now }).ok
    ).toBe(true);
    expect(
      verifyReportUploadToken(token, { secret: "magic_only_secret", now })
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });
});
