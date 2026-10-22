import type { MetadataRoute } from "next";

/**
 * Sitemap · 只收录可公开索引的页面。
 * 不收录 /checkout、/report（交易与私有报告页）。
 *
 * 注意：域名仍是占位值（ADR-0007 已失效，待 G3 品牌/域名重拍）。
 * 域名拍板后应把 NEXT_PUBLIC_SITE_URL 设为正式域名，并同步
 * src/content/legal/shared.ts 的 SITE_URL（canonical 来源）。
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://thetell.app").replace(/\/$/, "");

const ROUTES: Array<{ path: string; priority: number; changeFrequency: "weekly" | "monthly" }> = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "/analyze", priority: 0.9, changeFrequency: "weekly" },
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
  return ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
