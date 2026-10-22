import type { Metadata } from "next";
import { REFUND } from "@/content/legal/refund";
import { SITE_URL } from "@/content/legal/shared";
import { LegalShell } from "@/content/legal/shell";
import "../legal.css";

/**
 * /refund —— 退款政策
 * 文案与结构见 src/content/legal/refund.ts；本文只负责 metadata 与版式。
 */
export const metadata: Metadata = {
  title: REFUND.title,
  description: REFUND.description,
  alternates: { canonical: `${SITE_URL}${REFUND.slug}` },
};

export default function RefundPage() {
  return <LegalShell doc={REFUND} />;
}
