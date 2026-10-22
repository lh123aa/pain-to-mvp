/**
 * SEO 获客资产单测（task-14 · PRD FR-11 / FR-17）
 *
 * 覆盖四件事：
 * 1. 三个落地页的文案结构完整（FAQ ≥4、步骤 ≥3、卡片 ≥3、各段 heading 非空），
 *    并且禁用词 / 中文 / "读取 iCloud·微信·QQ"式承诺 0 命中；
 * 2. canonical 主机正确（SITE_URL 单一来源 + 未配置时的占位域名）；
 * 3. sitemap 收录 4 条获客路由（3 个 analyzer 页 + /sample），且不收录交易/私有页；
 * 4. `/sample` 的报告真的由 fixtures 跑真实管线生成——分数来自 features、
 *    六章 id 与契约一致、证据指向真实消息、两次构建逐字节一致、文案含 synthetic 声明。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { ATTACHMENT_STYLE_PAGE } from "@/content/seo/attachment-style-test";
import { IMESSAGE_PAGE } from "@/content/seo/imessage";
import {
  SAMPLE_FIXTURE,
  SAMPLE_NOTICE,
  SAMPLE_PAGE,
  SAMPLE_SPEAKERS,
} from "@/content/seo/sample";
import { buildSampleReport } from "@/content/seo/sample-report";
import {
  DEFAULT_SITE_URL,
  SITE_URL,
  canonicalFor,
  pageMetadata,
  resolveSiteUrl,
  seoJsonLd,
  seoMetadata,
} from "@/content/seo/shared";
import { WHATSAPP_PAGE } from "@/content/seo/whatsapp";
import type { SeoPageCopy } from "@/content/seo/types";
import {
  REPORT_CHAPTER_IDS,
  REPORT_SCHEMA_VERSION,
  containsCjk,
} from "@/lib/report-contract";

const PAGES: ReadonlyArray<{
  copy: SeoPageCopy;
  pageFile: string;
  moduleName: string;
}> = [
  {
    copy: WHATSAPP_PAGE,
    pageFile: "src/app/analyzer/whatsapp/page.tsx",
    moduleName: "WHATSAPP_PAGE",
  },
  {
    copy: IMESSAGE_PAGE,
    pageFile: "src/app/analyzer/imessage/page.tsx",
    moduleName: "IMESSAGE_PAGE",
  },
  {
    copy: ATTACHMENT_STYLE_PAGE,
    pageFile: "src/app/analyzer/attachment-style-test/page.tsx",
    moduleName: "ATTACHMENT_STYLE_PAGE",
  },
];

/** 禁用词（PRD AC-5.2 / task-14）：临床与治疗词汇一律不得出现在渲染文案里。 */
const FORBIDDEN_TERMS = [
  "therapist",
  "therapy",
  "counseling",
  "counselling",
  "diagnosis",
  "diagnose",
  "clinical",
  "mental health",
];

/** 不许承诺的数据访问（task-14：不承诺访问 iCloud / 微信 / QQ）。 */
const FORBIDDEN_PROMISES = [
  "read your icloud",
  "access your icloud",
  "your icloud",
  "icloud password",
  "connect your icloud",
  "log into your icloud",
  "wechat",
  "weixin",
  "qq",
];

/** 4 条获客路由：三个 SEO 落地页 + 样例报告。 */
const ACQUISITION_ROUTES = [
  "/analyzer/whatsapp",
  "/analyzer/imessage",
  "/analyzer/attachment-style-test",
  "/sample",
];

function lowerCopy(copy: unknown): string {
  return JSON.stringify(copy).toLowerCase();
}

function expectClean(strings: unknown, label: string): void {
  const serialized = JSON.stringify(strings);
  expect(containsCjk(serialized), `${label} must stay English`).toBe(false);
  const lower = lowerCopy(strings);
  for (const term of FORBIDDEN_TERMS) {
    expect(lower.includes(term), `${label} must not contain "${term}"`).toBe(false);
  }
  for (const phrase of FORBIDDEN_PROMISES) {
    expect(lower.includes(phrase), `${label} must not promise "${phrase}"`).toBe(false);
  }
}

describe("SEO landing pages · copy contract", () => {
  it("ships exactly the three acquisition pages with unique slugs and H1s", () => {
    expect(PAGES.map((page) => page.copy.slug)).toEqual([
      "/analyzer/whatsapp",
      "/analyzer/imessage",
      "/analyzer/attachment-style-test",
    ]);
    const h1s = PAGES.map((page) => page.copy.h1);
    expect(new Set(h1s).size).toBe(h1s.length);
  });

  it("gives every page complete, non-empty sections and enough FAQ entries", () => {
    for (const { copy } of PAGES) {
      expect(copy.metaTitle.length, `${copy.slug} metaTitle`).toBeGreaterThan(10);
      expect(copy.metaDescription.length, `${copy.slug} metaDescription`).toBeGreaterThan(60);
      expect(copy.metaDescription.length, `${copy.slug} metaDescription`).toBeLessThan(200);

      expect(copy.h1.length).toBeGreaterThan(10);
      expect(copy.lede.length).toBeGreaterThan(40);
      expect(copy.lede).not.toBe(copy.h1);

      // required sections
      expect(copy.howTo.heading.length).toBeGreaterThan(10);
      expect(copy.howTo.intro.length).toBeGreaterThan(20);
      expect(copy.privacy.heading.length).toBeGreaterThan(10);
      expect(copy.privacy.intro.length).toBeGreaterThan(20);
      expect(copy.cards.heading.length).toBeGreaterThan(10);
      expect(copy.cards.intro.length).toBeGreaterThan(20);
      expect(copy.limits.heading.length).toBeGreaterThan(10);
      expect(copy.limits.intro.length).toBeGreaterThan(20);
      expect(copy.faq.heading.length).toBeGreaterThan(10);
      expect(copy.finalCta.heading.length).toBeGreaterThan(10);

      // quantities required by task-14: FAQ ≥4, export/HowTo steps ≥3, cards ≥3
      expect(copy.faq.items.length, `${copy.slug} FAQ count`).toBeGreaterThanOrEqual(4);
      expect(copy.howTo.steps.length, `${copy.slug} step count`).toBeGreaterThanOrEqual(3);
      expect(copy.cards.items.length, `${copy.slug} card count`).toBeGreaterThanOrEqual(3);
      expect(copy.privacy.rows.length).toBeGreaterThanOrEqual(3);
      expect(copy.limits.items.length).toBeGreaterThanOrEqual(3);
      expect(copy.trust.length).toBeGreaterThanOrEqual(2);
      expect(copy.links.length).toBeGreaterThanOrEqual(3);

      // every FAQ has a real answer; questions are unique
      const questions = copy.faq.items.map((item) => item.question);
      expect(new Set(questions).size).toBe(questions.length);
      for (const item of copy.faq.items) {
        expect(item.answer.length).toBeGreaterThan(40);
      }

      // CTA + internal links are site-relative and point at the funnel
      expect(copy.cta.href.startsWith("/")).toBe(true);
      expect(copy.cta.label.length).toBeGreaterThan(4);
      expect(copy.cta.note.length).toBeGreaterThan(10);
      for (const link of copy.links) {
        expect(link.href.startsWith("/")).toBe(true);
        expect(link.label.length).toBeGreaterThan(2);
      }
      expect(copy.links.map((link) => link.href)).not.toContain(copy.slug);
    }
  });

  it("keeps every rendered string free of banned vocabulary and fake data access", () => {
    for (const { copy } of PAGES) expectClean(copy, copy.slug);
    expectClean(SAMPLE_PAGE, "sample page copy");
  });

  it("gives the WhatsApp page a sample-report card that links to /sample", () => {
    expect(WHATSAPP_PAGE.sampleTeaser).toBeDefined();
    expect(WHATSAPP_PAGE.sampleTeaser?.href).toBe("/sample");
    expect(WHATSAPP_PAGE.sampleTeaser?.body.toLowerCase()).toContain("synthetic");
    expect(WHATSAPP_PAGE.sampleTeaser?.label.length).toBeGreaterThan(10);
  });

  it("does not claim iMessage is generally available", () => {
    // 诚实状态：WhatsApp 页说明群聊不支持；iMessage 页必须带 beta 标记且说明
    // 今天可用的是 WhatsApp .txt 与粘贴文本。
    expect(IMESSAGE_PAGE.badge?.toLowerCase()).toBe("beta");
    const imessageCopy = JSON.stringify(IMESSAGE_PAGE).toLowerCase();
    expect(imessageCopy).toContain("beta");
    expect(imessageCopy).toContain("pasted text");
    expect(imessageCopy).toContain("mac");
    expect(imessageCopy).toContain("chat.db");
  });

  it("emits FAQPage + HowTo structured data that matches the visible copy", () => {
    for (const { copy } of PAGES) {
      const graph = JSON.parse(seoJsonLd(copy)) as {
        "@context": string;
        "@graph": Array<Record<string, unknown>>;
      };
      expect(graph["@context"]).toBe("https://schema.org");
      const faq = graph["@graph"].find((node) => node["@type"] === "FAQPage");
      const howTo = graph["@graph"].find((node) => node["@type"] === "HowTo");
      expect(faq).toBeDefined();
      expect(howTo).toBeDefined();
      expect((faq?.["mainEntity"] as unknown[]).length).toBe(copy.faq.items.length);
      expect((howTo?.["step"] as unknown[]).length).toBe(copy.howTo.steps.length);
    }
  });

  it("renders the pages through the shared metadata helper", () => {
    for (const { moduleName, pageFile } of PAGES) {
      const source = readFileSync(resolve(process.cwd(), pageFile), "utf8");
      expect(source, pageFile).toContain("seoMetadata(");
      expect(source, pageFile).toContain("TopBar");
      expect(source, pageFile).toContain("Footer");
      expect(source, pageFile).toContain(moduleName);
    }
  });
});

describe("SEO · canonical host", () => {
  it("falls back to the placeholder domain when NEXT_PUBLIC_SITE_URL is unset", () => {
    expect(resolveSiteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("")).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl("   ")).toBe(DEFAULT_SITE_URL);
    expect(new URL(DEFAULT_SITE_URL).host).toBe("thetell.app");
  });

  it("strips trailing slashes from a configured site URL", () => {
    expect(resolveSiteUrl("https://example.com")).toBe("https://example.com");
    expect(resolveSiteUrl("https://example.com/")).toBe("https://example.com");
    expect(resolveSiteUrl("https://example.com///")).toBe("https://example.com");
    expect(resolveSiteUrl("  https://example.com/  ")).toBe("https://example.com");
  });

  it("builds canonical URLs from one source of truth for every page", () => {
    for (const { copy } of PAGES) {
      expect(canonicalFor(copy.slug)).toBe(`${SITE_URL}${copy.slug}`);
      expect(canonicalFor(copy.slug.replace(/^\//, ""))).toBe(`${SITE_URL}${copy.slug}`);
      const meta = seoMetadata(copy);
      expect(meta.alternates?.canonical).toBe(canonicalFor(copy.slug));
      expect(meta.title).toBe(copy.metaTitle);
      expect(meta.description).toBe(copy.metaDescription);
    }

    const sampleMeta = pageMetadata(
      SAMPLE_PAGE.slug,
      SAMPLE_PAGE.metaTitle,
      SAMPLE_PAGE.metaDescription,
    );
    expect(sampleMeta.alternates?.canonical).toBe(`${SITE_URL}/sample`);

    // canonical 主机必须与配置来源一致（未配置时即占位域名）
    expect(new URL(canonicalFor("/analyzer/whatsapp")).host).toBe(new URL(SITE_URL).host);
    expect(new URL(canonicalFor("/sample")).host).toBe(new URL(SITE_URL).host);
  });
});

describe("sitemap · acquisition routes", () => {
  it("lists the three analyzer pages and /sample, and no private pages", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);

    for (const route of ACQUISITION_ROUTES) {
      expect(urls, `sitemap missing ${route}`).toContain(canonicalFor(route));
    }
    expect(urls).not.toContain(canonicalFor("/checkout"));
    expect(urls).not.toContain(canonicalFor("/report"));
    expect(urls).not.toContain(canonicalFor("/report/preview"));

    for (const entry of entries) {
      expect(entry.url.startsWith(SITE_URL)).toBe(true);
      expect(entry.lastModified).toBeInstanceOf(Date);
      expect(entry.priority).toBeGreaterThan(0);
      expect(entry.priority).toBeLessThanOrEqual(1);
    }
  });
});

describe("sample page · synthetic, real-pipeline report", () => {
  function loadBundle() {
    const fixturePath = resolve(process.cwd(), SAMPLE_FIXTURE.relativePath);
    const fixtureText = readFileSync(fixturePath, "utf8");
    return { fixtureText, bundle: buildSampleReport(fixtureText) };
  }

  it("declares the synthetic source on the page", () => {
    expect(SAMPLE_NOTICE).toBe("Sample report generated from a synthetic conversation");
    expect(SAMPLE_PAGE.notice).toBe(SAMPLE_NOTICE);
    expect(JSON.stringify(SAMPLE_PAGE.provenance).toLowerCase()).toContain("synthetic");
    expect(SAMPLE_PAGE.provenanceNote.toLowerCase()).toContain("never uploaded");

    const source = readFileSync(resolve(process.cwd(), "src/app/sample/page.tsx"), "utf8");
    // 禁止演示内核 / 手写分数；必须走构建期真实管线
    expect(source).not.toContain("DEMO_REPORT");
    expect(source).not.toContain("demo-report");
    expect(source).toContain("buildSampleReport");
    expect(source).toContain("SAMPLE_PAGE.notice");
  });

  it("generates six chapters from the fixture through the real pipeline", () => {
    const { bundle } = loadBundle();
    const { report, features, conversation } = bundle;

    expect(report.meta.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(report.chapters.map((chapter) => chapter.id)).toEqual([...REPORT_CHAPTER_IDS]);
    expect(report.chapters).toHaveLength(6);

    for (const chapter of report.chapters) {
      expect(chapter.title.length).toBeGreaterThan(3);
      expect(chapter.summary.length).toBeGreaterThan(20);
    }

    // 分数只能来自规则层计算（features.health.totalScore），不是手写常量
    expect(report.headline.score).toBe(features.health.totalScore);
    expect(report.headline.score).toBeGreaterThanOrEqual(0);
    expect(report.headline.score).toBeLessThanOrEqual(100);
    expect(report.meta.sample.messages).toBe(features.sample.messageCount);
    expect(report.meta.sample.messages).toBeGreaterThan(30);
    expect(conversation.messages.length).toBeGreaterThan(30);

    // 证据必须指向真实消息
    const messageIds = new Set(conversation.messages.map((message) => message.id));
    expect(report.evidence.length).toBeGreaterThan(0);
    for (const item of report.evidence) {
      expect(messageIds.has(item.messageId), `unknown evidence ${item.messageId}`).toBe(true);
      expect(item.quote.length).toBeGreaterThan(0);
    }

    // 页面上展示的说话人必须与 fixture 实际解析出的说话人一致（防止 fixture 漂移）
    expect(conversation.user.names).toContain(SAMPLE_SPEAKERS.user);
    expect(conversation.partner.names).toContain(SAMPLE_SPEAKERS.partner);
  });

  it("is deterministic and English-only, with no banned vocabulary", () => {
    const { fixtureText, bundle } = loadBundle();
    const again = buildSampleReport(fixtureText);

    expect(JSON.stringify(again.report)).toBe(JSON.stringify(bundle.report));
    expectClean(bundle.report, "sample report");
  });
});
