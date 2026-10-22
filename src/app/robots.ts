import type { MetadataRoute } from "next";

/**
 * 只放行可公开页面；私有/交易页不索引。
 * 域名占位同 src/app/sitemap.ts（待 G3 品牌/域名重拍）。
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://thetell.app").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/checkout", "/report", "/report/preview", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
