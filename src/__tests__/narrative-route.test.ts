import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/narrative/route";
import { resetObservability } from "@/lib/observability";

const validReport = {
  schemaVersion: "report_v2",
  chapters: [{}, {}, {}, {}, {}, {}],
  headline: { score: 70 },
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/narrative", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetObservability();
  delete process.env.LLM_API_KEY;
  delete process.env.COST_DAILY_CAP_USD;
});

afterEach(() => {
  delete process.env.LLM_API_KEY;
  delete process.env.COST_DAILY_CAP_USD;
});

describe("POST /api/narrative", () => {
  it("falls back to the rules report when no provider is configured", async () => {
    const response = await POST(request({ report: validReport }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.source).toBe("rules");
    expect(body.fallbackReason).toBe("no-provider");
    expect(body.report).toMatchObject({ schemaVersion: "report_v2" });
  });

  it("rejects invalid JSON, invalid report shape and raw conversation keys", async () => {
    const badJson = new NextRequest("http://localhost:3000/api/narrative", {
      method: "POST",
      body: "{not json",
    });
    expect((await POST(badJson)).status).toBe(400);

    expect((await POST(request({ report: { schemaVersion: "x" } }))).status).toBe(400);
    expect(
      (await POST(request({ report: validReport, conversation: { messages: [] } }))).status,
    ).toBe(400);
  });

  it("rejects oversized payloads", async () => {
    const huge = "x".repeat(1024 * 1024 + 10);
    const response = await POST(request({ report: validReport, pad: huge }));
    expect(response.status).toBe(413);
  });

  it("returns rules without calling a provider when the cost cap is exceeded", async () => {
    process.env.COST_DAILY_CAP_USD = "0.000001";
    const { recordCostUsd } = await import("@/lib/observability");
    recordCostUsd(1);
    const response = await POST(request({ report: validReport }));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.source).toBe("rules");
    expect(body.fallbackReason).toBe("cost-cap");
  });
});
