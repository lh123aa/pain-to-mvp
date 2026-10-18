import { defineConfig, devices } from "@playwright/test";

// Playwright 配置（Task 1 · 脚手架）
// 方案 Task 1 Step 3：仅 chromium 项目（MVP 阶段够用，避免全浏览器矩阵拖慢 CI）
// 后续 M4 真机验证（AC-FX1-2 三款设备）再扩 firefox/webkit 或云测
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm start",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
  },
});
