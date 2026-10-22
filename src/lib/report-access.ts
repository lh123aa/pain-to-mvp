/**
 * 报告访问门（纯逻辑，无 React / 无网络）
 * ======================================
 * `/report` 页在渲染报告前必须回答一个问题：这次访问凭什么看报告？
 * 本模块把「从 URL / 运行模式推导访问决策」的逻辑抽出来，页面只负责执行决策：
 *
 *   1. `decideInitialAccess()`   —— 根据 URL 参数 + live/mock 模式，决定：
 *        先验 token / 先验 order_id / 直接 mock 演示 / 等待态 / 无效态
 *   2. `interpretVerifyResponse()` —— 把 `/api/verify-magic-link` 的 (status, body)
 *        翻译成 展示报告 / 等待 / 无效
 *
 * 硬规则（P1 审计缺陷的修复点）：
 * - live 模式下 `?checkout=PENDING`、无凭证、或凭证验证失败 → **绝不**回落到
 *   DEMO_REPORT，只能显示等待态 / 无效态；
 * - mock 模式保持现有演示体验（MOCK- 订单 / preview / 裸访问都可直接看演示报告）。
 *
 * live/mock 判定说明（Next 客户端限制）：
 *   `LEMON_SQUEEZY_LIVE` 是服务端 env，客户端 bundle 读不到（只有 NEXT_PUBLIC_* 会内联）。
 *   因此客户端用两条信号：
 *     1. `NEXT_PUBLIC_LEMON_SQUEEZY_LIVE=true`（部署时与 LEMON_SQUEEZY_LIVE 一起配）；
 *     2. checkout 页跳转 LS 前写入 sessionStorage 的 `tell:checkout-mode`。
 *   另外 `?checkout=PENDING` 本身就是 live 支付回跳的标志，无论信号如何都判等待态。
 */

export type AccessMode = "live" | "mock";

/** checkout 页写入、report 页读取的 sessionStorage key */
export const CHECKOUT_MODE_STORAGE_KEY = "tell:checkout-mode";
/** checkout 页记录的 LS checkout id（等待态展示参考号用） */
export const CHECKOUT_ID_STORAGE_KEY = "tell:checkout-id";

export type InvalidReason =
  | "expired"
  | "invalid"
  | "revoked"
  | "not-found"
  | "error";

export type WaitingReason = "payment-pending" | "missing-credential";

export type ReportAccessDecision =
  | { kind: "verify-token"; token: string }
  | { kind: "verify-order"; orderId: string }
  | { kind: "show-report"; source: "mock" | "token" | "order" }
  | { kind: "show-waiting"; reason: WaitingReason }
  | { kind: "show-invalid"; reason: InvalidReason; message?: string };

export type AccessInput = {
  mode: AccessMode;
  token?: string | null;
  /** ?checkout= 参数（mock 流为 MOCK-xxx，live 支付回跳为 PENDING） */
  checkout?: string | null;
  /** ?order_id= 参数（旧版直查） */
  orderId?: string | null;
  /** ?preview= 参数（mock 演示数据） */
  preview?: string | null;
};

const PENDING_SENTINEL = "PENDING";
const MOCK_ORDER_PREFIX = "MOCK-";

/** 判断是否 live 运行模式；客户端只应传 NEXT_PUBLIC_ 信号 */
export function detectLiveMode(
  env: {
    NEXT_PUBLIC_LEMON_SQUEEZY_LIVE?: string;
    LEMON_SQUEEZY_LIVE?: string;
  } = {}
): boolean {
  const raw =
    env.NEXT_PUBLIC_LEMON_SQUEEZY_LIVE ?? env.LEMON_SQUEEZY_LIVE ?? "";
  return raw.trim().toLowerCase() === "true";
}

/**
 * 决定「拿到 URL 之后第一步做什么」。
 * 注意顺序：token > PENDING > order_id > checkout(订单号) > mock 演示 > live 等待。
 */
export function decideInitialAccess(input: AccessInput): ReportAccessDecision {
  const token = normalize(input.token);
  if (token) return { kind: "verify-token", token };

  const checkout = normalize(input.checkout);
  const orderId = normalize(input.orderId);
  const preview = normalize(input.preview);

  // live 支付回跳的占位标记：此时 webhook 可能还没处理完 → 等待，不渲染报告
  if (checkout === PENDING_SENTINEL) {
    return { kind: "show-waiting", reason: "payment-pending" };
  }

  if (orderId) return { kind: "verify-order", orderId };

  if (checkout) {
    if (checkout.startsWith(MOCK_ORDER_PREFIX)) {
      // mock 演示订单号只在 mock 模式放行；live 模式绝不渲染 demo
      if (input.mode === "mock") {
        return { kind: "show-report", source: "mock" };
      }
      return {
        kind: "show-invalid",
        reason: "invalid",
        message: "This demo link can't be used on the live site.",
      };
    }
    // LS 若把订单号带回（或用户手动带 checkout=<订单号>），按订单号验证
    return { kind: "verify-order", orderId: checkout };
  }

  // 只有 mock 模式才允许用 preview 数据直接演示
  if (preview && input.mode === "mock") {
    return { kind: "show-report", source: "mock" };
  }

  // mock 模式保持现有体验：裸访问 /report 也展示演示报告
  if (input.mode === "mock") {
    return { kind: "show-report", source: "mock" };
  }

  // live 模式且没有任何有效凭证：等待态（提示查收邮件），绝不回落到 DEMO_REPORT
  return { kind: "show-waiting", reason: "missing-credential" };
}

/**
 * 翻译 `/api/verify-magic-link` 的响应：
 *   200 + ok:true        → 展示报告
 *   202                  → 等待（订单 pending）
 *   401                  → 链接无效 / 过期
 *   403                  → 已退款 / 已取消（访问吊销）
 *   404                  → 订单不存在
 *   其它                 → 通用错误
 */
export function interpretVerifyResponse(
  status: number,
  payload: unknown,
  source: "token" | "order" = "order"
): ReportAccessDecision {
  const body = isRecord(payload) ? payload : {};

  if (status >= 200 && status < 300 && body.ok === true) {
    return { kind: "show-report", source };
  }
  if (status === 202) {
    return { kind: "show-waiting", reason: "payment-pending" };
  }
  if (status === 401) {
    return {
      kind: "show-invalid",
      reason: body.reason === "expired" ? "expired" : "invalid",
      message: readMessage(body),
    };
  }
  if (status === 403) {
    return {
      kind: "show-invalid",
      reason: "revoked",
      message: readMessage(body),
    };
  }
  if (status === 404) {
    return { kind: "show-invalid", reason: "not-found", message: readMessage(body) };
  }
  return {
    kind: "show-invalid",
    reason: "error",
    message: readMessage(body),
  };
}

export type VerifiedOrderView = {
  orderId: string;
  status: string;
  custom: Record<string, unknown>;
};

/**
 * 从 verify 响应里取出渲染报告所需的最小订单信息（custom 用于重建报告）。
 * 响应形状不对时返回 null，页面按「无订单数据」处理。
 */
export function extractVerifiedOrder(payload: unknown): VerifiedOrderView | null {
  if (!isRecord(payload)) return null;
  const order = isRecord(payload.order) ? payload.order : null;
  if (!order) return null;

  const orderId = typeof order.orderId === "string" ? order.orderId : "";
  const status = typeof order.status === "string" ? order.status : "";
  const custom = isRecord(order.custom) ? order.custom : {};

  if (!orderId) return null;
  return { orderId, status, custom };
}

/* ===== 内部工具 ===== */

function normalize(value: string | null | undefined): string {
  return (value || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMessage(body: Record<string, unknown>): string | undefined {
  if (typeof body.error === "string" && body.error.trim()) return body.error;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return undefined;
}
