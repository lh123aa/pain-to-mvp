import { describe, expect, it, vi } from "vitest";

import { NARRATIVE_ENDPOINT, requestNarrative } from "@/lib/narrative-client";
import type { ReportDataV2 } from "@/lib/report-contract";

const minimalReport = {
  schemaVersion: "report_v2",
  chapters: [],
  headline: {},
} as unknown as ReportDataV2;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("requestNarrative", () => {
  it("returns the enhanced report on a valid response", async () => {
    const enhanced = { ...minimalReport, headline: { score: 70 } } as unknown as ReportDataV2;
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, report: enhanced, source: "llm", model: "m", costUsd: 0.001 }),
    ) as unknown as typeof fetch;

    const result = await requestNarrative(minimalReport, { fetchImpl });
    expect(result?.source).toBe("llm");
    expect(result?.costUsd).toBe(0.001);
    expect(fetchImpl).toHaveBeenCalledWith(
      NARRATIVE_ENDPOINT,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null on HTTP errors, bad JSON or invalid schema", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => jsonResponse({ error: "boom" }, 500),
      async () => new Response("not json", { status: 200 }),
      async () => jsonResponse({ ok: true, report: { schemaVersion: "nope" }, source: "llm" }),
    ];
    for (const impl of cases) {
      const fetchImpl = vi.fn(impl) as unknown as typeof fetch;
      await expect(requestNarrative(minimalReport, { fetchImpl })).resolves.toBeNull();
    }
  });

  it("returns null when the request times out", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;

    await expect(
      requestNarrative(minimalReport, { fetchImpl, timeoutMs: 10 }),
    ).resolves.toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(requestNarrative(minimalReport, { fetchImpl })).resolves.toBeNull();
  });
});
