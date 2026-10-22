/**
 * The Tell · 合规页共享常量
 *
 * 单一事实源：品牌名、联系邮箱、版本日期、三层数据边界、危机资源、合规页导航。
 * 任何文案改动应先改这里，再改具体页面，避免 6 个页面各说一套。
 */

export const SITE_URL = "https://thetell.app";
export const SITE_HOST = "thetell.app";
export const BRAND = "The Tell";
export const CONTACT_EMAIL = "hello@thetell.app";
export const LEGAL_VERSION = "v1.0";
export const EFFECTIVE_DATE = "October 22, 2026";
export const MIN_AGE = 16;
/** 退款窗口（天）：PRD FR-7 */
export const REFUND_DAYS = 7;
/** 服务端分析数据保留期（天）：PRD FR-8 第 2 层 */
export const RETENTION_DAYS = 90;
/** 浏览器 localStorage TTL（小时）：PRD FR-8 第 1 层 */
export const LOCAL_TTL_HOURS = 2;
/** 订单记录保留期（年）：税务 / MoR 合规 */
export const ORDER_KEEP_YEARS = 7;
/** 退款后分析数据删除时限（天）：PRD FR-7 / FR-8 */
export const REFUND_DELETE_DAYS = 7;

/** 危机资源（FR-10：988 + findahelpline；页面与管理后台共用同一份措辞） */
export const CRISIS = {
  headline: "If things feel heavy right now, real people can help.",
  line: "You do not need a report, a purchase, or an explanation to ask for help.",
  notEmergency:
    "The Tell is not an emergency or support service. No one is watching your upload, and no one will be alerted.",
  us: { label: "988 — call or text (US)", href: "tel:988" },
  intl: {
    label: "findahelpline.com — helplines outside the US",
    href: "https://findahelpline.com",
  },
  emergency:
    "If you or someone else is in immediate danger, call your local emergency number (911 in the US, 112 in the EU, 999 in the UK).",
} as const;

/**
 * 三层数据边界（PRD FR-8 写死）。
 * 同时被 /privacy 与 /notice 引用，保证两边数字一致。
 */
export const DATA_LAYERS = [
  {
    layer: "Your browser (localStorage)",
    what: "Parse state, a short file fingerprint, and your free preview",
    retention: `${LOCAL_TTL_HOURS} hours, then considered stale`,
    why: "So a refresh or an accidental tab close does not lose your preview",
  },
  {
    layer: "Our servers, after purchase",
    what: "Computed statistics, short masked excerpts, the generated report",
    retention: `${RETENTION_DAYS} days, deleted automatically`,
    why: "To generate the report and keep your access link working",
  },
  {
    layer: "Order record",
    what: "Email hash, order status, age and rights confirmations, amount",
    retention: `${ORDER_KEEP_YEARS} years`,
    why: "Tax and Merchant of Record obligations",
  },
  {
    layer: "Your original chat file",
    what: "The full export",
    retention: "Never received, never stored",
    why: "It is parsed on your device and never leaves it",
  },
] as const;

/** 合规页交叉导航（footer / 侧滑面板里已接入的路径保持一致） */
export const LEGAL_NAV = [
  { slug: "/privacy", label: "Privacy policy" },
  { slug: "/terms", label: "Terms of service" },
  { slug: "/refund", label: "Refund policy" },
  { slug: "/notice", label: "Notice for people in your chats" },
  { slug: "/crisis-protocol", label: "Crisis protocol" },
  { slug: "/methodology", label: "Methodology" },
] as const;
