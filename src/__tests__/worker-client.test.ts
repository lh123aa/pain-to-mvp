/**
 * worker-client 单测（W5-6）
 *
 * 用 fake Worker 覆盖真实消息协议、并发 id 配对、超时、worker error、factory 抛错、
 * terminate 结算；用 node 环境（无全局 Worker）覆盖自动 fallback 到同步 handleParseRequest。
 * 不启动真实浏览器 Worker —— 协议与回退策略在这里被完整验证。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleParseRequest } from "@/parser/worker-core";
import type { ParseResponse, WorkerParseRequest } from "@/parser/worker-core";
import {
  DEFAULT_PARSE_TIMEOUT_MS,
  PARSE_MESSAGE_TYPE,
  RESULT_MESSAGE_TYPE,
  createParseWorker,
} from "@/parser/worker-client";
import type { WorkerEventListener, WorkerLike, WorkerRequestMessage } from "@/parser/worker-client";

const REQUEST: WorkerParseRequest = {
  id: 7,
  text: "[15/11/2025, 09:00:00] Alex: hi\n[15/11/2025, 09:01:00] Sam: hey",
  source: "file",
};

function realResponse(request: WorkerParseRequest): ParseResponse {
  return handleParseRequest(request);
}

class FakeWorker implements WorkerLike {
  readonly posted: WorkerRequestMessage[] = [];
  terminated = false;
  private readonly listeners = new Map<string, WorkerEventListener[]>();

  postMessage(message: WorkerRequestMessage): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: string, listener: WorkerEventListener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: WorkerEventListener): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existing.filter((candidate) => candidate !== listener),
    );
  }

  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  respond(response: ParseResponse): void {
    this.emit("message", { data: { type: RESULT_MESSAGE_TYPE, response } });
  }

  fail(): void {
    this.emit("error", {});
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("worker-client · worker protocol", () => {
  it("posts the parse request to the worker and resolves the matching response", async () => {
    const fake = new FakeWorker();
    const client = createParseWorker({ workerFactory: () => fake });

    const pending = client.parse(REQUEST);
    expect(fake.posted).toEqual([{ type: PARSE_MESSAGE_TYPE, ...REQUEST }]);
    expect(client.transport).toBe("worker");

    const response = realResponse(REQUEST);
    fake.respond(response);
    await expect(pending).resolves.toEqual(response);
    expect(client.transport).toBe("worker");
    client.terminate();
  });

  it("ignores malformed or mismatched worker messages until the right id arrives", async () => {
    const fake = new FakeWorker();
    const client = createParseWorker({ workerFactory: () => fake });
    const pending = client.parse(REQUEST);

    fake.emit("message", { data: { type: "something-else" } });
    fake.emit("message", { data: { type: RESULT_MESSAGE_TYPE, response: { id: 999 } } });
    fake.emit("message", { data: null });

    const response = realResponse(REQUEST);
    fake.respond(response);
    await expect(pending).resolves.toEqual(response);
    client.terminate();
  });

  it("pairs concurrent requests by id even when responses arrive out of order", async () => {
    const fake = new FakeWorker();
    const client = createParseWorker({ workerFactory: () => fake });
    const firstRequest: WorkerParseRequest = { ...REQUEST, id: 101 };
    const secondRequest: WorkerParseRequest = { ...REQUEST, id: 102, text: "Me: a\nYou: b" };

    const first = client.parse(firstRequest);
    const second = client.parse(secondRequest);

    const secondResponse = realResponse(secondRequest);
    const firstResponse = realResponse(firstRequest);
    fake.respond(secondResponse);
    fake.respond(firstResponse);

    await expect(first).resolves.toEqual(firstResponse);
    await expect(second).resolves.toEqual(secondResponse);
    client.terminate();
  });
});

describe("worker-client · timeout and error fallback", () => {
  it("falls back to the sync implementation after the timeout and terminates the worker", async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker();
    const fallback = vi.fn((request: WorkerParseRequest) => realResponse(request));
    const client = createParseWorker({ workerFactory: () => fake, fallback, timeoutMs: 50 });

    const pending = client.parse(REQUEST);
    expect(fallback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(51);

    await expect(pending).resolves.toEqual(realResponse(REQUEST));
    expect(fallback).toHaveBeenCalledWith(REQUEST);
    expect(fake.terminated).toBe(true);
    expect(client.transport).toBe("sync");
    client.terminate();
  });

  it("falls back when the worker emits an error event and stays degraded", async () => {
    const fake = new FakeWorker();
    let factoryCalls = 0;
    const fallback = vi.fn((request: WorkerParseRequest) => realResponse(request));
    const client = createParseWorker({
      workerFactory: () => {
        factoryCalls += 1;
        return fake;
      },
      fallback,
    });

    const pending = client.parse(REQUEST);
    fake.fail();
    await expect(pending).resolves.toEqual(realResponse(REQUEST));
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fake.terminated).toBe(true);
    expect(client.transport).toBe("sync");

    // 已降级：后续请求不再创建 worker，直接同步 fallback。
    const again = await client.parse({ ...REQUEST, id: 8 });
    expect(again.ok).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(factoryCalls).toBe(1);
    client.terminate();
  });

  it("falls back when the worker factory throws (CSP / legacy browser)", async () => {
    const fallback = vi.fn((request: WorkerParseRequest) => realResponse(request));
    const client = createParseWorker({
      workerFactory: () => {
        throw new Error("worker blocked");
      },
      fallback,
    });

    const response = await client.parse(REQUEST);
    expect(response.ok).toBe(true);
    expect(fallback).toHaveBeenCalledWith(REQUEST);
    expect(client.transport).toBe("sync");
    client.terminate();
  });

  it("resolves fallback even when the fallback itself throws (never rejects)", async () => {
    const fake = new FakeWorker();
    const client = createParseWorker({
      workerFactory: () => fake,
      fallback: () => {
        throw new Error("sync parser unavailable");
      },
    });

    const pending = client.parse(REQUEST);
    fake.fail(); // worker 出错 → 触发 fallback；fallback 抛错也必须 resolve 成结构化错误

    const response = await pending;
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error("expected a parse-error fallback");
    expect(response.chat).toBeNull();
    expect(response.error.code).toBe("parse-error");
    expect(response.error.message).toContain("sync parser unavailable");
    client.terminate();
  });
});

describe("worker-client · unavailable Worker (node / legacy)", () => {
  it("uses the real sync parser when no Worker global exists", async () => {
    expect(typeof Worker).toBe("undefined"); // node 环境：这就是旧浏览器/测试的等价路径
    const client = createParseWorker();
    const response = await client.parse(REQUEST);

    expect(response.ok).toBe(true);
    expect(response.chat?.meta.messageCount).toBe(2);
    expect(client.transport).toBe("sync");
    client.terminate();
  });

  it("terminate settles pending requests through the fallback without hanging", async () => {
    const fake = new FakeWorker();
    const fallback = vi.fn((request: WorkerParseRequest) => realResponse(request));
    const client = createParseWorker({ workerFactory: () => fake, fallback });

    const pending = client.parse(REQUEST);
    client.terminate();

    await expect(pending).resolves.toEqual(realResponse(REQUEST));
    expect(fallback).toHaveBeenCalledWith(REQUEST);
    expect(fake.terminated).toBe(true);

    // terminate 后再 parse：走同步 fallback，不会抛错/新建 worker。
    const after = await client.parse({ ...REQUEST, id: 9 });
    expect(after.ok).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(2);
    client.terminate(); // 幂等
  });

  it("exposes the agreed default timeout", () => {
    expect(DEFAULT_PARSE_TIMEOUT_MS).toBe(20_000);
  });
});
