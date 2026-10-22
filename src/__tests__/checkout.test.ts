import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCheckoutBody,
  createCheckout,
  type CheckoutRequest,
  type LemonCheckoutBody,
} from "@/lib/checkout";

/**
 * checkout.ts 单测（全部离线：fetch 一律 mock，不发真实网络请求）
 *
 * 覆盖：
 * - mock 分支：无 env 时本地伪造，URL / id / price 结构不变
 * - live 分支：Lemon Squeezy v1 JSON:API 的 URL / header / body 形状
 * - live 分支：从 data.attributes.url 取 URL（旧版 checkout_url 的错误口径回归）
 * - 失败路径：HTTP 非 2xx、响应缺 url、store/variant 未配置
 */

const BASE_URL = "https://thetell.app";

const MANAGED_ENV = [
  "LEMON_SQUEEZY_API_KEY",
  "LEMON_SQUEEZY_STORE_ID",
  "LEMON_SQUEEZY_VARIANT_ID",
  "LEMON_SQUEEZY_LIVE",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of MANAGED_ENV) ORIGINAL_ENV[key] = process.env[key];

/** 注入式 fetch mock：createCheckout 的 options.fetchImpl，测试不碰全局 fetch */
function createFetchMock() {
  return vi.fn<typeof fetch>();
}

let fetchMock: ReturnType<typeof createFetchMock>;

const baseRequest: CheckoutRequest = {
  fileName: "chat.txt",
  speakerA: "Alex",
  speakerB: "Sam",
  pasted: "hello",
  email: "buyer@example.com",
};

function clearManagedEnv(): void {
  for (const key of MANAGED_ENV) delete process.env[key];
}

function restoreManagedEnv(): void {
  for (const key of MANAGED_ENV) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configureLive(): void {
  process.env.LEMON_SQUEEZY_API_KEY = "test_api_key";
  process.env.LEMON_SQUEEZY_STORE_ID = "store_123";
  process.env.LEMON_SQUEEZY_VARIANT_ID = "variant_456";
  process.env.LEMON_SQUEEZY_LIVE = "true";
}

function jsonApiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
}

beforeEach(() => {
  clearManagedEnv();
  fetchMock = createFetchMock();
});

afterEach(() => {
  restoreManagedEnv();
});

describe("createCheckout — mock 模式", () => {
  it("无 LEMON_SQUEEZY_* env 时返回 mock URL，且不发任何网络请求", async () => {
    const result = await createCheckout(baseRequest, BASE_URL, {
      fetchImpl: fetchMock,
    });

    expect(result.mock).toBe(true);
    expect(result.checkoutId).toMatch(/^MOCK-[A-Z0-9]+$/);
    expect(result.url).toBe(
      `${BASE_URL}/report?checkout=${result.checkoutId}&preview=${encodeURIComponent(
        Buffer.from(JSON.stringify(baseRequest), "utf8").toString("base64url")
      )}`
    );
    expect(result.priceUsd).toBe(14.99);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createCheckout — live 模式（Lemon Squeezy v1 JSON:API）", () => {
  it("按 JSON:API 形状 POST /v1/checkouts，并从 data.attributes.url 取 URL", async () => {
    configureLive();
    fetchMock.mockResolvedValueOnce(
      jsonApiResponse({
        data: {
          type: "checkouts",
          id: "chk_789",
          attributes: { url: "https://store.lemonsqueezy.com/buy/abc123" },
        },
      })
    );

    const result = await createCheckout(baseRequest, BASE_URL, {
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      mock: false,
      url: "https://store.lemonsqueezy.com/buy/abc123",
      checkoutId: "chk_789",
      priceUsd: 14.99,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test_api_key");
    expect(headers.Accept).toBe("application/vnd.api+json");
    expect(headers["Content-Type"]).toBe("application/vnd.api+json");

    const body = JSON.parse(String(init.body)) as LemonCheckoutBody;
    // 顶层必须包在 { data: {...} } 的 JSON:API envelope 里
    expect(body.data.type).toBe("checkouts");
    expect(body.data.relationships.store.data).toEqual({
      type: "stores",
      id: "store_123",
    });
    expect(body.data.relationships.variant.data).toEqual({
      type: "variants",
      id: "variant_456",
    });
    expect(body.data.attributes.checkout_data.email).toBe("buyer@example.com");
    expect(body.data.attributes.checkout_data.custom).toEqual({
      fileName: "chat.txt",
      speakerA: "Alex",
      speakerB: "Sam",
      pastedLen: "5",
    });
    // redirect_url 属于 product_options，不在 checkout_data 里
    expect(body.data.attributes.product_options.redirect_url).toBe(
      `${BASE_URL}/report?checkout=PENDING`
    );
    // 回归：旧错误形状 { variant_id, checkout_data } 不应再出现
    const legacyBody = body as unknown as Record<string, unknown>;
    expect(legacyBody).not.toHaveProperty("variant_id");
    expect(legacyBody).not.toHaveProperty("checkout_data");
  });

  it("HTTP 非 2xx 时抛错", async () => {
    configureLive();
    fetchMock.mockResolvedValueOnce(
      new Response("invalid variant", { status: 422 })
    );

    await expect(
      createCheckout(baseRequest, BASE_URL, { fetchImpl: fetchMock })
    ).rejects.toThrow(/Lemon Squeezy checkout 创建失败 \(HTTP 422\)/);
  });

  it("响应缺少 data.attributes.url 时抛错（而不是静默返回空 URL）", async () => {
    configureLive();
    fetchMock.mockResolvedValueOnce(
      jsonApiResponse({ data: { type: "checkouts", id: "chk_1", attributes: {} } })
    );

    await expect(
      createCheckout(baseRequest, BASE_URL, { fetchImpl: fetchMock })
    ).rejects.toThrow(/data\.attributes\.url/);
  });

  it("LEMON_SQUEEZY_LIVE=true 但缺 store/variant 时在请求前抛错", async () => {
    process.env.LEMON_SQUEEZY_API_KEY = "test_api_key";
    process.env.LEMON_SQUEEZY_LIVE = "true";

    await expect(
      createCheckout(baseRequest, BASE_URL, { fetchImpl: fetchMock })
    ).rejects.toThrow(/LEMON_SQUEEZY_STORE_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildCheckoutBody", () => {
  it("纯函数形状：custom 值全部转成字符串，email 可省略", () => {
    const body = buildCheckoutBody(
      { fileName: "a.txt", speakerA: "A", speakerB: "B" },
      { storeId: "1", variantId: "2", redirectUrl: "https://x/report" }
    );

    expect(body.data.type).toBe("checkouts");
    expect(body.data.attributes.checkout_data.custom.pastedLen).toBe("0");
    expect(body.data.attributes.checkout_data.email).toBeUndefined();
    expect(body.data.attributes.product_options.redirect_url).toBe(
      "https://x/report"
    );
  });
});
