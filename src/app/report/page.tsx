"use client";
import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Footer, TopBar } from "../components";
import { buildDemoReport } from "../../lib/checkout";
import { DEMO_REPORT, ReportData } from "../../lib/demo-report";
import { track } from "../hooks";

/**
 * /report — 完整报告页（6 章）
 * 真实接入后：凭 magic-link token 调后端取真报告；当前 mock 用 query 里的 preview 数据或演示内核。
 * 魔法链回访占位：?checkout=MOCK-xxx → 直接展示（演示）；真实现时验签。
 */
export default function ReportPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading report…</div>}>
      <ReportInner />
    </Suspense>
  );
}

function ReportInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const isMock = (sp.get("checkout") || "").startsWith("MOCK-");

  // 解析 preview 参数（mock 时携带的输入），否则用纯演示
  const report: ReportData = useMemo(() => {
    const enc = sp.get("preview");
    if (enc && isMock) {
      try {
        const pad = enc.replace(/-/g, "+").replace(/_/g, "/");
        const json = JSON.parse(atob(pad.padEnd(pad.length + ((4 - (pad.length % 4)) % 4), "=")));
        return buildDemoReport({
          fileName: json.fileName,
          speakerA: json.speakerA,
          speakerB: json.speakerB,
        });
      } catch {
        /* 解析失败落回演示 */
      }
    }
    return DEMO_REPORT;
  }, [sp, isMock]);

  useEffect(() => {
    track("report_view", { mock: isMock, checkout: sp.get("checkout") });
  }, [isMock, sp]);

  return (
    <>
      <TopBar />
      <section className="inner">
        <div className="wrap report-wrap">
          {isMock && (
            <div className="mock-badge" style={{ marginBottom: 16 }}>
              Demo report — your data is synthesized for this preview
            </div>
          )}

          {/* 报告头 */}
          <div className="report-hero">
            <p className="sec-label">The Tell · Relationship Report</p>
            <div className="report-score">
              <span className="num tnum">{report.score}</span>
              <span className="label">/ 100 · {report.scoreLabel}</span>
              <span className="grade-chip" style={{ marginLeft: 8 }}>
                Grade {report.grade}
              </span>
            </div>
            <p className="report-summary">{report.summary}</p>

            <div className="report-actions" style={{ display: "flex", gap: 12, marginTop: 18 }}>
              <button className="btn-cta" onClick={() => window.print()} style={{ width: "auto" }}>
                Download PDF <span className="arr">↓</span>
              </button>
              <button
                className="btn-secondary"
                onClick={() => router.push("/refund")}
                style={{ alignSelf: "center" }}
              >
                Request refund
              </button>
            </div>
          </div>

          {/* 第 1 章 · 依恋画像 */}
          <Chapter n="01" title="Attachment Patterns">
            <MetricRow label="Attachment" val={`${report.attachment}`} />
            <p>{report.attachmentNote}</p>
            <div style={{ marginTop: 14 }}>
              <MetricRow label="Reach" val="72" />
              <Track value={72} color="var(--teal)" />
              <MetricRow label="Guard" val="38" />
              <Track value={38} color="var(--clay)" />
              <MetricRow label="Repair" val="61" />
              <Track value={61} color="var(--ink-300)" />
            </div>
          </Chapter>

          {/* 第 2 章 · 沟通健康度 */}
          <Chapter n="02" title="Communication Health">
            <p>{report.initiativeNote}</p>
            <div style={{ marginTop: 14 }}>
              <MetricRow label="Initiative (you)" val={`${report.replyBias}%`} />
              <Track value={report.replyBias} color="var(--teal)" />
              <MetricRow label="Late-night" val={`${report.lateRatio}%`} />
              <Track value={report.lateRatio} color="var(--clay)" />
              <MetricRow label="Short replies" val={`${report.shortRatio}%`} />
              <Track value={report.shortRatio} color="var(--ink-300)" />
            </div>
          </Chapter>

          {/* 第 3 章 · 风险信号 */}
          <Chapter n="03" title="Risk Signals">
            {report.risks.map((r, i) => (
              <div className="risk-card" key={i}>
                <div className="risk-head">
                  <span className={`risk-level ${r.level === "中" ? "mid" : "low"}`}>{r.level}</span>
                  <span className="risk-label">{r.label}</span>
                </div>
                <p>{r.advice}</p>
              </div>
            ))}
          </Chapter>

          {/* 第 4 章 · 时间线转折 */}
          <Chapter n="04" title="Turning Points">
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 10 }}>
              <span className="chap-num tnum" style={{ color: "var(--clay)" }}>
                {report.turningPoint.day}
              </span>
            </div>
            <p>{report.turningPoint.detail}</p>
          </Chapter>

          {/* 第 5 章 · 7 天行动计划 */}
          <Chapter n="05" title="Your 7-Day Plan">
            {report.actionPlan.map((a, i) => (
              <div className="plan-item" key={i}>
                <span className="day tnum">{a.day}</span>
                <div>
                  <p className="action">{a.action}</p>
                  <p className="goal">{a.goal}</p>
                </div>
              </div>
            ))}
          </Chapter>

          {/* 第 6 章 · 我不知道的事 */}
          <Chapter n="06" title="What I Don&apos;t Know">
            <p>
              This report describes observable behavior, not feelings. It can&apos;t tell you what
              either of you was thinking at any moment. The &quot;fairly sure / less sure&quot; markers
              throughout reflect how much evidence backs each claim.
            </p>
          </Chapter>

          {/* 证据 & 来源 */}
          <div className="report-chapter" style={{ borderBottom: "1px solid var(--sand-line)" }}>
            <p className="ch-label">Methodology</p>
            <h3>Built on published attachment research</h3>
            <p>
              {report.evidenceCount} evidence points reviewed. Every finding links to the messages
              that support it. Read the full methodology at /methodology.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

/* ===== 子组件 ===== */

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
