/**
 * Web Worker 解析核心（W5-6）· 纯函数、可结构化克隆
 *
 * 设计约束：
 * - 这里**不碰任何浏览器 API**（无 window / document / Worker / storage），Node 里可直接单测；
 * - worker.ts（后台线程）与 worker-client.ts 的同步 fallback（主线程）**共用同一个函数**，
 *   保证 "走 Worker" 与 "回退主线程" 两条路径的输出逐字节一致（协议与错误态不分叉）；
 * - 任何异常都转成结构化 `{ ok: false, error: { code, message, hint? } }`，绝不 throw 出本模块；
 * - 返回对象只含普通对象/数组/数字/字符串/null，可被 postMessage 结构化克隆。
 *
 * 解析器选择规则与 /analyze 既有行为保持一致：
 *   detectInputFormat → whatsapp / paste 直接对应；无法识别（unknown）时按输入来源选：
 *   file → WhatsApp 解析器（给 E-3 可行动错误）、paste → 粘贴解析器（给 E-7）。
 */
import type { DateOrder, ParseIssue, ParseResult, ParsedChat } from "./types";
import type { FormatDetection } from "./whatsapp-txt";
import { detectInputFormat, parseWhatsAppTxt } from "./whatsapp-txt";
import { parsePastedText } from "./paste";

/** 输入来自文件还是粘贴（决定 unknown 格式时的解析器选择）。 */
export type ParseRequestSource = "file" | "paste";

export interface WorkerParseRequest {
  /** 请求 id：客户端用它把响应配对回 Promise（支持并发请求）。 */
  id: number;
  text: string;
  source: ParseRequestSource;
  /** 用户在日期确认条选定的顺序；给出后不再推断/不再要求确认。 */
  dateOrder?: DateOrder;
}

/** 解析失败码：E-3/E-7 沿用 PRD 错误态编号；parse-error 为解析器内部异常。 */
export type ParseErrorCode = "E-3" | "E-7" | "parse-error";

export interface ParseErrorInfo {
  code: ParseErrorCode;
  message: string;
  hint?: string;
}

export interface ParseResponseBase {
  id: number;
  /** 格式探测结果（异常时为 null）。 */
  detection: FormatDetection | null;
  /** 解析器返回的全部 issue（含 warning；UI 错误态与既有一致地读这里）。 */
  issues: ParseIssue[];
}

export interface ParseResponseOk extends ParseResponseBase {
  ok: true;
  chat: ParsedChat;
}

export interface ParseResponseErr extends ParseResponseBase {
  ok: false;
  /**
   * 解析器级失败（如 E-3）会带回已解析的 chat（可能 0 消息），UI 可复用既有错误映射；
   * 内部异常（parse-error）时为 null。
   */
  chat: ParsedChat | null;
  error: ParseErrorInfo;
}

export type ParseResponse = ParseResponseOk | ParseResponseErr;

function errorCodeOf(issue: ParseIssue | undefined): ParseErrorCode {
  if (issue?.code === "E-7") return "E-7";
  if (issue?.code === "E-3") return "E-3";
  return "parse-error";
}

function parseForSource(
  text: string,
  source: ParseRequestSource,
  detection: FormatDetection,
  dateOrder: DateOrder | undefined,
): ParseResult {
  const options = dateOrder === undefined ? {} : { dateOrder };
  if (detection.format === "whatsapp") return parseWhatsAppTxt(text, options);
  if (detection.format === "paste") return parsePastedText(text, options);
  return source === "file" ? parseWhatsAppTxt(text, options) : parsePastedText(text, options);
}

/**
 * 处理一次解析请求。永不抛异常；成功/失败都用可序列化的普通对象表达。
 * 注意：`ok` 表示"解析结果可用"（与 ParseResult.ok 语义一致），不是"传输成功"。
 * 解析器判定失败（如找不到时间戳 E-3）时仍然带回 chat，方便 UI 走既有错误文案。
 */
export function handleParseRequest(request: WorkerParseRequest): ParseResponse {
  const { id } = request;
  try {
    const detection = detectInputFormat(request.text);
    const parsed = parseForSource(request.text, request.source, detection, request.dateOrder);
    if (parsed.ok) {
      return { id, ok: true, detection, chat: parsed.chat, issues: parsed.issues };
    }
    const errorIssue = parsed.issues.find((issue) => issue.severity === "error");
    return {
      id,
      ok: false,
      detection,
      chat: parsed.chat,
      issues: parsed.issues,
      error: {
        code: errorCodeOf(errorIssue),
        message: errorIssue?.message ?? "We couldn’t parse this conversation",
        ...(errorIssue?.hint === undefined ? {} : { hint: errorIssue.hint }),
      },
    };
  } catch (error) {
    return {
      id,
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
}
