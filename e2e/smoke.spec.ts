import { test, expect } from "@playwright/test";

// 冒烟测试（Task 1 · 脚手架占位，W0-A2 起扩展为 privacy.spec.ts）
// 方案 Task 1 只要求 Playwright 项目跑通（chromium），此处给一个最小用例验证 e2e 管线可用
test("landing page renders", async ({ page }) => {
  await page.goto("/");
  // Next.js 16 默认页带 "Welcome to Next.js!"（后续被 Landing 替换时同步改这条断言）
  await expect(page).toHaveTitle(/Next/i);
});
