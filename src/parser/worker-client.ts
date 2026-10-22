/**
 * Web Worker 解析客户端（W5-6）
 *
 * 职责：
 * - 懒创建 dedicated worker（模块顶层不碰 window/Worker，SSR 安全），按 id 配对并发请求；
 * - 默认 20s 超时；Worker 不可用 / 创建失败 / 运行时报错 / 超时 → **自动 fallback 到主线程同步解析**
 *   （复用 worker-core.handleParseRequest，功能不丢、错误态与走 worker 时一致）；
 * - terminate() 释放 worker 并把未完成请求结算到同步 fallback，避免 UI 卡在 busy。
 *
 * 协议（与 worker.ts 一一对应，双方共用这里的类型与常量）：
 *   → { type: "parse", id, text, source, dateOrder? }
 *   ← { type: "result", response: ParseResponse }
 *
 * 测试注入点：`workerFactory`（fake worker）+ `fallback`（记录是否被调用），
 * 生产环境两者都用默认实现，因此测试覆盖的就是真实协议。
 */
import { handleParseRequest } from "./worker-core";
import type { ParseResponse, WorkerParseRequest } from "./worker-core";

/** 默认超时：与 task 约定一致（20s）。超时即视为 worker 不健康，走同步 fallback。 */
export const DEFAULT_PARSE_TIMEOUT_MS = 20_000;

export const PARSE_MESSAGE_TYPE = "parse" as const;
export const RESULT_MESSAGE_TYPE = "result" as const;

export interface WorkerRequestMessage extends WorkerParseRequest {
  type: typeof PARSE_MESSAGE_TYPE;
}

export interface WorkerResultMessage {
  type: typeof RESULT_MESSAGE_TYPE;
  response: ParseResponse;
}

/** worker 事件监听器签名（只用到 message/error；测试 fake worker 也实现这个形状）。 */
export type WorkerEventListener = (event: { data?: unknown }) => void;

/** Web Worker 的最小子集（避免测试依赖 DOM 的完整 Worker 类型）。 */
export interface WorkerLike {
  postMessage(message: WorkerRequestMessage): void;
  terminate(): void;
  addEventListener(type: string, listener: WorkerEventListener): void;
  removeEventListener?(type: string, listener: WorkerEventListener): void;
}

/** 最近一次请求实际走的路径：worker / 主线程同步 fallback / 还没跑过。 */
export type ParseTransport = "none" | "worker" | "sync";

export interface ParseWorkerOptions {
  timeoutMs?: number;
  workerFactory?: () => WorkerLike;
  /** 同步兜底实现（默认 handleParseRequest；测试可注入 sentinel）。 */
  fallback?: (request: WorkerParseRequest) => ParseResponse;
}

export interface ParseWorker {
  parse(request: WorkerParseRequest): Promise<ParseResponse>;
  terminate(): void;
  readonly transport: ParseTransport;
}

interface PendingEntry {
  request: WorkerParseRequest;
  resolve: (response: ParseResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 默认 worker 工厂。`new Worker(new URL(...), { type: "module" })` 是 Next.js（Turbopack/webpack）
 * 识别并打包 worker 的标准字面量写法；这里只在浏览器端被调用（SSR/测试不会执行）。
 */
function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function failureResponse(request: WorkerParseRequest, error: unknown): ParseResponse {
  return {
    id: request.id,
    ok: false,
    detection: null,
    chat: null,
    issues: [],
    error: {
      code: "parse-error",
      message: error instanceof Error ? error.message : "The parser stopped unexpectedly",
    },
  };
}

export function createParseWorker(options: ParseWorkerOptions = {}): ParseWorker {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
  const fallback = options.fallback ?? handleParseRequest;
  const factory = options.workerFactory ?? defaultWorkerFactory;
  const hasCustomFactory = options.workerFactory !== undefined;

  const pending = new Map<number, PendingEntry>();
  let worker: WorkerLike | null = null;
  let disposed = false;
  // 自定义 factory 时假定"可用"（测试环境没有全局 Worker）；否则按全局能力探测。
  let unavailable = !hasCustomFactory && typeof Worker === "undefined";
  let transport: ParseTransport = "none";

  function settleWithFallback(request: WorkerParseRequest): ParseResponse {
    transport = "sync";
    try {
      return fallback(request);
    } catch (error) {
      return failureResponse(request, error);
    }
  }

  function settlePendingWithFallback(): void {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.resolve(settleWithFallback(entry.request));
    }
  }

  function onMessage(event: { data?: unknown }): void {
    const data = event.data;
    if (!isRecord(data) || data.type !== RESULT_MESSAGE_TYPE || !isRecord(data.response)) return;
    const response = data.response as unknown as ParseResponse;
    if (typeof response.id !== "number") return;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    transport = "worker";
    entry.resolve(response);
  }

  function onWorkerError(): void {
    // 运行时报错（含 worker 模块加载失败）：永久降级到同步 fallback。
    unavailable = true;
    destroyWorker();
    settlePendingWithFallback();
  }

  function destroyWorker(): void {
    if (!worker) return;
    const current = worker;
    worker = null;
    try {
      current.removeEventListener?.("message", onMessage);
      current.removeEventListener?.("error", onWorkerError);
    } catch {
      // 某些旧实现不支持 removeEventListener；terminate 仍会释放。
    }
    try {
      current.terminate();
    } catch {
      // 忽略 terminate 自身异常：worker 可能已死。
    }
  }

  function ensureWorker(): WorkerLike | null {
    if (worker) return worker;
    if (disposed || unavailable) return null;
    try {
      const created = factory();
      created.addEventListener("message", onMessage);
      created.addEventListener("error", onWorkerError);
      worker = created;
      return created;
    } catch {
      // 构造失败（旧浏览器、CSP、测试注入抛错）→ 永久降级。
      unavailable = true;
      return null;
    }
  }

  function parse(request: WorkerParseRequest): Promise<ParseResponse> {
    if (disposed || unavailable) return Promise.resolve(settleWithFallback(request));
    const active = ensureWorker();
    if (!active) return Promise.resolve(settleWithFallback(request));

    return new Promise<ParseResponse>((resolve) => {
      const timer = setTimeout(() => {
        if (!pending.has(request.id)) return;
        pending.delete(request.id);
        // 超时视为 worker 不健康：杀掉并重建下次机会，本次请求用同步 fallback 保证有结果。
        destroyWorker();
        resolve(settleWithFallback(request));
      }, timeoutMs);

      pending.set(request.id, { request, resolve, timer });

      try {
        active.postMessage({ type: PARSE_MESSAGE_TYPE, ...request });
        transport = "worker";
      } catch {
        pending.delete(request.id);
        clearTimeout(timer);
        destroyWorker();
        resolve(settleWithFallback(request));
      }
    });
  }

  function terminate(): void {
    if (disposed) return;
    disposed = true;
    destroyWorker();
    // 不把 UI 卡在 busy：未完成请求用同步 fallback 结算。
    settlePendingWithFallback();
  }

  return {
    parse,
    terminate,
    get transport(): ParseTransport {
      return transport;
    },
  };
}
