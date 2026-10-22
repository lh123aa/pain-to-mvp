/**
 * 交易邮件抽象层（MVP）
 * ====================
 * 目标：先把「邮件供应商」和「5 封信模板」的边界定下来，业务代码只调
 * `sendTemplatedEmail()`，以后换 Resend / Postmark / SES 时只改 provider 实现。
 *
 * 现状：
 * - `EMAIL_API_KEY` 未配置时自动用 NoopEmailProvider（不建依赖、不发任何网络请求）；
 * - 配置后默认走 Resend HTTP API（原生 fetch，无第三方 SDK 依赖）；
 * - 所有网络调用都走注入的 `fetchImpl`，单测可完全离线。
 *
 * 5 封信（占位模板，文案待产品定稿）：
 *   1. magic_link        付款成功后发「报告解锁魔法链」
 *   2. receipt           收据 / 付款成功确认
 *   3. report_ready      报告生成完毕，可下载 PDF
 *   4. refund_confirmed  退款确认（FR-7）
 *   5. follow_up         7 天后的复盘跟进（留存）
 *
 * 注意：服务端模块，不要被客户端组件 import。
 */

import { buildMagicLinkUrl, issueMagicLinkToken } from "./magic-link";
import type { OrderRecord } from "./orders";

export type EmailTemplateKind =
  | "magic_link"
  | "receipt"
  | "report_ready"
  | "refund_confirmed"
  | "follow_up";

export type EmailTemplateVars = {
  /** 收件人称呼，可选 */
  name?: string;
  orderId?: string;
  /** magic_link / report_ready 用 */
  magicLinkUrl?: string;
  reportUrl?: string;
  /** receipt 用，如 "14.99" */
  amountUsd?: string;
  /** refund_confirmed 用 */
  refundEtaDays?: number;
  supportEmail?: string;
  appUrl?: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export type EmailMessage = RenderedEmail & {
  to: string;
  /** 覆盖 provider 默认 from */
  from?: string;
  replyTo?: string;
  kind?: EmailTemplateKind;
};

export type EmailSendResult = {
  ok: boolean;
  provider: string;
  /** provider 未启用（无 API key）时的 no-op */
  skipped?: boolean;
  id?: string;
  error?: string;
};

export interface EmailProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** 无 key / 测试环境：记录后直接返回成功（no-op），不产生任何网络请求 */
export class NoopEmailProvider implements EmailProvider {
  readonly name = "noop";
  readonly enabled = false;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.info(
      `[email] noop（未配置 EMAIL_API_KEY）：跳过 "${message.subject}" → ${message.to}`
    );
    return { ok: true, provider: this.name, skipped: true };
  }
}

/**
 * Resend HTTP 实现（https://resend.com/docs/api-reference/emails/send-email）。
 * 只用 fetch，不引入 SDK；`fetchImpl` 可注入以便单测离线。
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  readonly enabled = true;

  constructor(
    private readonly apiKey: string,
    private readonly defaultFrom: string,
    private readonly endpoint = "https://api.resend.com/emails",
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from ?? this.defaultFrom,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        return {
          ok: false,
          provider: this.name,
          error: `Resend HTTP ${response.status}: ${detail.slice(0, 200)}`,
        };
      }

      const payload = (await response.json()) as { id?: string };
      return { ok: true, provider: this.name, id: payload.id };
    } catch (err) {
      return {
        ok: false,
        provider: this.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * 测试 / 集成用 provider 覆盖（生产路径不设置）。
 * 让 webhook 邮件触发可以在单测里注入 spy provider，而不发真实网络请求。
 */
let providerOverride: EmailProvider | null = null;

export function setEmailProviderOverride(provider: EmailProvider | null): void {
  providerOverride = provider;
}

export function getEmailProviderOverride(): EmailProvider | null {
  return providerOverride;
}

/**
 * 按环境变量选择 provider。无 key → Noop（让本地 / CI 全链路可跑通）。
 */
export function getEmailProvider(
  env: NodeJS.ProcessEnv = process.env
): EmailProvider {
  if (providerOverride) return providerOverride;

  const apiKey = env.EMAIL_API_KEY?.trim();
  if (!apiKey) return new NoopEmailProvider();

  const from =
    env.EMAIL_FROM?.trim() || "The Tell <no-reply@thetell.app>";
  const kind = (env.EMAIL_PROVIDER || "resend").trim().toLowerCase();

  switch (kind) {
    case "resend":
      return new ResendEmailProvider(apiKey, from);
    default:
      console.warn(`[email] 未知 EMAIL_PROVIDER="${kind}"，退回 no-op`);
      return new NoopEmailProvider();
  }
}

/** 发一封已渲染好的邮件（Noop provider 内部自行 no-op） */
export async function sendEmail(
  message: EmailMessage,
  provider: EmailProvider = getEmailProvider()
): Promise<EmailSendResult> {
  return provider.send(message);
}

/** 渲染模板 + 发送（业务代码入口） */
export async function sendTemplatedEmail(
  kind: EmailTemplateKind,
  to: string,
  vars: EmailTemplateVars = {},
  provider: EmailProvider = getEmailProvider()
): Promise<EmailSendResult> {
  const rendered = renderEmail(kind, vars);
  return sendEmail({ to, ...rendered, kind }, provider);
}

/* ===== 支付闭环：订单完成后发 magic link 邮件 ===== */

/** 可注入依赖（单测里全替换，不签发真 token、不发真请求） */
export type MagicLinkEmailDeps = {
  provider?: EmailProvider;
  issueToken?: (orderId: string) => string;
  buildLink?: (token: string) => string;
};

export type MagicLinkEmailResult = {
  sent: boolean;
  /** 跳过原因（不算错误） */
  skipped?: "no-email" | "not-completed";
  error?: string;
};

/**
 * webhook 首次落库（orders.upsert 返回 created=true）后调用：
 * 给买家发一封带签名魔法链的邮件。
 *
 * 幂等由调用方保证（只有 created=true 时调用）；本函数自身安全：
 * - 没邮箱 / 订单未完成 → 跳过，不发；
 * - token 签发或 provider 报错 → 返回 error，不抛出（不能因邮件失败让 webhook 500 被 LS 重试）。
 */
export async function sendMagicLinkForOrder(
  order: Pick<OrderRecord, "orderId" | "email" | "status">,
  deps: MagicLinkEmailDeps = {}
): Promise<MagicLinkEmailResult> {
  const to = order.email?.trim();
  if (!to) return { sent: false, skipped: "no-email" };
  if (order.status !== "completed") {
    return { sent: false, skipped: "not-completed" };
  }

  try {
    const issueToken =
      deps.issueToken ?? ((orderId: string) => issueMagicLinkToken(orderId));
    const buildLink =
      deps.buildLink ?? ((token: string) => buildMagicLinkUrl(token));
    const magicLinkUrl = buildLink(issueToken(order.orderId));

    const result = await sendTemplatedEmail(
      "magic_link",
      to,
      { orderId: order.orderId, magicLinkUrl },
      deps.provider ?? getEmailProvider()
    );

    if (!result.ok) {
      return { sent: false, error: result.error ?? "email provider failed" };
    }
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ===== 5 封信模板（占位文案）===== */

export function renderEmail(
  kind: EmailTemplateKind,
  vars: EmailTemplateVars = {}
): RenderedEmail {
  switch (kind) {
    case "magic_link": {
      const link = vars.magicLinkUrl || defaultAppUrl(vars);
      return wrap({
        subject: "Your Tell report is unlocked — here's your magic link",
        heading: "Your report is unlocked",
        body: [
          "Thanks for your payment. Tap the button below to open your full relationship report.",
          "This link works for 7 days. Bookmark the page or download the PDF to keep it.",
        ],
        cta: { label: "Open my report", href: link },
        footer: "If you didn't buy this, ignore this email — no charge will be made.",
      });
    }

    case "receipt": {
      return wrap({
        subject: `Receipt — The Tell Relationship Report${
          vars.amountUsd ? ` ($${vars.amountUsd})` : ""
        }`,
        heading: "Payment received",
        body: [
          `Thanks${vars.name ? `, ${vars.name}` : ""} — your payment was successful.`,
          `Order${vars.orderId ? ` #${vars.orderId}` : ""}${
            vars.amountUsd ? ` · $${vars.amountUsd} USD` : ""
          }. Lemon Squeezy is the merchant of record and handles VAT/GST.`,
          "Your report link is in a separate email.",
        ],
        footer: "Need help? Reply to this email.",
      });
    }

    case "report_ready": {
      const link = vars.reportUrl || vars.magicLinkUrl || defaultAppUrl(vars);
      return wrap({
        subject: "Your Tell report is ready to download",
        heading: "Your report is ready",
        body: [
          "Your full report has been generated. Open it to read all six chapters and download the printable PDF.",
        ],
        cta: { label: "View my report", href: link },
        footer: "Your access link stays valid for 7 days.",
      });
    }

    case "refund_confirmed": {
      const days = vars.refundEtaDays ?? 5;
      return wrap({
        subject: "Your Tell refund is on the way",
        heading: "Refund confirmed",
        body: [
          `We've processed your refund${
            vars.orderId ? ` for order #${vars.orderId}` : ""
          }. Depending on your bank, it should appear within ${days} business days.`,
          "Your report data has been scheduled for deletion per our refund policy.",
        ],
        footer: `Questions? Contact ${vars.supportEmail || "support@thetell.app"}.`,
      });
    }

    case "follow_up": {
      const link = vars.appUrl || defaultAppUrl(vars);
      return wrap({
        subject: "One week later — how did your 7-day plan go?",
        heading: "A week in",
        body: [
          "You've had your report for a week now. Which of the 7 days felt most useful? Which one was hardest to start?",
          "If you'd like an updated read on the same conversation, you can get a fresh report anytime.",
        ],
        cta: { label: "Get an updated report", href: link },
        footer: "You're receiving this because you bought The Tell. Unsubscribe anytime.",
      });
    }

    default: {
      const exhaustive: never = kind;
      throw new Error(`未知邮件模板：${String(exhaustive)}`);
    }
  }
}

/* ===== 模板渲染工具 ===== */

type WrapInput = {
  subject: string;
  heading: string;
  body: string[];
  cta?: { label: string; href: string };
  footer?: string;
};

function wrap(input: WrapInput): RenderedEmail {
  const paragraphs = input.body
    .map((line) => `<p style="margin:0 0 14px">${escapeHtml(line)}</p>`)
    .join("");
  const cta = input.cta
    ? `<p style="margin:22px 0"><a href="${escapeHtml(input.cta.href)}" style="display:inline-block;background:#1d6b63;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(
        input.cta.label
      )}</a></p>`
    : "";
  const footer = input.footer
    ? `<p style="margin:18px 0 0;font-size:12px;color:#6b7280">${escapeHtml(
        input.footer
      )}</p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;background:#f7f4ef;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 18px;font-size:22px">${escapeHtml(input.heading)}</h1>
    ${paragraphs}
    ${cta}
    ${footer}
  </div>
</body></html>`;

  const textParts = [
    input.heading,
    "",
    ...input.body,
    ...(input.cta ? ["", `${input.cta.label}: ${input.cta.href}`] : []),
    ...(input.footer ? ["", input.footer] : []),
  ];

  return { subject: input.subject, html, text: textParts.join("\n") };
}

function defaultAppUrl(vars: EmailTemplateVars): string {
  return (
    vars.appUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
