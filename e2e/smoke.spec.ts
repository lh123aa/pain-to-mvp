import path from "node:path";
import { test, expect } from "@playwright/test";

/**
 * W2 冒烟：真实上传 → 本地解析 → 免费三卡 → mock 结账 → 六章真实报告。
 * 约束：不依赖任何真实账号/密钥（mock 结账）；全程浏览器本地解析（无上传）。
 */
test.describe("The Tell · mock happy path", () => {
  test("landing page renders", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/The Tell/i);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("upload → preview → checkout → real report", async ({ page }) => {
    test.setTimeout(90_000);

    // 1) 上传合成 WhatsApp 导出（Alex ↔ Sam）
    await page.goto("/analyze");
    const fixture = path.join(__dirname, "..", "fixtures", "whatsapp", "android-24h-dmy.txt");
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.locator("#spk-a").fill("Alex");
    await page.locator("#spk-b").fill("Sam");
    await page.getByRole("button", { name: /Continue to free preview/i }).click();

    // 2) 免费三卡（本地解析结果）
    await expect(page).toHaveURL(/\/report\/preview/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Your free cards" })).toBeVisible();
    await expect(page.locator(".free-card")).toHaveCount(3);

    // 3) mock 结账（AC-7.2：勾选 EU 撤回权弃权后才能支付）
    await page.getByRole("link", { name: /Unlock full report/i }).click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Refund Policy" })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Pay \$14\.99/i }).click();

    // 4) 回到报告页：应渲染真实六章（不是 demo 文案）
    await expect(page).toHaveURL(/\/report\?/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "At a glance" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Attachment picture").first()).toBeVisible();
    await expect(page.getByText("Communication health").first()).toBeVisible();
    await expect(page.getByText(/Demo report/i)).toHaveCount(0);

    // 5) W3-1：mock 订单下退款/删除服务端动作禁用，仅本地删除可用
    await expect(page.getByTestId("refund-button")).toBeDisabled();
    await expect(page.getByTestId("delete-button")).toBeDisabled();
    await expect(page.getByText("Only available for paid orders").first()).toBeVisible();

    await page.getByTestId("delete-local-button").first().click();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.getByText("This analysis has been removed from this browser.")).toBeVisible();

    const storage = await page.evaluate(() => {
      const read = (k: string) =>
        window.sessionStorage.getItem(k) ?? window.localStorage.getItem(k);
      return { features: read("tell:features:v1"), lastInput: read("tell:lastInput") };
    });
    expect(storage.features).toBeNull();
    expect(storage.lastInput).toBeNull();
  });
});
