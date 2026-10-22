/**
 * PostHog EU 最小上报器测试（W3-6）
 *
 * 覆盖任务验收点：
 * - 无 `NEXT_PUBLIC_POSTHOG_KEY` → 完全 no-op（不 fetch、不碰 sessionStorage）；
 * - PII 白名单：未知键/对象/超长或含空格的文本一律丢弃，已知枚举/数字/布尔保留；
 * - 事件名原样透传（不改写）；
 * - `$pageview` 只带 path，`?token=` / `?order_id=` / `#hash` 不会进入上报体；
 * - `initPostHog` 重复调用幂等（同一个实例、同一个匿名 distinct_id）；
 * - host 归一化（eu.posthog.com → eu.i.posthog.com）与 `/capture/` URL 拼接。
 *
 * 全部用注入的 fetch 实现，不 mock 真实 SDK，也不发真实网络请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALLOWED_PROPERTY_KEYS,
  ANON_ID_STORAGE_KEY,
  DEFAULT_POSTHOG_HOST,
  capture,
  capturePageView,
  createPostHogClient,
  initPostHog,
  isPostHogEnabled,
  resetPostHogForTests,
  resolveCaptureUrl,
  resolveHost,
  sanitizePath,
  sanitizeProperties,
  type PostHogFetch,
} from "@/lib/posthog";

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function makeRecorder() {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return {} as Response;
  }) as unknown as PostHogFetch;
  return { calls, fetchImpl };
}

function propertiesOf(call: CapturedCall): Record<string, unknown> {
  return (call.body.properties ?? {}) as Record<string, unknown>;
}

function memoryStorage() {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
  return storage as unknown as Storage;
}

/** 清空注入的请求微任务队列（capture 内部是 fire-and-forget）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
  resetPostHogForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPostHogForTests();
});

describe("无 key → 完全 no-op", () => {
  it("createPostHogClient(key: '') 的 capture/pageview 不发请求", () => {
    const recorder = makeRecorder();
    const client = createPostHogClient({ key: "", fetchImpl: recorder.fetchImpl });

    expect(client.isEnabled()).toBe(false);
    client.capture("landing_view", { utm: "newsletter" });
    client.pageview("/report?token=SECRET");

    expect(recorder.calls).toHaveLength(0);
  });

  it("env 无 key 时模块级 capture/capturePageView 完全 no-op（也不碰 storage）", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const store = memoryStorage();
    const getItem = vi.spyOn(store, "getItem");
    const setItem = vi.spyOn(store, "setItem");
    vi.stubGlobal("sessionStorage", store);

    expect(isPostHogEnabled()).toBe(false);
    capture("landing_view", { utm: "newsletter" });
    capturePageView("/report?token=SECRET");
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("事件名透传与请求体形状", () => {
  it("event 原样透传，属性经白名单后写入 /capture/", async () => {
    const recorder = makeRecorder();
    const client = createPostHogClient({
      key: "phc_test",
      fetchImpl: recorder.fetchImpl,
    });

    expect(client.isEnabled()).toBe(true);
    client.capture("checkout_view", { mock: true, mode: "mock" });
    await flush();

    expect(recorder.calls).toHaveLength(1);
    const [call] = recorder.calls;
    expect(call?.url).toBe("https://eu.i.posthog.com/capture/");
    expect(call?.body.api_key).toBe("phc_test");
    expect(call?.body.event).toBe("checkout_view");
    expect(call?.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const properties = propertiesOf(call as CapturedCall);
    expect(properties.mock).toBe(true);
    expect(properties.mode).toBe("mock");
    expect(typeof properties.distinct_id).toBe("string");
    expect(String(properties.distinct_id).length).toBeGreaterThan(0);
  });

  it("真实调用方事件名密集透传（免费预览/报告/退款删除）", async () => {
    const recorder = makeRecorder();
    const client = createPostHogClient({ key: "phc_test", fetchImpl: recorder.fetchImpl });
    for (const event of [
      "freecards_view",
      "freecards_buy_click",
      "report_view",
      "report_waiting",
      "report_invalid",
      "report_refund",
      "report_delete",
    ]) {
      client.capture(event, {});
    }
    await flush();
    expect(recorder.calls.map((call) => call.body.event)).toEqual([
      "freecards_view",
      "freecards_buy_click",
      "report_view",
      "report_waiting",
      "report_invalid",
      "report_refund",
      "report_delete",
    ]);
  });
});

describe("PII 白名单过滤", () => {
  it("未知键（文件名/说话人/正文/邮箱等）一律丢弃", () => {
    const sanitized = sanitizeProperties({
      fileName: "secret-chat.txt",
      speakerA: "Alex",
      speakerB: "Sam",
      text: "we should break up",
      pasted: "Alex: hi",
      email: "alex@example.com",
      distinct_id: "user-override-attempt",
      token: "SECRET",
      order_id: "ord_123",
      report: { attachment: "anxious" },
      tags: ["a", "b"],
    });

    expect(sanitized).toEqual({});
    expect(ALLOWED_PROPERTY_KEYS).not.toContain("fileName");
    expect(ALLOWED_PROPERTY_KEYS).not.toContain("text");
    expect(ALLOWED_PROPERTY_KEYS).not.toContain("email");
  });

  it("已知枚举/数字/布尔保留", () => {
    const sanitized = sanitizeProperties({
      mode: "live",
      kind: "file",
      reason: "group-chat",
      source: "mock",
      platform: "whatsapp",
      dateOrder: "DMY",
      order: "MDY",
      grade: "B",
      storage: "session",
      position: "hero",
      messages: 1234,
      candidates: 2,
      senders: 3,
      size: 1024,
      bytes: 4096,
      status: 200,
      step: 3,
      price: 14.99,
      score: 81.4,
      confidence: 0.62,
      durationDays: 12.5,
      ok: true,
      mock: false,
      timed: true,
      degraded: false,
      alreadyDone: true,
      hasFile: true,
      hasPaste: false,
      utm: "newsletter",
    });

    expect(sanitized).toMatchObject({
      mode: "live",
      kind: "file",
      reason: "group-chat",
      messages: 1234,
      confidence: 0.62,
      ok: true,
      mock: false,
      utm: "newsletter",
    });
    expect(Object.keys(sanitized).sort()).toEqual(
      [
        "mode",
        "kind",
        "reason",
        "source",
        "platform",
        "dateOrder",
        "order",
        "grade",
        "storage",
        "position",
        "messages",
        "candidates",
        "senders",
        "size",
        "bytes",
        "status",
        "step",
        "price",
        "score",
        "confidence",
        "durationDays",
        "ok",
        "mock",
        "timed",
        "degraded",
        "alreadyDone",
        "hasFile",
        "hasPaste",
        "utm",
      ].sort(),
    );
  });

  it("任意文本/超长/含空格/类型不符的值丢弃", () => {
    const sanitized = sanitizeProperties({
      // 枚举键塞自由文本 → 丢
      reason: "my ex Sam said this",
      mode: "timed ",
      grade: "A+",
      platform: "Instagram DM",
      // 短串键：URL/空格/超长 → 丢
      utm: "https://evil.example/?email=alex@example.com",
      // 数值越界 / 非有限 / 非整数计数 → 丢
      confidence: 1.5,
      score: Number.NaN,
      messages: 12.5,
      messagesNegative: -1,
      size: Number.POSITIVE_INFINITY,
      status: 999,
      // 类型不符 → 丢
      ok: "true",
      timed: 1,
      path: { href: "/report?token=SECRET" },
      hasFile: null,
      unknown: "anything",
    });

    expect(sanitized).toEqual({});
  });

  it("字符串里的个人信息不会穿过已知键（reason 只认枚举值）", () => {
    const sanitized = sanitizeProperties({
      reason: "alex@example.com",
      kind: "file",
    });
    expect(sanitized).toEqual({ kind: "file" });
  });
});

describe("pageview 只带 path（token/order_id 不外泄）", () => {
  it("sanitizePath 去掉 query/hash 与绝对 URL 前缀", () => {
    expect(sanitizePath("/report?token=SECRET&order_id=ord_123")).toBe("/report");
    expect(sanitizePath("/report/preview?token=SECRET#top")).toBe("/report/preview");
    expect(sanitizePath("https://thetell.app/report?token=SECRET")).toBe("/report");
    expect(sanitizePath("/analyze")).toBe("/analyze");
    expect(sanitizePath("  /checkout  ")).toBe("/checkout");
    expect(sanitizePath("")).toBe("/");
    expect(sanitizePath(undefined)).toBe("/");
  });

  it("capturePageView 的上报体只有 $pageview + path", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    resetPostHogForTests();
    const recorder = makeRecorder();
    initPostHog({ fetchImpl: recorder.fetchImpl });

    capturePageView("/report?token=SECRET&order_id=ord_123&email=alex@example.com#frag");
    await flush();

    expect(recorder.calls).toHaveLength(1);
    const [call] = recorder.calls;
    expect(call?.body.event).toBe("$pageview");
    const properties = propertiesOf(call as CapturedCall);
    expect(properties.path).toBe("/report");

    const serialized = JSON.stringify(call?.body);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("order_id");
    expect(serialized).not.toContain("alex@example.com");
    expect(serialized).not.toContain("frag");
  });

  it("track 链路（capture + 白名单）不会把文件名/说话人带进上报体", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    resetPostHogForTests();
    const recorder = makeRecorder();
    initPostHog({ fetchImpl: recorder.fetchImpl });

    capture("upload_pick", {
      kind: "file",
      size: 2048,
      fileName: "secret-chat.txt",
      speakerA: "Alex",
      text: "private message content",
    });
    await flush();

    const [call] = recorder.calls;
    const properties = propertiesOf(call as CapturedCall);
    expect(properties).toMatchObject({ kind: "file", size: 2048 });
    const serialized = JSON.stringify(call?.body);
    expect(serialized).not.toContain("secret-chat.txt");
    expect(serialized).not.toContain("Alex");
    expect(serialized).not.toContain("private message content");
  });
});

describe("init 幂等与匿名 distinct_id", () => {
  it("重复 initPostHog 返回同一实例，且只使用第一次注入的 fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    resetPostHogForTests();
    const first = makeRecorder();
    const second = makeRecorder();

    const a = initPostHog({ fetchImpl: first.fetchImpl });
    const b = initPostHog({ fetchImpl: second.fetchImpl });

    expect(b).toBe(a);
    b.capture("landing_view", { utm: "newsletter" });
    await flush();

    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });

  it("匿名 distinct_id 稳定（同一客户端多次 capture 一致，并落到 sessionStorage）", async () => {
    const store = memoryStorage();
    vi.stubGlobal("sessionStorage", store);
    const recorder = makeRecorder();
    const client = createPostHogClient({
      key: "phc_test",
      fetchImpl: recorder.fetchImpl,
      idFactory: () => "fixed-anon-id",
    });

    client.capture("landing_view", {});
    client.capture("sample_view", {});
    await flush();

    expect(recorder.calls).toHaveLength(2);
    const ids = recorder.calls.map((call) => propertiesOf(call).distinct_id);
    expect(ids).toEqual(["fixed-anon-id", "fixed-anon-id"]);
    expect(store.getItem(ANON_ID_STORAGE_KEY)).toBe("fixed-anon-id");
    // distinct_id 是匿名 id，不含任何用户输入
    expect(store.getItem(ANON_ID_STORAGE_KEY)).not.toMatch(/@|\s/);
  });
});

describe("host 归一化", () => {
  it("PostHog app 域纠正为 EU ingestion 域，并拼 /capture/", () => {
    expect(resolveHost("https://eu.posthog.com")).toBe("https://eu.i.posthog.com");
    expect(resolveHost("https://eu.posthog.com/")).toBe("https://eu.i.posthog.com");
    expect(resolveHost("https://us.posthog.com")).toBe("https://us.i.posthog.com");
    expect(resolveHost("")).toBe(DEFAULT_POSTHOG_HOST);
    expect(resolveHost(undefined)).toBe(DEFAULT_POSTHOG_HOST);
    expect(resolveHost("https://custom.example/")).toBe("https://custom.example");

    expect(resolveCaptureUrl("https://eu.posthog.com")).toBe("https://eu.i.posthog.com/capture/");
    expect(resolveCaptureUrl("")).toBe(`${DEFAULT_POSTHOG_HOST}/capture/`);
  });

  it("env host 若是 app 域，请求仍打到 ingestion 域", async () => {
    const recorder = makeRecorder();
    const client = createPostHogClient({
      key: "phc_test",
      host: "https://eu.posthog.com",
      fetchImpl: recorder.fetchImpl,
    });
    client.capture("landing_view", {});
    await flush();
    expect(recorder.calls[0]?.url).toBe("https://eu.i.posthog.com/capture/");
  });
});

describe("失败安全", () => {
  it("fetch 异步失败 / 同步抛错都不影响调用方", async () => {
    const rejecting = (async () => {
      throw new Error("network down");
    }) as unknown as PostHogFetch;
    const throwing = (() => {
      throw new Error("sync boom");
    }) as unknown as PostHogFetch;

    const asyncClient = createPostHogClient({ key: "phc_test", fetchImpl: rejecting });
    const syncClient = createPostHogClient({ key: "phc_test", fetchImpl: throwing });

    expect(() => asyncClient.capture("landing_view", {})).not.toThrow();
    expect(() => syncClient.capture("landing_view", {})).not.toThrow();
    await flush();
  });

  it("空事件名不发请求", () => {
    const recorder = makeRecorder();
    const client = createPostHogClient({ key: "phc_test", fetchImpl: recorder.fetchImpl });
    client.capture("   ", {});
    expect(recorder.calls).toHaveLength(0);
  });
});
