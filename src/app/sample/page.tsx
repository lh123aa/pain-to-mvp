import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Link from "next/link";
import { Footer, TopBar } from "@/app/components";
import { SAMPLE_FIXTURE, SAMPLE_PAGE, SAMPLE_SPEAKERS } from "@/content/seo/sample";
import { buildSampleReport, type SampleReportBundle } from "@/content/seo/sample-report";
import { pageMetadata } from "@/content/seo/shared";
import type { ReportChapter } from "@/lib/report-contract";

/**
 * /sample —— 完整样例报告（PRD FR-17 / AC-17.1）
 *
 * 关键约束（task-14）：
 * - 报告必须由真实管线在**构建期服务端**生成：fixtures 里的合成 WhatsApp 导出
 *   → parseWhatsAppTxt → createSpeakerMap → conversationFromChat
 *   → buildReportFeatures → buildReportV2；
 * - 禁止演示内核与硬编码分数；解析失败就让构建失败，不静默回落；
 * - 顶部横幅声明合成对话（SAMPLE_NOTICE），六章用现有 report 样式类渲染，
 *   不 import /report 页面的组件（只参考其章节结构）。
 *
 * 为什么 fs 读取是安全的：`fs.readFileSync` 是确定性同步 I/O，Next 16 Cache
 * Components 会在预渲染阶段执行并把它写进静态 HTML（见
 * node_modules/next/dist/docs/.../08-caching.md「Predictable values」）。
 * 如果未来构建环境读不到 fixture，会抛出带路径的错误，构建直接失败——不会
 * 上线一份假报告。
 */
export const metadata: Metadata = pageMetadata(
  SAMPLE_PAGE.slug,
  SAMPLE_PAGE.metaTitle,
  SAMPLE_PAGE.metaDescription,
);

/** 读取 fixture 文本；按仓库根目录解析，避免依赖 cwd 的调用位置。 */
function readSampleFixture(): string {
  // /sample 只在构建期读取仓库内的合成 fixture；用 turbopackIgnore 显式告诉
  // 打包器不要因为动态路径把整个项目纳入 server bundle（见 Turbopack 提示）。
  const candidates = [
    resolve(/*turbopackIgnore: true*/ process.cwd(), SAMPLE_FIXTURE.relativePath),
    resolve(/*turbopackIgnore: true*/ process.cwd(), "..", SAMPLE_FIXTURE.relativePath),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(/*turbopackIgnore: true*/ candidate, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    `[sample] Could not read the synthetic fixture (${SAMPLE_FIXTURE.relativePath}) from the project root. ` +
      "Run the build from the repository root so /sample can generate its report.",
  );
}

/** 构建期生成一次；同一份 fixture 的两次构建结果逐字节一致（确定性）。 */
const SAMPLE: SampleReportBundle = buildSampleReport(readSampleFixture());

const mono = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--ink-500)",
  lineHeight: 1.7,
} as const;

function scoreColor(score: number): string {
  if (score >= 80) return "var(--teal)";
  if (score >= 60) return "var(--ink-300)";
  return "var(--clay)";
}

export default function SamplePage() {
  const { report } = SAMPLE;
  const sample = report.meta.sample;

  return (
    <>
      <TopBar />
      <main>
        <section className="inner">
          <div className="wrap report-wrap">
            {/* 合成数据声明：页面第一屏可见 */}
            <div className="mock-badge" style={{ marginBottom: 14 }}>
              {SAMPLE_PAGE.notice}
            </div>

            <div className="report-hero">
              <p className="sec-label">{SAMPLE_PAGE.eyebrow}</p>
              <div className="report-score">
                <span className="num tnum">{report.headline.score}</span>
                <span className="label">
                  / 100 · {report.headline.scoreLabel}
                </span>
                <span className="grade-chip" style={{ marginLeft: 8 }}>
                  Grade {report.headline.grade}
                </span>
              </div>
              <p className="report-summary">{report.headline.oneLineSummary}</p>
              <p style={mono}>
                {sample.messages} messages · {sample.dateRange} · confidence{" "}
                {Math.round(report.headline.confidence * 100)}% ({report.headline.confidenceLabel})
                <br />
                Speakers: {SAMPLE_SPEAKERS.user} (you) and {SAMPLE_SPEAKERS.partner} (them) · generated{" "}
                {report.meta.generatedAt}
              </p>
              <p style={{ ...mono, marginTop: 14 }}>{SAMPLE_PAGE.lede}</p>

              <div className="report-actions" style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                <Link className="btn-cta" href={SAMPLE_PAGE.cta.href}>
                  {SAMPLE_PAGE.cta.label} <span className="arr" aria-hidden="true">→</span>
                </Link>
              </div>
              <p className="cta-fine">{SAMPLE_PAGE.cta.note}</p>
            </div>

            {/* 生成方式说明（事实，不是营销话术） */}
            <div className="report-chapter">
              <p className="ch-label">{SAMPLE_PAGE.provenanceHeading}</p>
              <h3>Generated from a synthetic export, not a mock-up</h3>
              <ul style={{ margin: "10px 0 0 20px", display: "grid", gap: 10, fontSize: 15, color: "var(--ink-700)", lineHeight: 1.65 }}>
                {SAMPLE_PAGE.provenance.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p style={{ marginTop: 14, fontSize: 14.5, color: "var(--ink-500)", lineHeight: 1.6 }}>
                {SAMPLE_PAGE.provenanceNote}
              </p>
              <p style={{ ...mono, marginTop: 10 }}>
                Source: {SAMPLE_FIXTURE.label} · {SAMPLE_FIXTURE.description}
              </p>
            </div>

            {/* 六章正文 */}
            {report.chapters.map((chapter) => (
              <div className="report-chapter" key={chapter.id}>
                <p className="ch-label">Chapter {String(chapter.number).padStart(2, "0")}</p>
                <h3>{chapter.title}</h3>
                <SampleChapterBody chapter={chapter} />
              </div>
            ))}

            {/* 免责声明 + 版本信息（证明是真实引擎产物，可按版本复算） */}
            <div className="report-chapter">
              <p className="ch-label">{SAMPLE_PAGE.disclaimerHeading}</p>
              <p>{report.disclaimer}</p>
              <p style={{ ...mono, marginTop: 10 }}>
                Report schema {report.meta.schemaVersion} · weights {report.meta.weightsVersion} ·
                metrics {report.meta.metricsVersion} · attachment rules{" "}
                {report.meta.attachmentRuleVersion} · generated {report.meta.generatedAt}
              </p>
            </div>

            {/* 相关阅读（内链） */}
            <div className="report-chapter">
              <p className="ch-label">Related</p>
              <nav aria-label="Related pages" style={{ display: "grid", gap: 4, marginTop: 8 }}>
                {SAMPLE_PAGE.links.map((link) => (
                  <Link className="sample-link" href={link.href} key={link.href}>
                    {link.label} <span className="arr" aria-hidden="true">→</span>
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

/* ===== 六章渲染（复用 /report 的样式类，但不 import 它的组件） ===== */

function SampleChapterBody({ chapter }: { chapter: ReportChapter }) {
  switch (chapter.id) {
    case "at-a-glance":
      return (
        <>
          <p>{chapter.summary}</p>
          <div style={{ marginTop: 14 }}>
            {chapter.dimensions.map((dimension) => (
              <div key={dimension.id}>
                <MetricRow
                  label={`${dimension.label} · weight ${dimension.weight}%`}
                  value={`${dimension.score}/100`}
                />
                <Track value={dimension.score} color={scoreColor(dimension.score)} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <MetricRow label="Attachment (you)" value={chapter.attachment.label} />
            <MetricRow
              label="Confidence"
              value={`${Math.round(chapter.confidence * 100)}% (${chapter.confidenceLabel})`}
            />
          </div>
          {chapter.dataNotEnough && (
            <p style={{ marginTop: 10, color: "var(--ink-500)" }}>
              Not enough data for a stable picture yet — the scores above are provisional.
            </p>
          )}
        </>
      );

    case "attachment":
      return (
        <>
          <p>{chapter.summary}</p>
          <div style={{ marginTop: 14 }}>
            {chapter.sides.map((side) => (
              <div className="risk-card" key={side.role}>
                <div className="risk-head">
                  <span className={`risk-level ${side.direction === "secure" ? "low" : "mid"}`}>
                    {side.label}
                  </span>
                  <span className="risk-label">{side.heading}</span>
                </div>
                <p>
                  {side.scores.anxious} anxious / {side.scores.avoidant} avoidant /{" "}
                  {side.scores.secure} secure · confidence {Math.round(side.confidence * 100)}%
                </p>
                <p style={{ color: "var(--ink-500)" }}>{side.note}</p>
                <ul style={{ margin: "10px 0 0 18px", fontSize: 14, color: "var(--ink-700)", lineHeight: 1.6 }}>
                  {side.topSignals.map((signal) => (
                    <li key={signal.id}>
                      <strong>{signal.label}</strong> — strength{" "}
                      {Math.round(signal.strength * 100)}%
                      {signal.evidenceIds.length > 0
                        ? ` · ${signal.evidenceIds.length} evidence message(s)`
                        : " · summary signal"}
                      <br />
                      <span style={{ color: "var(--ink-500)" }}>{signal.explain}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      );

    case "health":
      return (
        <>
          <p>{chapter.summary}</p>
          <div style={{ marginTop: 14 }}>
            {chapter.dimensions.map((dimension) => (
              <div key={dimension.id}>
                <MetricRow
                  label={`${dimension.label} · weight ${dimension.weight}%`}
                  value={`${dimension.score}/100`}
                />
                <Track value={dimension.score} color={scoreColor(dimension.score)} />
                <p style={{ fontSize: 14, color: "var(--ink-700)", lineHeight: 1.6 }}>
                  {dimension.reading}
                </p>
              </div>
            ))}
          </div>
          <p className="ch-label" style={{ marginTop: 22 }}>
            The ten measures
          </p>
          {chapter.metrics.map((metric) => (
            <div key={metric.id} style={{ padding: "10px 0", borderTop: "1px solid var(--sand-line)" }}>
              <MetricRow label={metric.label} value={metric.displayValue} />
              <p style={{ fontSize: 14, color: "var(--ink-700)", lineHeight: 1.6 }}>
                {metric.reading}
                {metric.proxy ? " (proxy measure)" : ""}
                {metric.value !== null
                  ? ` Confidence ${Math.round(metric.confidence * 100)}%, n=${metric.sampleSize}.`
                  : ""}
              </p>
            </div>
          ))}
        </>
      );

    case "turning-points":
      return (
        <>
          <p>{chapter.summary}</p>
          {chapter.points.length === 0 ? (
            <p style={{ marginTop: 12 }}>
              Not enough data to identify turning points in this export.
            </p>
          ) : (
            chapter.points.map((point) => (
              <div className="plan-item" key={point.id}>
                <span className="day tnum">{point.dateLabel}</span>
                <div>
                  <p className="action">{point.label}</p>
                  <p className="goal">{point.detail}</p>
                </div>
              </div>
            ))
          )}
        </>
      );

    case "evidence-confidence":
      return (
        <>
          <p>{chapter.summary}</p>
          <div style={{ marginTop: 10 }}>
            <MetricRow label="Evidence quotes" value={`${chapter.evidenceCount}`} />
            <MetricRow
              label="Data confidence"
              value={`${Math.round(chapter.confidence * 100)}% (${chapter.confidenceLabel})`}
            />
          </div>
          {chapter.quotes.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {chapter.quotes.map((quote) => (
                <div className="risk-card" key={`${quote.messageId}-${quote.chapterId}`} style={{ marginBottom: 10 }}>
                  <p style={{ ...mono, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 11.5 }}>
                    {quote.dateLabel} · {quote.messageId} · {quote.chapterId}
                  </p>
                  <p style={{ fontStyle: "italic" }}>&ldquo;{quote.quote}&rdquo;</p>
                </div>
              ))}
            </div>
          )}
          <p className="ch-label" style={{ marginTop: 20 }}>
            What we don&apos;t know
          </p>
          <ul style={{ margin: "8px 0 0 18px", fontSize: 14.5, color: "var(--ink-700)", lineHeight: 1.7 }}>
            {chapter.whatWeDontKnow.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="ch-label" style={{ marginTop: 20 }}>
            Method notes
          </p>
          <ul style={{ margin: "8px 0 0 18px", fontSize: 14, color: "var(--ink-500)", lineHeight: 1.7 }}>
            {chapter.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      );

    case "next-7-days":
      return (
        <>
          <p>{chapter.summary}</p>
          {chapter.focusDimensions.length > 0 && (
            <p style={{ ...mono, marginTop: 8 }}>Focus: {chapter.focusDimensions.join(" · ")}</p>
          )}
          {chapter.actions.map((action) => (
            <div className="plan-item" key={action.day}>
              <span className="day tnum">{action.dayLabel}</span>
              <div>
                <p className="action">{action.action}</p>
                <p className="goal">{action.why}</p>
              </div>
            </div>
          ))}
        </>
      );

    default:
      return null;
  }
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <span className="m-label">{label}</span>
      <span style={{ flex: 1 }} />
      <span className="m-val tnum">{value}</span>
    </div>
  );
}

function Track({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "center", padding: "4px 0" }}>
      <span style={{ flex: 1 }} />
      <span className="track" style={{ gridColumn: 2 }}>
        <span className="fill" style={{ width: `${value}%`, background: color }} />
      </span>
    </div>
  );
}
