/**
 * Dedicated Web Worker 入口（W5-6）
 *
 * 只做消息桥接：收到 `{ type: "parse", id, text, source, dateOrder? }`，
 * 交给纯函数 handleParseRequest，回 `{ type: "result", response }`。
 *
 * 纪律：
 * - 不 import 任何浏览器 API（只用 worker 全局的 self.onmessage / self.postMessage）；
 * - 解析逻辑全部在 worker-core.ts（同一份代码也是主线程 fallback），此文件保持最小；
 * - 任何异常都已由 worker-core 吃掉，这里只做一次兜底 catch 防止 worker 静默死掉。
 *
 * 由 worker-client.ts 通过 `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` 加载。
 */
import { handleParseRequest } from "./worker-core";
import type { ParseResponse, WorkerParseRequest } from "./worker-core";

/** 入站消息：与 worker-client 的 WorkerRequestMessage 协议一致（扁平结构）。 */
export interface WorkerIncomingMessage extends WorkerParseRequest {
  type: "parse";
}

/** 出站消息：与 worker-client 的 WorkerResultMessage 协议一致。 */
export interface WorkerOutgoingMessage {
  type: "result";
  response: ParseResponse;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerIncomingMessage>) => void) | null;
  postMessage: (message: WorkerOutgoingMessage) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<WorkerIncomingMessage>) => {
  const data = event.data;
  if (!data || data.type !== "parse" || typeof data.text !== "string") return;

  let response: ParseResponse;
  try {
    response = handleParseRequest({
      id: data.id,
      text: data.text,
      source: data.source,
      ...(data.dateOrder === undefined ? {} : { dateOrder: data.dateOrder }),
    });
  } catch (error) {
    // handleParseRequest 设计上不抛；这里只兜底，避免 worker 静默死掉导致客户端超时。
    response = {
      id: data.id,
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

  scope.postMessage({ type: "result", response });
};
