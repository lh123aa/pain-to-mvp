import type { Metadata } from "next";
import { TERMS } from "@/content/legal/terms";
import { SITE_URL } from "@/content/legal/shared";
import { LegalShell } from "@/content/legal/shell";
import "../legal.css";

/**
 * /terms —— 服务条款
 * 文案与结构见 src/content/legal/terms.ts；本文只负责 metadata 与版式。
 */
export const metadata: Metadata = {
  title: TERMS.title,
  description: TERMS.description,
  alternates: { canonical: `${SITE_URL}${TERMS.slug}` },
};

export default function TermsPage() {
  return <LegalShell doc={TERMS} />;
}
