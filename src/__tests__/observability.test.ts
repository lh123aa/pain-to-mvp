import { describe, expect, it, beforeEach } from "vitest";

import {
  DEFAULT_COST_DAILY_CAP_USD,
  getCostCapUsd,
  getCostTodayUsd,
  getHealthSnapshot,
  increment,
  isCostCapExceeded,
  recordCostUsd,
  resetObservability,
} from "@/lib/observability";

beforeEach(() => {
  resetObservability();
});

describe("observability counters", () => {
  it("increments known counters and ignores unknown names", () => {
    increment("webhook_received");
    increment("webhook_received", 2);
    increment("not_a_counter" as never);
    const snapshot = getHealthSnapshot();
    expect(snapshot.counters.webhook_received).toBe(3);
    expect(Object.keys(snapshot.counters)).not.toContain("not_a_counter");
  });

  it("exposes store kinds without leaking env", () => {
    const snapshot = getHealthSnapshot();
    expect(["memory", "file", "injected", "postgres"]).toContain(snapshot.stores.order);
    expect(["memory", "file", "injected", "postgres"]).toContain(snapshot.stores.report);
    expect(JSON.stringify(snapshot)).not.toMatch(/postgres:\/\/|phc_|sk_|secret/i);
  });

  it("counts cost with a UTC day bucket and a $50 default cap", () => {
    expect(getCostCapUsd()).toBe(DEFAULT_COST_DAILY_CAP_USD);
    recordCostUsd(10);
    expect(getCostTodayUsd()).toBe(10);
    expect(isCostCapExceeded()).toBe(false);
    recordCostUsd(40);
    expect(isCostCapExceeded()).toBe(true);
    // 跨日归零
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    recordCostUsd(5, tomorrow);
    expect(getCostTodayUsd()).toBe(5);
    expect(isCostCapExceeded(tomorrow)).toBe(false);
  });

  it("ignores non-positive or non-finite costs", () => {
    recordCostUsd(0);
    recordCostUsd(-1);
    recordCostUsd(Number.NaN);
    expect(getCostTodayUsd()).toBe(0);
  });

  it("reset clears counters and cost", () => {
    increment("report_saved");
    recordCostUsd(3);
    resetObservability();
    expect(getHealthSnapshot().counters.report_saved).toBe(0);
    expect(getCostTodayUsd()).toBe(0);
  });
});
