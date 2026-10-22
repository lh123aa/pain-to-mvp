import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";
import { resetObservability } from "@/lib/observability";

describe("GET /api/health", () => {
  it("returns a snapshot without env or secrets", async () => {
    resetObservability();
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect([200, 503]).toContain(response.status);
    expect(body.ok).toBeTypeOf("boolean");
    expect(body).toHaveProperty("counters");
    expect(body).toHaveProperty("costTodayUsd");
    expect(body).toHaveProperty("capUsd");
    expect(body).toHaveProperty("stores");
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|phc_|sk_live|secret/i);
  });
});
