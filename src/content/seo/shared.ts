/**
 * The Tell · SEO 页共享常量与 canonical 生成器
 *
 * 单一事实源：站点 URL、canonical、metadata 组装。
 * 域名仍是占位值（ADR-0007 已失效，待 G3 品牌/域名重拍）；部署时设置
 * NEXT_PUBLIC_SITE_URL 即可让 canonical / sitemap 同步切换，不需要改页面。
 *
 * 注意：本文件同时被 `src/app/sitemap.ts`（服务端）与单测（node 环境）引用，
 * 因此不做任何 DOM / 网络访问，只做字符串处理与纯对象组装。
 */
import type { Metadata } from "next";
import type { SeoPageCopy } from "./types";

/** 域名未拍板前的占位站点地址（与 sitemap/robots 的兜底值保持一致）。 */
export const DEFAULT_SITE_URL = "https://thetell.app";

/** 品牌名（与 layout.tsx / components.tsx 一致）。 */
export const BRAND = "The Tell";

/**
 * 解析站点 URL：空值回落占位域名，去掉末尾斜杠。
 * 导出成纯函数是为了让单测能覆盖"未配置 / 配了带斜杠 / 配了带空格"三种情况。
 */
export function resolveSiteUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return DEFAULT_SITE_URL;
  return trimmed.replace(/\/+$/, "");
}

/** 部署时的站点地址（服务端渲染期读取，构建后固定）。 */
export const SITE_URL = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

/** "/analyzer/whatsapp" → "https://thetell.app/analyzer/whatsapp"。 */
export function canonicalFor(slug: string): string {
  const path = slug.startsWith("/") ? slug : `/${slug}`;
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/** 三个落地页与 /sample 共用的 metadata 组装（title / description / canonical / OG）。 */
export function pageMetadata(
  slug: string,
  metaTitle: string,
  metaDescription: string,
): Metadata {
  const canonical = canonicalFor(slug);
  return {
    title: metaTitle,
    description: metaDescription,
    alternates: { canonical },
    openGraph: {
      title: metaTitle,
      description: metaDescription,
      url: canonical,
      type: "article",
    },
  };
}

/** 从落地页文案生成 Next metadata。 */
export function seoMetadata(copy: SeoPageCopy): Metadata {
  return pageMetadata(copy.slug, copy.metaTitle, copy.metaDescription);
}

/** 页面底部交叉导航的公共部分（隐私 / 方法论 / 样例报告）。 */
export const SHARED_LINKS = [
  { href: "/sample", label: "See a full sample report" },
  { href: "/methodology", label: "Read the methodology" },
  { href: "/privacy", label: "Privacy policy" },
] as const;

/**
 * 结构化数据（PRD AC-11.1：FAQ schema + HowTo schema）。
 *
 * 返回 JSON 字符串而不是 React 对象，原因：页面只需
 * `<script type="application/ld+json" dangerouslySetInnerHTML>`，单测也可以直接
 * `JSON.parse` 校验条目数量（避免 schema 与可见 FAQ/步骤脱节）。
 */
export function seoJsonLd(copy: SeoPageCopy): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        mainEntity: copy.faq.items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
      {
        "@type": "HowTo",
        name: copy.howTo.heading,
        description: copy.howTo.intro,
        step: copy.howTo.steps.map((step) => ({
          "@type": "HowToStep",
          name: step.title,
          text: step.body,
        })),
      },
    ],
  });
}
