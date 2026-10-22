import type { Metadata } from "next";
import { NOTICE } from "@/content/legal/notice";
import { SITE_URL } from "@/content/legal/shared";
import { LegalShell } from "@/content/legal/shell";
import "../legal.css";

/**
 * /notice —— 致聊天记录里的人（第三方数据告知 / 合法利益 / 退出方式）
 * 文案与结构见 src/content/legal/notice.ts；本文只负责 metadata 与版式。
 */
export const metadata: Metadata = {
  title: NOTICE.title,
  description: NOTICE.description,
  alternates: { canonical: `${SITE_URL}${NOTICE.slug}` },
};

export default function NoticePage() {
  return <LegalShell doc={NOTICE} />;
}
