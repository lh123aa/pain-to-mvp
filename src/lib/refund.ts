/**
 * 退款 provider 抽象（W2-2）
 * ========================
 * `/api/refund` 的流程是：验 token → 7 天窗口 → 调 provider 真退款 → 本地状态机
 * refunded + 吊销魔链。本模块只负责「真退款」这一步，方便：
 *   - 无 LEMON_SQUEEZY_API_KEY 时用 NoopRefundProvider 只做本地吊销（mock / 开发）；
 *   - 单测注入 fetchImpl 或整个 provider，不发真实网络请求；
 *   - 以后换 Paddle / Stripe 只加一个实现。
 *
 * Lemon Squeezy 退款 API（官方文档 https://docs.lemonsqueezy.com/api/orders/issue-refund）：
 *   POST https://api.lemonsqueezy.com/v1/orders/{order_id}/refund
 *   Authorization: Bearer <LEMON_SQUEEZY_API_KEY>
 *   Accept / Content-Type: application/vnd.api+json
 *   返回：退款后的 order 对象（JSON:API）
 *
 * ⚠️ TODO(ls-refund-contract)：官方文档页面未完整给出请求体字段。当前实现按 JSON:API
 *    习惯发送 `{ data: { type: "orders", id, attributes: { amount } } }`（amount 单位为分，
 *    社区 MCP 实现也是传分）。**上线前必须用 Lemon Squeezy Test 模式的一笔真实订单核对
 *    body 字段与响应**；如官方实际要求空 body / 不同字段，只需改 buildRefundRequestBody()
 *    与本文件，路由和测试不用动。
 *    另外：LS 退款成功后还会发 `order_refunded` webhook，本地状态机是幂等的，不冲突。
 */

const LEMON_SQUEEZY_API_BASE = "https://api.lemonsqueezy.com/v1";
const JSON_API_CONTENT_TYPE = "application/vnd.api+json";

/** 无条件退款窗口：7 天（从订单完成时间算起） */
export const REFUND_WINDOW_DAYS = 7;
export const REFUND_WINDOW_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type RefundProviderMode = "lemon-squeezy" | "local";

export type RefundProviderInput = {
  orderId: string;
  /** 退款金额（分）。不传由 provider 决定（当前 LS 走全额时仍建议显式传）。 */
  amountCents?: number;
};

export type RefundProviderResult =
  | {
      ok: true;
      mode: RefundProviderMode;
      /** provider 侧的退款 id（若响应里有；LS 当前返回订单对象，暂无独立 refund id） */
      providerRefundId?: string;
    }
  | {
      ok: false;
      mode: RefundProviderMode;
      error: string;
      /** provider 的 HTTP 状态码（路由可据此映射 404 等） */
      httpStatus?: number;
    };

export interface RefundProvider {
  readonly name: string;
  readonly mode: RefundProviderMode;
  refund(input: RefundProviderInput): Promise<RefundProviderResult>;
}

/**
 * 无 API key 时的本地退款：不调用外部服务，只返回成功让路由做本地吊销。
 */
export class NoopRefundProvider implements RefundProvider {
  readonly name = "noop";
  readonly mode: RefundProviderMode = "local";

  async refund(): Promise<RefundProviderResult> {
    // 忽略入参：本地 mock 不调用外部服务
    return { ok: true, mode: "local" };
  }
}

/**
 * Lemon Squeezy 真实退款。`fetchImpl` 可注入（单测不发网络请求）。
 */
export class LemonSqueezyRefundProvider implements RefundProvider {
  readonly name = "lemon-squeezy";
  readonly mode: RefundProviderMode = "lemon-squeezy";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiBase: string = LEMON_SQUEEZY_API_BASE
  ) {}

  async refund(input: RefundProviderInput): Promise<RefundProviderResult> {
    const url = `${this.apiBase}/orders/${encodeURIComponent(
      input.orderId
    )}/refund`;
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: JSON_API_CONTENT_TYPE,
          "Content-Type": JSON_API_CONTENT_TYPE,
        },
        body: JSON.stringify(
          buildRefundRequestBody(input.orderId, input.amountCents)
        ),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return {
          ok: false,
          mode: "lemon-squeezy",
          error: `Lemon Squeezy refund failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
          httpStatus: res.status,
        };
      }

      // 响应是退款后的 order 对象；refund id 字段官方未文档化，先不做强假设。
      const payload = (await res.json().catch(() => ({}))) as {
        data?: { id?: string };
      };
      return {
        ok: true,
        mode: "lemon-squeezy",
        providerRefundId:
          typeof payload?.data?.id === "string" ? payload.data.id : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        mode: "lemon-squeezy",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * 按环境变量选择退款 provider：有 LS API key → 真退款；没有 → 本地 no-op。
 * 注意：这里只看 key，不看 LEMON_SQUEEZY_LIVE（Test 模式 key 也应该走真退款流程）。
 */
export function getRefundProvider(
  env: Record<string, string | undefined> = process.env
): RefundProvider {
  const apiKey = env.LEMON_SQUEEZY_API_KEY?.trim();
  if (!apiKey) return new NoopRefundProvider();
  return new LemonSqueezyRefundProvider(apiKey);
}

/**
 * 构造 LS 退款请求体（纯函数，便于单测断言；也是 TODO(ls-refund-contract) 的唯一改动点）。
 */
export function buildRefundRequestBody(
  orderId: string,
  amountCents?: number
): {
  data: {
    type: "orders";
    id: string;
    attributes: { amount?: number };
  };
} {
  return {
    data: {
      type: "orders",
      id: orderId,
      attributes:
        amountCents !== undefined && Number.isFinite(amountCents)
          ? { amount: Math.round(amountCents) }
          : {},
    },
  };
}

/**
 * 是否还在 7 天无条件退款窗口内（基于订单完成时间）。
 * 时间缺失 / 非法 → false（调用方按 422 处理）。
 */
export function isWithinRefundWindow(
  completedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!completedAt) return false;
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(completedMs)) return false;
  // 允许负差（时钟偏差 / completedAt 略晚于 now），超过窗口则拒绝
  return now.getTime() - completedMs <= REFUND_WINDOW_MS;
}
