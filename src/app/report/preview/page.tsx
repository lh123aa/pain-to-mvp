"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Footer, TopBar } from "../../components";
import { buildDemoReport } from "../../../lib/checkout";
import { ReportData } from "../../../lib/demo-report";
import { track } from "../../hooks";

/**
 * 免费预览（free cards + paywall）
 * 数据源：localStorage 的 tell:input（上传页写入）；没有则用占位合成数据。
 * 真实内核到位后，这里被真解析 + 规则引擎结果替换（数据契约不变）。
 */

type InputState = {
  fileName: string;
  speakerA: string;
  speakerB: string;
  pasted: string;
};

function readInput(): InputState {
  if (typeof window === "undefined")
    return { fileName: "(sample)", speakerA: "You", speakerB: "Them", pasted: "" };
  try {
    const raw = localStorage.getItem("tell:input");
    if (raw) return JSON.parse(raw) as InputState;
  } catch {
    /* noop */
  }
  return { fileName: "(sample)", speakerA: "You", speakerB: "Them", pasted: "" };
}

export default function PreviewPage() {
  const router = useRouter();
  const [input] = useState<InputState>(readInput);

  // demo 报告（按 speaker 定制文案）
  const report: ReportData = useMemo(() => {
    return buildDemoReport({
      fileName: input.fileName,
      speakerA: input.speakerA,
      speakerB: input.speakerB,
    });
  }, [input]);

  useEffect(() => {
    track("freecards_view", { source: "preview" });
  }, []);

  async function onBuy() {
    track("freecards_buy_click", {});
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: input.fileName,
        speakerA: input.speakerA,
        speakerB: input.speakerB,
        pasted: input.pasted,
      }),
    });
    const data = await res.json();
    router.push(data.url); // mock → /report?checkout=MOCK-..  真 → Lemon Squeezy 托管页
  }

  return (
    <>
      <style>{styleTag}</style>
      <TopBar />
      <section className="inner">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <div className="inner-head">
            <p className="sec-label">Free preview · {report.evidenceCount} evidence points</p>
            <h1>Your free cards</h1>
            <p>
              Three of the six report chapters, free. These are the ones most likely to change
              how you read your next conversation.
            </p>
          </div>

          <FreeCard
            n="01"
            title="Attachment Patterns"
            body={report.attachmentNote}
            highlight={`${report.attachment} · ${report.scoreLabel}`}
            locked
          />
          <FreeCard
            n="02"
            title="Communication Health"
            body={report.initiativeNote}
            highlight={`${report.score}/100 · ${report.grade}`}
            locked
          />
          <FreeCard
            n="03"
            title="Risk Signals"
            body={report.risks[0]?.advice}
            highlight={report.risks[0]?.label}
            locked
          />

          {/* 支付墙 */}
          <div className="paywall">
            <div className="pw-title">Unlock the full 6-chapter report</div>
            <p className="pw-sub">
              Turning points, the 7-day action plan, and every piece of evidence — plus a
              printable PDF. One-time <span className="tnum">$14.99</span>, no subscription.
            </p>
            <button className="btn-cta" onClick={onBuy}>
              Unlock full report <span className="arr">→</span>
            </button>
            <p className="pw-fine">
              7-day no-questions refund · Data deleted after 90 days
            </p>
            <p className="pw-try" style={{ marginTop: 10 }}>
              <a
                href="/report"
                style={{ color: "var(--scan)", fontSize: 13, textDecoration: "underline" }}
                onClick={(e) => {
                  e.preventDefault();
                  onBuy();
                }}
              >
                Not ready? Preview the full sample report first →
              </a>
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

/* ===== 子组件 ===== */

function FreeCard({
  n,
  title,
  body,
  highlight,
  locked,
}: {
  n: string;
  title: string;
  body: string;
  highlight?: string;
  locked?: boolean;
}) {
  return (
    <div className={`free-card${locked ? " locked" : ""}`}>
      <div className="fc-head">
        <span className="fc-num tnum">{n}</span>
        <span className="fc-title">{title}</span>
        {locked && <LockIcon />}
      </div>
      {highlight && <p className="fc-highlight tnum">{highlight}</p>}
      <p className="fc-body">{body}</p>
    </div>
  );
}

function LockIcon() {
  return (
    <svg className="fc-lock" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2.5" y="6" width="9" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/* 本页专用样式 */
const styleTag = `
.free-card{border:1px solid var(--sand-line);border-radius:var(--r-card);background:#fff;padding:22px 24px;margin-bottom:16px;position:relative}
.free-card.locked{background:linear-gradient(180deg,#fff 0%,var(--sand) 100%)}
.fc-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.fc-num{font-family:var(--font-mono);font-size:12px;color:var(--ink-300)}
.fc-title{font-size:17px;font-weight:700}
.fc-lock{margin-left:auto;color:var(--ink-300)}
.fc-highlight{font-size:15px;font-weight:700;color:var(--teal);margin-bottom:8px}
.fc-body{font-size:14.5px;color:var(--ink-700);line-height:1.65}
.paywall{margin-top:32px;border:1px solid var(--sand-line);border-radius:var(--r-card);background:var(--ink-900);color:var(--paper);padding:30px 28px;text-align:center}
.pw-title{font-size:20px;font-weight:700;margin-bottom:8px}
.pw-sub{font-size:14.5px;color:rgba(251,250,247,.85);margin-bottom:18px}
.paywall .btn-cta{margin-bottom:14px}
.pw-fine{font-size:12.5px;color:var(--ink-300)}
`;
