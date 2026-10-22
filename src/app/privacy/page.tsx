import type { Metadata } from "next";
import { PRIVACY } from "@/content/legal/privacy";
import { SITE_URL } from "@/content/legal/shared";
import { LegalShell } from "@/content/legal/shell";
import "../legal.css";

/**
 * /privacy —— 隐私政策
 * 文案与结构见 src/content/legal/privacy.ts；本文只负责 metadata 与版式。
 */
export const metadata: Metadata = {
  title: PRIVACY.title,
  description: PRIVACY.description,
  alternates: { canonical: `${SITE_URL}${PRIVACY.slug}` },
};

export default function PrivacyPage() {
  return <LegalShell doc={PRIVACY} />;
}
