"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Footer, TopBar } from "../../components";
import { track } from "../../hooks";
import type { FreeCard } from "@/rules";
import {
  loadLastInput,
  loadSession,
  type ClientSession,
  type LastInputMeta,
} from "@/lib/client-session";

/**
 * /report/preview — 免费预览（W2-1b）
 *
 * 数据源：`tell:features:v1`（/analyze 在浏览器内解析后写入）。
 * 本页只读特征，不碰原始导出全文；三张免费卡来自 features.preview.cards。
 * 没有本地特征时说明原因（本地解析、关标签页即消失）并链回 /analyze。
 */

function formatCount(value: number): string {
  return `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 把冻结的卡片数值翻译成一行可读的高亮（不改变卡片本身）。 */
function highlightFor(card: FreeCard): string | null {
  const value = card.value;
  switch (card.id) {
    case "reply_pace_gap":
      if (card.comparison) return card.comparison;
      return value === null ? null : `${Math.round(value)} min median reply`;
    case "initiation":
      return card.comparison;
    case "late_night":
      if (card.comparison) return card.comparison;
      return value === null ? null : `${Math.round(value)}% after 11pm`;
    case "message_balance":
      return card.comparison;
    case "double_texts":
      return value === null ? null : `${Math.round(value)}% back-to-back follow-ups`;
    case "conversation_turns":
      return value === null ? null : `${Math.round(value)} messages per turn`;
    default:
      return card.comparison;
  }
}

export default function PreviewPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [lastInput, setLastInput] = useState<LastInputMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = loadSession();
      const last = loadLastInput();
      if (cancelled) return;
      setSession(loaded);
      setLastInput(last);
      setReady(true);
      track("freecards_view", {
        source: loaded ? "live" : "missing",
        mode: loaded?.features.preview.mode,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <>
        <style>{styleTag}</style>
        <TopBar />
        <section className="inner">
          <div className="wrap" style={{ maxWidth: 720 }}>
            <div className="inner-head">
              <p className="sec-label">Free preview</p>
              <h1>Your free cards</h1>
              <p>Opening the preview kept in this tab…</p>
            </div>
          </div>
        </section>
        <Footer />
      </>
    );
  }

  if (!session) {
    return (
      <>
        <style>{styleTag}</style>
        <TopBar />
        <section className="inner">
          <div className="wrap" style={{ maxWidth: 720 }}>
            <div className="inner-head">
              <p className="sec-label">Free preview</p>
              <h1>Your free cards</h1>
              <p>
                Three signals from your chat, free. The full report turns the same local data into
                six chapters — attachment patterns, turning points, and an action plan.
              </p>
            </div>

            <div className="empty-state">
              <p className="es-title">This tab doesn&apos;t have a parsed conversation</p>
              <p>
                Uploads are parsed inside your browser and kept only in this tab&apos;s session.
                Opening this page directly, or in a new tab, means the derived data is gone — that
                is the privacy design, not a bug.
              </p>
              {lastInput && (
                <p className="es-meta">
                  Last attempt: <span className="tnum">{lastInput.fileName}</span> ·{" "}
                  {formatCount(lastInput.messageCount)} messages · {lastInput.dateRangeLabel}
                </p>
              )}
              <div className="cta-row" style={{ marginTop: 22 }}>
                <Link className="btn-cta" href="/analyze">
                  Upload your chat <span className="arr">→</span>
                </Link>
                <Link className="btn-secondary" href="/sample">
                  See a sample report first
                </Link>
              </div>
              <p className="es-fine">
                Nothing is uploaded, before or after payment. Read the{" "}
                <Link href="/privacy">privacy notice</Link>.
              </p>
            </div>
          </div>
        </section>
        <Footer />
      </>
    );
  }

  const features = session.features;
  const cards = features.preview.cards;
  const degraded = session.conversation.messages.length < features.sample.messageCount;
  const evidenceLabel =
    features.evidenceCount > 0
      ? `Free preview · ${formatCount(features.evidenceCount)} evidence points`
      : "Free preview · 3 cards";

  return (
    <>
      <style>{styleTag}</style>
      <TopBar />
      <section className="inner">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <div className="inner-head">
            <p className="sec-label">{evidenceLabel}</p>
            <h1>Your free cards</h1>
            <p>
              Three signals from your chat, free. The full report turns the same local data into six
              chapters — attachment patterns, turning points, and an action plan.
            </p>
          </div>

          <p className="sample-line">
            {session.fileName} · {formatCount(features.sample.messageCount)} messages ·{" "}
            {features.sample.dateRangeLabel}
            {" · "}you: {session.speakers.user} / them: {session.speakers.partner}
          </p>

          {cards.map((card, index) => (
            <FreeCardView
              key={card.id}
              n={String(index + 1).padStart(2, "0")}
              card={card}
              locked={false}
            />
          ))}

          {features.preview.mode === "untimed" && (
            <p className="note">
              No timestamps were found in this paste, so these cards use message counts instead of
              timing. The full report says so too and lowers its confidence.
            </p>
          )}
          {features.dataQuality.needsDateConfirmation && (
            <p className="note">
              The date format was never confirmed for this conversation, so timing numbers may be
              off. Upload it again from the free preview page to confirm it.
            </p>
          )}
          {features.dataQuality.lowSample && (
            <p className="note">
              Small sample: the full report will state the message count and lower its confidence
              instead of pretending the pattern is certain.
            </p>
          )}
          {degraded && (
            <p className="note">
              Large export: this tab kept only the messages the report cites, not the whole
              normalized conversation. The statistics in the cards still use the full sample.
            </p>
          )}

          <div className="origin">
            <p className="origin-title">How this preview was made</p>
            <p>
              Your file was opened and parsed inside this browser tab. Nothing was uploaded — not to
              us, not to any AI service. These three cards come from counting rules applied to the
              conversation: reply intervals, who starts a conversation, and the share of late-night
              messages.
            </p>
            <p>
              The full report adds attachment signals, turning points, and quoted evidence, all
              computed from the same local data.
            </p>
            <p className="origin-fine">
              Only the computed summary and a normalized copy of the conversation stay in this tab
              so the report page can cite evidence. They disappear when you close the tab. Read the{" "}
              <Link href="/methodology">methodology</Link>.
            </p>
          </div>

          <div className="paywall">
            <div className="pw-title">Unlock the full 6-chapter report</div>
            <p className="pw-sub">
              Attachment picture, communication health, turning points, evidence and confidence,
              plus a 7-day action plan and a printable PDF. One-time{" "}
              <span className="tnum">$14.99</span>, no subscription.
            </p>
            <Link
              className="btn-cta"
              href="/checkout"
              onClick={() => track("freecards_buy_click", { mode: features.preview.mode })}
            >
              Unlock full report <span className="arr">→</span>
            </Link>
            <p className="pw-fine">7-day no-questions refund · Local data cleared when you close this tab</p>
            <div className="pw-try-links">
              <Link href="/sample">Not ready? See a full sample report first →</Link>
              <Link href="/analyze">Upload a different chat →</Link>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

/* ===== 子组件 ===== */

function FreeCardView({ n, card, locked }: { n: string; card: FreeCard; locked: boolean }) {
  const highlight = highlightFor(card);
  return (
    <div className={`free-card${locked ? " locked" : ""}`}>
      <div className="fc-head">
        <span className="fc-num tnum">{n}</span>
        <span className="fc-title">{card.title}</span>
        {locked && <LockIcon />}
      </div>
      {highlight && <p className="fc-highlight tnum">{highlight}</p>}
      <p className="fc-body">{card.insight}</p>
      <p className="fc-foot">{card.footnote}</p>
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

/* 本页专用样式（不改共享 components.css / globals.css） */
const styleTag = `
.free-card{border:1px solid var(--sand-line);border-radius:var(--r-card);background:#fff;padding:22px 24px;margin-bottom:16px;position:relative}
.free-card.locked{background:linear-gradient(180deg,#fff 0%,var(--sand) 100%)}
.fc-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.fc-num{font-family:var(--font-mono);font-size:12px;color:var(--ink-300)}
.fc-title{font-size:17px;font-weight:700}
.fc-lock{margin-left:auto;color:var(--ink-300)}
.fc-highlight{font-size:15px;font-weight:700;color:var(--teal);margin-bottom:8px}
.fc-body{font-size:14.5px;color:var(--ink-700);line-height:1.65}
.fc-foot{margin-top:10px;font-family:var(--font-mono);font-size:11.5px;line-height:1.5;color:var(--ink-300)}
.sample-line{font-family:var(--font-mono);font-size:12.5px;line-height:1.6;color:var(--ink-500);margin:-12px 0 20px}
.note{margin:0 0 14px;padding:11px 14px;border:1px solid var(--sand-line);border-radius:8px;background:var(--sand);font-size:12.5px;line-height:1.6;color:var(--ink-500)}
.origin{margin-top:26px;border:1px solid var(--sand-line);border-radius:var(--r-card);background:#fff;padding:22px 24px;font-size:14px;line-height:1.65;color:var(--ink-700)}
.origin-title{font-weight:700;font-size:15px;margin-bottom:8px;color:var(--ink-900)}
.origin p{margin-bottom:10px}
.origin-fine{font-size:12.5px;color:var(--ink-500);margin-bottom:0}
.origin-fine a{color:var(--teal);text-decoration:underline}
.empty-state{border:1px solid var(--sand-line);border-radius:var(--r-card);background:#fff;padding:30px 28px;box-shadow:var(--shadow-1);font-size:15px;line-height:1.65;color:var(--ink-700)}
.es-title{font-size:18px;font-weight:700;color:var(--ink-900);margin-bottom:10px}
.es-meta{margin-top:14px;font-family:var(--font-mono);font-size:12.5px;color:var(--ink-500)}
.es-fine{margin-top:16px;font-size:12.5px;color:var(--ink-500)}
.es-fine a{color:var(--teal);text-decoration:underline}
.paywall{margin-top:32px;border:1px solid var(--sand-line);border-radius:var(--r-card);background:var(--ink-900);color:var(--paper);padding:30px 28px;text-align:center}
.pw-title{font-size:20px;font-weight:700;margin-bottom:8px}
.pw-sub{font-size:14.5px;color:rgba(251,250,247,.85);margin-bottom:18px}
.paywall .btn-cta{margin-bottom:14px}
.pw-fine{font-size:12.5px;color:var(--ink-300)}
.pw-try-links{display:flex;flex-direction:column;gap:8px;margin-top:16px}
.pw-try-links a{color:var(--scan);font-size:13px;text-decoration:underline}
`;
