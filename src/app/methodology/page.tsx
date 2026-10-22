import type { Metadata } from "next";
import { METHODOLOGY } from "@/content/legal/methodology";
import { SITE_URL } from "@/content/legal/shared";
import { LegalShell } from "@/content/legal/shell";
import "../legal.css";

/**
 * /methodology —— 方法论（五维权重 25/20/15/25/15、证据链、What I Don't Know、来源索引）
 * 文案与结构见 src/content/legal/methodology.ts；本文只负责 metadata 与版式。
 */
export const metadata: Metadata = {
  title: METHODOLOGY.title,
  description: METHODOLOGY.description,
  alternates: { canonical: `${SITE_URL}${METHODOLOGY.slug}` },
};

export default function MethodologyPage() {
  return <LegalShell doc={METHODOLOGY} />;
}
