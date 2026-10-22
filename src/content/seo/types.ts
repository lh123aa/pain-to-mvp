/**
 * The Tell · SEO landing page copy contract（P-10 · PRD FR-11）
 *
 * 为什么把文案抽到 `src/content/seo`：
 * - 三个落地页共用一个可单测的数据结构（`src/__tests__/seo-content.test.ts` 检查
 *   FAQ 数量、禁用词、canonical 主机、sitemap 收录）；
 * - 页面文件只负责 metadata 与版式，文案改动不碰 JSX；
 * - 与 `src/content/legal/*` 保持同一套"内容即数据"的做法。
 *
 * 约束：这里所有会被渲染的字符串必须是英文（产品面向 US/EU），且不得出现
 * therapist / therapy / counseling / diagnosis / clinical / mental health service
 * 等词；不得承诺读取 iCloud、微信或 QQ。测试对渲染字符串做 0 命中检查。
 */

/** 一条 FAQ（问题 + 人话答案，答案里可以带链接由页面渲染成 <Link>）。 */
export interface SeoFaqEntry {
  readonly question: string;
  readonly answer: string;
}

/** 编号步骤（导出教程 / how it works）。 */
export interface SeoStepEntry {
  /** 两位编号，如 "01"。 */
  readonly number: string;
  readonly title: string;
  readonly body: string;
}

/** 编号卡片（免费三卡 / 报告章节 / 标签解释）。 */
export interface SeoCardEntry {
  readonly number: string;
  readonly title: string;
  readonly body: string;
}

/** 编号说明行（隐私承诺三段式）。 */
export interface SeoRowEntry {
  readonly number: string;
  /** 每行第一段用 <strong> 渲染，突出承诺本身。 */
  readonly lead: string;
  readonly body: string;
}

/** 内链（页脚/正文的交叉导航，SEO 内链 + 转化路径）。 */
export interface SeoLinkEntry {
  readonly href: string;
  readonly label: string;
}

/** 三页共用的落地页数据结构。 */
export interface SeoPageCopy {
  /** 路由，如 "/analyzer/whatsapp"。canonical 由它派生。 */
  readonly slug: string;
  /** <title>（layout 模板会追加 " — The Tell"）。 */
  readonly metaTitle: string;
  /** <meta name="description">（建议 70–165 字符）。 */
  readonly metaDescription: string;
  /** H1 上方的眉标。 */
  readonly eyebrow: string;
  readonly h1: string;
  readonly lede: string;
  /** 状态徽标，如 iMessage 页的 "BETA"。 */
  readonly badge?: string;
  readonly cta: {
    readonly href: string;
    readonly label: string;
    readonly note: string;
  };
  /** Hero 下方的信任条（3 条以内，保持克制）。 */
  readonly trust: readonly string[];
  readonly howTo: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly intro: string;
    readonly steps: readonly SeoStepEntry[];
    /** 教程尾部的限制声明（"Only export chats you have the right to share."）。 */
    readonly note: string;
  };
  readonly privacy: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly intro: string;
    readonly rows: readonly SeoRowEntry[];
  };
  readonly cards: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly intro: string;
    readonly items: readonly SeoCardEntry[];
  };
  readonly limits: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly intro: string;
    readonly items: readonly string[];
  };
  /** 可选：样例报告卡片（task-14 要求 whatsapp 页有"样例卡"）。 */
  readonly sampleTeaser?: {
    readonly tag: string;
    readonly heading: string;
    readonly body: string;
    readonly href: string;
    readonly label: string;
  };
  readonly faq: {
    readonly eyebrow: string;
    readonly heading: string;
    readonly items: readonly SeoFaqEntry[];
  };
  readonly finalCta: {
    readonly heading: string;
    readonly label: string;
    readonly note: string;
  };
  /** 站内交叉链接（含 /sample、/methodology、/privacy 与另外两页）。 */
  readonly links: readonly SeoLinkEntry[];
}
