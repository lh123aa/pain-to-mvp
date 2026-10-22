"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Footer, TopBar } from "../components";
import { buildDemoReport } from "../../lib/checkout";
import { DEMO_REPORT, ReportData } from "../../lib/demo-report";
import { buildReportV2 } from "../../lib/report-engine";
import {
  REPORT_STORAGE_KEY,
  isStoredReportInput,
  type ReportChapter,
  type ReportDataV2,
} from "../../lib/report-contract";
import { track } from "../hooks";
import {
  CHECKOUT_ID_STORAGE_KEY,
  CHECKOUT_MODE_STORAGE_KEY,
  decideInitialAccess,
  detectLiveMode,
  extractVerifiedOrder,
  interpretVerifyResponse,
  type AccessMode,
  type InvalidReason,
  type VerifiedOrderView,
  type WaitingReason,
} from "../../lib/report-access";

/**
 * /report — 完整报告页（6 章）
 *
 * 访问门（P1 支付闭环）：
 * - `?token=xxx`（邮件魔链）→ 调 /api/verify-magic-link?token= 验证，ready 才渲染；
 * - `?order_id=xxx`（旧版直查）→ 调 /api/verify-magic-link?order_id=；
 * - `?checkout=PENDING`（LS 支付回跳占位）→ 等待态（webhook 可能还没处理完）；
 * - live 模式无有效凭证 → 等待态，**绝不**渲染 DEMO_REPORT；
 * - mock 模式 → 保持原有演示体验（MOCK- 订单 / preview / 裸访问）。
 * 决策逻辑在 src/lib/report-access.ts，本页只负责执行与展示。
 */

type AccessState =
  | { kind: "checking" }
  | {
      kind: "report";
      source: "mock" | "token" | "order";
      order: VerifiedOrderView | null;
    }
  | { kind: "waiting"; reason: WaitingReason }
  | { kind: "invalid"; reason: InvalidReason; message?: string };

/** The locally built report plus the metadata we want to show in the header. */
type LocalReportState = {
  report: ReportDataV2;
  fileName: string;
  speakers: { user: string; partner: string };
  createdAt: string;
};

/**
 * Read `tell:features:v1` (written by /analyze) and build the real report.
 *
 * Privacy architecture: the raw chat never leaves the browser, so the report
 * page can only show real data when this browser holds the analysis. The
 * sessionStorage write is the primary source; localStorage is read as a
 * fallback for the "reopen the tab" case. Any problem (missing key, bad JSON,
 * wrong schema, engine failure) returns null so the page falls back instead of
 * crashing.
 */
function readLocalReport(): LocalReportState | null {
  if (typeof window === "undefined") return null;
  // sessionStorage first (primary contract), localStorage as the reopen fallback.
  // Each area is attempted independently: a corrupt entry in one area must not
  // hide a valid entry in the other.
  let storages: Storage[];
  try {
    storages = [window.sessionStorage, window.localStorage];
  } catch {
    return null;
  }
  for (const storage of storages) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(REPORT_STORAGE_KEY);
    } catch {
      continue;
    }
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isStoredReportInput(parsed)) continue;
      const report = buildReportV2(parsed.features, parsed.conversation, {
        generatedAt: parsed.createdAt,
      });
      return {
        report,
        fileName: parsed.fileName || "(unknown export)",
        speakers: parsed.speakers,
        createdAt: parsed.createdAt,
      };
    } catch {
      continue;
    }
  }
  return null;
}

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
  const [access, setAccess] = useState<AccessState>({ kind: "checking" });
  const [checkoutRef, setCheckoutRef] = useState<string | null>(null);
  const [localReport, setLocalReport] = useState<LocalReportState | null>(null);
  const [localReportChecked, setLocalReportChecked] = useState(false);

  const token = sp.get("token");
  const checkout = sp.get("checkout");
  const orderIdParam = sp.get("order_id");
  const preview = sp.get("preview");
  const publicLiveFlag = process.env.NEXT_PUBLIC_LEMON_SQUEEZY_LIVE;

  useEffect(() => {
    let cancelled = false;

    // 用 async IIFE：所有 setState 都发生在异步回调里，避免 effect 内同步 setState
    // 触发级联渲染（react-hooks/set-state-in-effect）。
    void (async () => {
      // live 判定：checkout 页写入的 sessionStorage 提示最可信；否则用部署时的
      // NEXT_PUBLIC_ 标志（见 lib/report-access.ts 说明）。
      const modeHint = readSession(CHECKOUT_MODE_STORAGE_KEY);
      const mode: AccessMode =
        modeHint === "mock"
          ? "mock"
          : detectLiveMode({ NEXT_PUBLIC_LEMON_SQUEEZY_LIVE: publicLiveFlag }) ||
              modeHint === "live"
            ? "live"
            : "mock";

      if (cancelled) return;
      setCheckoutRef(readSession(CHECKOUT_ID_STORAGE_KEY));

      const decision = decideInitialAccess({
        mode,
        token,
        checkout,
        orderId: orderIdParam,
        preview,
      });
      if (cancelled) return;

      if (decision.kind === "show-report") {
        setAccess({ kind: "report", source: decision.source, order: null });
        track("report_view", { source: decision.source, mode });
        return;
      }
      if (decision.kind === "show-waiting") {
        setAccess({ kind: "waiting", reason: decision.reason });
        track("report_waiting", { reason: decision.reason, mode });
        return;
      }
      if (decision.kind === "show-invalid") {
        setAccess({
          kind: "invalid",
          reason: decision.reason,
          message: decision.message,
        });
        track("report_invalid", { reason: decision.reason, mode });
        return;
      }

      const source = decision.kind === "verify-token" ? "token" : "order";
      const url =
        decision.kind === "verify-token"
          ? `/api/verify-magic-link?token=${encodeURIComponent(decision.token)}`
          : `/api/verify-magic-link?order_id=${encodeURIComponent(decision.orderId)}`;

      try {
        const res = await fetch(url, { cache: "no-store" });
        const payload: unknown = await res.json().catch(() => ({}));
        if (cancelled) return;

        const interpreted = interpretVerifyResponse(res.status, payload, source);
        if (interpreted.kind === "show-report") {
          setAccess({
            kind: "report",
            source,
            order: extractVerifiedOrder(payload),
          });
          track("report_view", { source, mode, ok: true });
        } else if (interpreted.kind === "show-waiting") {
          setAccess({ kind: "waiting", reason: interpreted.reason });
          track("report_waiting", { reason: interpreted.reason, mode });
        } else if (interpreted.kind === "show-invalid") {
          setAccess({
            kind: "invalid",
            reason: interpreted.reason,
            message: interpreted.message,
          });
          track("report_invalid", { reason: interpreted.reason, mode });
        }
      } catch (err) {
        if (cancelled) return;
        setAccess({
          kind: "invalid",
          reason: "error",
          message: err instanceof Error ? err.message : "Verification failed",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, checkout, orderIdParam, preview, publicLiveFlag]);

  // LS 回跳 URL 是服务端静态配置（/report?checkout=PENDING），无法带 checkout id；
  // 进入等待态后把本会话记录的 checkout id 追加到当前 URL（?ref=chk_xxx），
  // 便于用户报障/客服排查，也让「回跳 URL 带 checkout id」在浏览器层成立。
  useEffect(() => {
    if (access.kind !== "waiting" || access.reason !== "payment-pending" || !checkoutRef) {
      return;
    }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("ref") === checkoutRef) return;
      url.searchParams.set("ref", checkoutRef);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* 忽略：历史 API 不可用不影响等待态展示 */
    }
  }, [access, checkoutRef]);

  // 本地真实报告：/analyze 写入 `tell:features:v1`。读取 + 构报告都放在 effect 里，
  // 避免 SSR/hydration 不一致；解析失败返回 null，页面按「无本地数据」降级。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = readLocalReport();
      if (cancelled) return;
      setLocalReport(loaded);
      setLocalReportChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 报告数据：live 用已验证订单的 custom；mock 用 preview / 演示内核
  const report: ReportData = useMemo(() => {
    if (access.kind !== "report") return DEMO_REPORT;

    if (access.source === "mock") {
      if (preview) {
        try {
          const pad = preview.replace(/-/g, "+").replace(/_/g, "/");
          const json = JSON.parse(
            atob(pad.padEnd(pad.length + ((4 - (pad.length % 4)) % 4), "="))
          ) as Record<string, unknown>;
          return buildDemoReport({
            fileName: String(json.fileName || "(pasted)"),
            speakerA: String(json.speakerA || "You"),
            speakerB: String(json.speakerB || "Them"),
          });
        } catch {
          /* 解析失败落回演示 */
        }
      }
      return DEMO_REPORT;
    }

    const custom = access.order?.custom;
    if (custom) {
      return buildDemoReport({
        fileName: String(custom.fileName || "(uploaded)"),
        speakerA: String(custom.speakerA || "You"),
        speakerB: String(custom.speakerB || "Them"),
      });
    }
    // live 已验证但订单没有 custom（如 LS API 回落查询）：仍展示报告骨架
    return DEMO_REPORT;
  }, [access, preview]);

  /* ===== 访问门状态页 ===== */

  if (access.kind === "checking") {
    return (
      <StatusScreen
        label="Checking your purchase"
        title="One moment…"
        message="We're verifying your access to this report."
      >
        <span className="mock-badge">Verifying access</span>
      </StatusScreen>
    );
  }

  if (access.kind === "invalid") {
    const copy = INVALID_COPY[access.reason];
    return (
      <StatusScreen label="Access unavailable" title={copy.title} message={copy.message}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <button className="btn-cta" style={{ width: "auto" }} onClick={() => router.push("/")}>
            Back to home
          </button>
          <a
            className="btn-secondary"
            href="/refund"
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            Refund policy
          </a>
          <a
            className="btn-secondary"
            href="/notice"
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            Contact support
          </a>
        </div>
      </StatusScreen>
    );
  }

  if (access.kind === "waiting") {
    const pending = access.reason === "payment-pending";
    return (
      <StatusScreen
        label={pending ? "Payment received" : "One more step"}
        title={pending ? "Your report is being prepared" : "Open the magic link from your email"}
        message={
          pending
            ? "Thanks for your purchase. We're generating your report — this usually takes a few seconds. We've also emailed you a magic link to the address you paid with; it works for 7 days."
            : "For security, the full report opens from the magic link we email after purchase. Check your inbox (and spam) for the message from The Tell."
        }
      >
        {checkoutRef && (
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-500)" }}>
            Checkout reference: {checkoutRef}
          </p>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            className="btn-cta"
            style={{ width: "auto" }}
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
          <a
            className="btn-secondary"
            href="/refund"
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            Refund policy
          </a>
          <a
            className="btn-secondary"
            href="/notice"
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            Need help?
          </a>
        </div>
      </StatusScreen>
    );
  }

  /* ===== 报告正文 ===== */
  const isMock = access.source === "mock";

  // 访问门已通过（mock 或已验证 token/order）。有本机分析数据 → 渲染真实六章报告；
  // 没有时：mock 保留演示报告，live 绝不回落到 demo（报告数据只在执行分析的浏览器里）。
  if (!localReportChecked) {
    return (
      <StatusScreen
        label="Opening your report"
        title="One moment…"
        message="Reading the analysis that was built in this browser."
      >
        <span className="mock-badge">Loading report data</span>
      </StatusScreen>
    );
  }

  if (localReport) {
    return (
      <RealReportView
        state={localReport}
        isMock={isMock}
        onRefund={() => router.push("/refund")}
      />
    );
  }

  if (!isMock) {
    return (
      <StatusScreen
        label="Report data not found"
        title="This report lives in the browser that ran the analysis"
        message="For privacy, your chat was never uploaded - the report is built locally from your analysis. Open this magic link in the same browser you used to analyze the chat, or run a new analysis on this device."
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <button className="btn-cta" style={{ width: "auto" }} onClick={() => router.push("/analyze")}>
            Analyze a chat
          </button>
          <button
            className="btn-secondary"
            style={{ width: "auto" }}
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
          <a className="btn-secondary" href="/notice" style={{ display: "inline-flex", alignItems: "center" }}>
            Need help?
          </a>
        </div>
      </StatusScreen>
    );
  }

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

/* ===== 状态页 / 子组件 ===== */

const INVALID_COPY: Record<InvalidReason, { title: string; message: string }> = {
  expired: {
    title: "Your magic link has expired",
    message:
      "Magic links are valid for 7 days. Look for a newer email, or reply to your receipt and we'll send a fresh link.",
  },
  invalid: {
    title: "This link is invalid",
    message:
      "The link looks incomplete or was altered. Please open the magic link from your purchase email again.",
  },
  revoked: {
    title: "This order is no longer active",
    message:
      "The purchase was refunded or canceled, so report access has been revoked. See the refund policy for details.",
  },
  "not-found": {
    title: "We couldn't find that order",
    message:
      "Check that you opened the link from your purchase email. If it still doesn't work, contact support.",
  },
  error: {
    title: "We couldn't verify your purchase",
    message:
      "Something went wrong on our side. Wait a moment and refresh, or contact support if it keeps happening.",
  },
};

function StatusScreen({
  label,
  title,
  message,
  children,
}: {
  label: string;
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <TopBar />
      <section className="inner">
        <div
          className="wrap"
          style={{ maxWidth: 620, textAlign: "center", padding: "80px 24px" }}
        >
          <p className="sec-label">{label}</p>
          <h1 style={{ fontSize: 26, margin: "12px 0" }}>{title}</h1>
          <p
            style={{
              color: "var(--ink-500)",
              fontSize: 14.5,
              lineHeight: 1.65,
              margin: "0 auto 22px",
              maxWidth: 500,
            }}
          >
            {message}
          </p>
          <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>{children}</div>
        </div>
      </section>
      <Footer />
    </>
  );
}

function readSession(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
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

/* ===== 真实报告（ReportDataV2 · 六章） ===== */

function scoreColor(score: number): string {
  if (score >= 80) return "var(--teal)";
  if (score >= 60) return "var(--ink-300)";
  return "var(--clay)";
}

/** 从本地特征构建出的六章报告（全英文、带证据与置信度）。 */
function RealReportView({
  state,
  isMock,
  onRefund,
}: {
  state: LocalReportState;
  isMock: boolean;
  onRefund: () => void;
}) {
  const { report, fileName, speakers } = state;
  return (
    <>
      <TopBar />
      <section className="inner">
        <div className="wrap report-wrap">
          {isMock && (
            <div className="mock-badge" style={{ marginBottom: 16 }}>
              Demo checkout — this report was built locally from your upload
            </div>
          )}

          <div className="report-hero">
            <p className="sec-label">The Tell · Relationship Report</p>
            <div className="report-score">
              <span className="num tnum">{report.headline.score}</span>
              <span className="label">/ 100 · {report.headline.scoreLabel}</span>
              <span className="grade-chip" style={{ marginLeft: 8 }}>
                Grade {report.headline.grade}
              </span>
            </div>
            <p className="report-summary">{report.headline.oneLineSummary}</p>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "var(--ink-500)",
                lineHeight: 1.7,
              }}
            >
              {fileName} · {speakers.user} vs {speakers.partner}
              <br />
              {report.meta.sample.messages} messages · {report.meta.sample.dateRange} · confidence{" "}
              {Math.round(report.headline.confidence * 100)}% ({report.headline.confidenceLabel})
            </p>

            <div className="report-actions" style={{ display: "flex", gap: 12, marginTop: 18 }}>
              <button className="btn-cta" onClick={() => window.print()} style={{ width: "auto" }}>
                Download PDF <span className="arr">↓</span>
              </button>
              <button className="btn-secondary" onClick={onRefund} style={{ alignSelf: "center" }}>
                Request refund
              </button>
            </div>
          </div>

          {report.chapters.map((chapter) => (
            <Chapter
              key={chapter.id}
              n={String(chapter.number).padStart(2, "0")}
              title={chapter.title}
            >
              <ChapterBody chapter={chapter} />
            </Chapter>
          ))}

          <div className="report-chapter" style={{ borderBottom: "1px solid var(--sand-line)" }}>
            <p className="ch-label">Disclaimer</p>
            <p>{report.disclaimer}</p>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--ink-500)",
                marginTop: 10,
              }}
            >
              Report schema {report.meta.schemaVersion} · weights {report.meta.weightsVersion} ·
              metrics {report.meta.metricsVersion} · generated {report.meta.generatedAt}
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

function ChapterBody({ chapter }: { chapter: ReportChapter }) {
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
                  val={`${dimension.score}/100`}
                />
                <Track value={dimension.score} color={scoreColor(dimension.score)} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <MetricRow label="Attachment (you)" val={chapter.attachment.label} />
            <MetricRow
              label="Confidence"
              val={`${Math.round(chapter.confidence * 100)}% (${chapter.confidenceLabel})`}
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
                  {side.scores.anxious} anxious / {side.scores.avoidant} avoidant / {side.scores.secure}{" "}
                  secure · confidence {Math.round(side.confidence * 100)}%
                </p>
                <p style={{ color: "var(--ink-500)" }}>{side.note}</p>
                <ul
                  style={{
                    margin: "10px 0 0 18px",
                    fontSize: 14,
                    color: "var(--ink-700)",
                    lineHeight: 1.6,
                  }}
                >
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
                  val={`${dimension.score}/100`}
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
              <MetricRow label={metric.label} val={metric.displayValue} />
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
            <MetricRow label="Evidence quotes" val={`${chapter.evidenceCount}`} />
            <MetricRow
              label="Data confidence"
              val={`${Math.round(chapter.confidence * 100)}% (${chapter.confidenceLabel})`}
            />
          </div>
          {chapter.quotes.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {chapter.quotes.map((quote) => (
                <div
                  className="risk-card"
                  key={`${quote.messageId}-${quote.chapterId}`}
                  style={{ marginBottom: 10 }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--ink-500)",
                    }}
                  >
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
          <ul
            style={{
              margin: "8px 0 0 18px",
              fontSize: 14.5,
              color: "var(--ink-700)",
              lineHeight: 1.7,
            }}
          >
            {chapter.whatWeDontKnow.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="ch-label" style={{ marginTop: 20 }}>
            Method notes
          </p>
          <ul
            style={{
              margin: "8px 0 0 18px",
              fontSize: 14,
              color: "var(--ink-500)",
              lineHeight: 1.7,
            }}
          >
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
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--ink-500)",
                marginTop: 8,
              }}
            >
              Focus: {chapter.focusDimensions.join(" · ")}
            </p>
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
