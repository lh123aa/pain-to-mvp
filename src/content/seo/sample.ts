/**
 * The Tell · /sample 页文案（PRD FR-17）
 *
 * `/sample` 是转化漏斗里的"先看货"页，也是 SEO 内容资产。页面上的报告**不是**
 * 演示数据：它由 `sample-report.ts` 用 fixtures 里的合成导出真实跑
 * parse → createSpeakerMap → buildReportFeatures → buildReportV2 生成。
 * 本文件只放文案与 fixture 元信息，供页面与单测共同引用。
 */
import { SHARED_LINKS } from "./shared";
import type { SeoLinkEntry } from "./types";

/** 顶部横幅原文（PRD FR-17 / task-14 规定措辞，单测按此字符串断言）。 */
export const SAMPLE_NOTICE = "Sample report generated from a synthetic conversation";

/**
 * 生成样例报告使用的合成导出。
 * 相对仓库根目录；`/sample` 在构建期用 fs 读取（同步 I/O 会进入静态预渲染，
 * 见 Next 16 Cache Components 文档），单测用同一路径读取并重跑管线。
 */
export const SAMPLE_FIXTURE = {
  relativePath: "fixtures/whatsapp/android-24h-dmy.txt",
  label: "whatsapp / android-24h-dmy.txt",
  description:
    "Hand-written WhatsApp export (Android, 24-hour timestamps, DD/MM/YYYY). Invented names, invented messages, no real person involved.",
} as const;

/** 合成对话里的两个说话人（仅用于展示"you / them"归属，与 fixture 内容一致）。 */
export const SAMPLE_SPEAKERS = { user: "Alex", partner: "Sam" } as const;

export const SAMPLE_PAGE = {
  slug: "/sample",
  metaTitle: "Sample Report — A Full Six-Chapter Report From a Synthetic Chat",
  metaDescription:
    "Open a complete The Tell report generated from a synthetic WhatsApp conversation: six chapters, real rules, quoted evidence and a seven-day plan.",
  eyebrow: "The Tell · Sample report",
  notice: SAMPLE_NOTICE,
  lede:
    "This page is not a design mock. A synthetic WhatsApp export was run through the same parser, feature builder and report engine that a real analysis uses. The conversation is invented; every number below is computed.",
  provenanceHeading: "What you are looking at",
  provenance: [
    "One synthetic WhatsApp export, passed through the production parse → features → report pipeline at build time.",
    "No demo score and no placeholder copy: the headline score, six chapters, quoted evidence and the seven-day plan all come from that file.",
    "The names Alex and Sam and every line of dialogue are invented. No real conversation, account or person is involved.",
  ],
  provenanceNote:
    "Your own report is different: it is built in your browser from your own export, and the chat file is never uploaded.",
  cta: {
    href: "/analyze",
    label: "Analyze my chat",
    note: "Takes about 1–5 minutes · From $14.99 · No subscription",
  },
  disclaimerHeading: "How to read a report",
  links: [
    { href: "/analyzer/whatsapp", label: "WhatsApp chat analyzer" },
    { href: "/analyzer/attachment-style-test", label: "Attachment style from texts" },
    ...SHARED_LINKS,
  ] as readonly SeoLinkEntry[],
} as const;
