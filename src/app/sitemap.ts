import type { MetadataRoute } from "next";
import { SITE_URL } from "@/content/seo/shared";

/**
 * Sitemap · 只收录可公开索引的页面。
 * 不收录 /checkout、/report（交易与私有报告页）。
 *
 * 域名仍是占位值（ADR-0007 已失效，待 G3 品牌/域名重拍）。canonical 与 sitemap
 * 共用 `src/content/seo/shared.ts` 的 SITE_URL：部署时设置
 * NEXT_PUBLIC_SITE_URL 即整体切换，不需要改页面。
 *
 * task-14 新增三条获客落地页（PRD FR-11 / P-10）：
 *   /analyzer/whatsapp · /analyzer/imessage · /analyzer/attachment-style-test
 * 连同已有的 /sample，四条获客资产全部进 sitemap。
 */
const ROUTES: Array<{ path: string; priority: number; changeFrequency: "weekly" | "monthly" }> = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "/analyze", priority: 0.9, changeFrequency: "weekly" },
  { path: "/analyzer/whatsapp", priority: 0.8, changeFrequency: "weekly" },
  { path: "/analyzer/imessage", priority: 0.8, changeFrequency: "weekly" },
  { path: "/analyzer/attachment-style-test", priority: 0.8, changeFrequency: "weekly" },
  { path: "/sample", priority: 0.8, changeFrequency: "monthly" },
  { path: "/methodology", priority: 0.7, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.5, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.5, changeFrequency: "monthly" },
  { path: "/refund", priority: 0.5, changeFrequency: "monthly" },
  { path: "/notice", priority: 0.5, changeFrequency: "monthly" },
  { path: "/crisis-protocol", priority: 0.5, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
