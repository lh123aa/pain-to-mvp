import type { Metadata } from "next";
import { CRISIS_PROTOCOL } from "@/content/legal/crisis-protocol";
import { SITE_URL } from "@/content/legal/shared";
import { LegalShell } from "@/content/legal/shell";
import "../legal.css";

/**
 * /crisis-protocol —— 危机协议说明（988 / findahelpline / 误报率 / 能力边界）
 * 文案与结构见 src/content/legal/crisis-protocol.ts；本文只负责 metadata 与版式。
 */
export const metadata: Metadata = {
  title: CRISIS_PROTOCOL.title,
  description: CRISIS_PROTOCOL.description,
  alternates: { canonical: `${SITE_URL}${CRISIS_PROTOCOL.slug}` },
};

export default function CrisisProtocolPage() {
  return <LegalShell doc={CRISIS_PROTOCOL} />;
}
