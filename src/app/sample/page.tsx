"use client";
import { useEffect } from "react";
import { Footer, TopBar } from "../components";
import { DEMO_REPORT } from "../../lib/demo-report";
import { track } from "../hooks";

/**
 * /sample — 完整样例报告（SEO 落地 + 转化漏斗）
 * 直接渲染演示内核（CASE-001 94/100），无需 checkout，供「See a full sample report」入口使用。
 */
export default function SamplePage() {
  const r = DEMO_REPORT;
  useEffect(() => {
    track("sample_view", {});
  }, []);

  return (
    <>
      <TopBar />
      <section className="inner">
        <div className="wrap report-wrap">
          <div className="mock-badge" style={{ marginBottom: 16 }}>
            Sample report — anonymized demo, not your data
          </div>

          <div className="report-hero">
            <p className="sec-label">The Tell · Sample Report</p>
            <div className="report-score">
              <span className="num tnum">{r.score}</span>
              <span className="label">/ 100 · {r.scoreLabel}</span>
              <span className="grade-chip" style={{ marginLeft: 8 }}>
                Grade {r.grade}
              </span>
            </div>
            <p className="report-summary">{r.summary}</p>
            <div className="report-actions" style={{ display: "flex", gap: 12, marginTop: 18 }}>
              <a className="btn-cta" href="/analyze">
                Analyze my chat <span className="arr">→</span>
              </a>
              <button className="btn-secondary" onClick={() => window.print()}>
                Download this sample
              </button>
            </div>
          </div>

          <Chapter n="01" title="Attachment Patterns">
            <p>{r.attachmentNote}</p>
            <MetricRow label="Attachment" val={r.attachment} />
          </Chapter>

          <Chapter n="02" title="Communication Health">
            <p>{r.initiativeNote}</p>
            <MetricRow label="Initiative" val={`${r.replyBias}%`} />
            <MetricRow label="Late-night" val={`${r.lateRatio}%`} />
            <MetricRow label="Short replies" val={`${r.shortRatio}%`} />
          </Chapter>

          <Chapter n="03" title="Risk Signals">
            {r.risks.map((rk, i) => (
              <div className="risk-card" key={i}>
                <div className="risk-head">
                  <span className={`risk-level ${rk.level === "中" ? "mid" : "low"}`}>{rk.level}</span>
                  <span className="risk-label">{rk.label}</span>
                </div>
                <p>{rk.advice}</p>
              </div>
            ))}
          </Chapter>

          <Chapter n="04" title="Turning Points">
            <p>
              <span className="tnum" style={{ color: "var(--clay)" }}>{r.turningPoint.day}</span>
            </p>
            <p>{r.turningPoint.detail}</p>
          </Chapter>

          <Chapter n="05" title="Your 7-Day Plan">
            {r.actionPlan.map((a, i) => (
              <div className="plan-item" key={i}>
                <span className="day tnum">{a.day}</span>
                <div>
                  <p className="action">{a.action}</p>
                  <p className="goal">{a.goal}</p>
                </div>
              </div>
            ))}
          </Chapter>

          <Chapter n="06" title="What I Don&apos;t Know">
            <p>
              This report describes observable behavior, not feelings. It can&apos;t tell you what
              either of you was thinking at any moment. The &quot;fairly sure / less sure&quot; markers
              throughout reflect how much evidence backs each claim.
            </p>
          </Chapter>
        </div>
      </section>
      <Footer />
    </>
  );
}

function Chapter({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="report-chapter">
      <p className="ch-label">Chapter {n}</p>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function MetricRow({ label, val }: { label: string; val: string }) {
  return (
    <div className="metric-row">
      <span className="m-label">{label}</span>
      <span style={{ flex: 1 }} />
      <span className="m-val tnum">{val}</span>
    </div>
  );
}
