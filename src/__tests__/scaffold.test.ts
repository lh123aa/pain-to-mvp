import { describe, it, expect } from "vitest";

// 占位单元测试（Task 1 · 脚手架，让 `pnpm test` 在 M1 之前有可跑的基线）
// M1 起由 parser/rules 模块的真实测试取代
describe("scaffold baseline", () => {
  it("unit test pipeline runs", () => {
    expect(1 + 1).toBe(2);
  });
});
