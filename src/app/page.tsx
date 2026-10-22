"use client";
import { CtaLink, Footer, TellField, TopBar, useLandingEffects } from "./components";
import { track } from "./hooks";
import { useEffect } from "react";

export default function Home() {
  useLandingEffects();

  /* landing_view 埋点（占位，生产接 PostHog EU） */
  useEffect(() => {
    const utm = new URLSearchParams(window.location.search).get("utm") || "(none)";
    track("landing_view", { utm });
  }, []);

  return (
    <>
      <TopBar />

      {/* ===== 区块 1 · Hero ===== */}
      <section className="hero" aria-labelledby="h1">
        <TellField />
        <div className="wrap">
          <div className="hero-left">
            <p className="eyebrow">Every text has a tell.</p>
            <h1 id="h1">See your relationship clearly — with evidence, not guesses.</h1>
            <p className="hero-sub">
              Upload your chat export. Get a private, evidence-based report on attachment
              patterns, communication health, and what to do next.
            </p>
            <div className="cta-row">
              <CtaLink href="/analyze" position="hero">
                Analyze my chat <span className="arr" aria-hidden="true">→</span>
              </CtaLink>
              <a className="btn-secondary" href="/sample" style={{ alignSelf: "center" }}>
                See a sample report →
              </a>
            </div>
            <p className="cta-fine">
              Takes about 1–5&nbsp;minutes · One-time <span className="tnum">$14.99</span> · 7-day
              refund · No subscription ·{" "}
              <a href="/refund">Refund policy</a> · <a href="/terms">Terms</a>
            </p>
            <div className="trust">
              <span className="trust-item">
                <CheckSvg /> Processed in your browser
              </span>
              <span className="trust-item">
                <CheckSvg /> No account needed
              </span>
              <span className="trust-item">
                <CheckSvg /> Deleted after 90 days
              </span>
            </div>
          </div>

          {/* 右栏：报告样例 mock */}
          <div
            className="mock"
            role="img"
            aria-label="Sample report preview: communication radar and attachment pattern card"
          >
            <span className="mock-tag">Sample</span>
            <div className="mock-head">
              <h3>Your Report</h3>
              <span>Mar 1 – Sep 30, 2026</span>
            </div>
            <div className="mock-grid">
              <div>
                <p className="mock-cap">Communication</p>
                <RadarSvg />
              </div>
              <div className="att-card">
                <p className="mock-cap">Attachment</p>
                <p className="att-type">Anxious-leaning</p>
                <p className="att-conf">We&apos;re fairly sure.</p>
                <div className="att-bars">
                  <AttBar label="Reach" val={72} color="var(--teal)" />
                  <AttBar label="Guard" val={38} color="var(--clay)" />
                  <AttBar label="Repair" val={61} color="var(--ink-300)" />
                </div>
              </div>
            </div>
            <div className="mock-foot">
              <span>Every claim links to evidence.</span>
              <span className="ev">[#1021]</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== 区块 2 · What you get ===== */}
      <section className="what block" aria-labelledby="what-h">
        <div className="wrap">
          <p className="sec-label rise">Inside the report</p>
          <h2 id="what-h" className="rise">What you get</h2>
          <p className="sec-intro rise">
            Six chapters. Every observation tied to something you can check — not a
            horoscope.
          </p>
          <div className="cards-scroll rise" role="list">
            <ChapCard n="01" title="Attachment Patterns" desc="How each of you reaches for closeness — and what happens when it's threatened.">
              <LineViz />
            </ChapCard>
            <ChapCard n="02" title="Communication Health" desc="Response times, who initiates, and how conversations actually end.">
              <BarViz />
            </ChapCard>
            <ChapCard n="03" title="Relationship Balance" desc="Effort, initiative, and emotional labor — measured, not guessed.">
              <BalanceViz />
            </ChapCard>
            <ChapCard n="04" title="Turning Points" desc="The moments that shifted things — with the messages that show it.">
              <TimelineViz />
            </ChapCard>
            <ChapCard n="05" title="What To Do Next" desc="A concrete seven-day plan — one thing at a time, with the why.">
              <CheckViz />
            </ChapCard>
          </div>
          <a className="sample-link rise" href="/sample">
            See a full sample report <span className="arr" aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      {/* ===== 区块 3 · How it works ===== */}
      <section className="block" aria-labelledby="how-h">
        <div className="wrap">
          <p className="sec-label rise">How it works</p>
          <h2 id="how-h" className="rise">
            Four steps. About five minutes.
          </h2>
          <div className="steps rise">
            <Step n="1" title="Export your chat" desc="Use the built-in export in WhatsApp or iMessage. One tap, no third-party tools." />
            <Step n="2" title="Drop the file" desc="It's parsed here, in your browser. The file itself never leaves your device." />
            <Step n="3" title="Confirm who's who" desc="Lock the two speakers so every number is attributed correctly." />
            <Step n="4" title="Read your report" desc="Evidence-linked findings and a seven-day plan. PDF included." />
          </div>

          <div className="howto rise">
            <AccItem id="whatsapp" title="How to export (WhatsApp)">
              Open the chat → Tap the name → Export chat → <strong>Without media</strong> → Share
              the <code>.txt</code> file to your computer.
              <span className="acc-note">Only export chats you have the right to share.</span>
              <span className="acc-note">
                <a href="/analyzer/whatsapp">Step-by-step WhatsApp analyzer guide →</a>
              </span>
            </AccItem>
            <AccItem id="imessage" title="How to export (iMessage)" comingSoon>
              iMessage support is in validation. WhatsApp and paste work today.
              <span className="acc-note">Only export chats you have the right to share.</span>
              <span className="acc-note">
                <a href="/analyzer/imessage">Read the iMessage beta guide →</a>
              </span>
            </AccItem>
          </div>
        </div>
      </section>

      {/* ===== 区块 3.5 · What's in the report ===== */}
      <section className="block" aria-labelledby="chapters-h">
        <div className="wrap">
          <p className="sec-label rise">What you get</p>
          <h2 id="chapters-h" className="rise">
            Six chapters, one evidence-linked report.
          </h2>
          <ol
            className="rise"
            style={{ margin: "18px 0 0", paddingLeft: 22, lineHeight: 1.9, color: "var(--ink-700)" }}
          >
            <li>
              <strong>At a glance</strong> — the score, your attachment direction, and how
              confident we are.
            </li>
            <li>
              <strong>Attachment picture</strong> — both sides, with the behavioural signals behind
              each call.
            </li>
            <li>
              <strong>Communication health</strong> — five dimensions and the ten metrics they come
              from.
            </li>
            <li>
              <strong>Turning points</strong> — pauses, late-night clusters, repair moments, and the
              last message.
            </li>
            <li>
              <strong>Evidence &amp; confidence</strong> — short quoted excerpts, plus a plain list
              of what this report cannot know.
            </li>
            <li>
              <strong>Next 7 days</strong> — small, specific actions chosen from your weakest
              dimension.
            </li>
          </ol>
          <p className="acc-note rise">
            <a href="/sample">Read the full sample report →</a> ·{" "}
            <a href="/methodology">How scores are computed →</a>
          </p>
        </div>
      </section>

      {/* ===== 区块 4 · Privacy promise ===== */}
      <section className="privacy block" aria-labelledby="priv-h">
        <div className="wrap">
          <p className="sec-label rise">Privacy</p>
          <h2 id="priv-h" className="rise">
            Your chat file is parsed in your browser — never uploaded.
          </h2>
          <div className="priv-rows rise">
            <div className="priv-row">
              <span className="n tnum">01</span>
              <p>
                <strong>The file itself never leaves your device</strong> — you can turn off your
                internet and everything still works.
              </p>
            </div>
            <div className="priv-row">
              <span className="n tnum">02</span>
              <p>
                After purchase, we upload only computed statistics and a few short quoted
                excerpts (phone numbers and emails automatically masked) —{" "}
                <strong>not your full chat</strong>.
              </p>
            </div>
            <div className="priv-row">
              <span className="n tnum">03</span>
              <p>
                <strong>Deleted after 90 days automatically</strong>, or in one click anytime.
              </p>
            </div>
          </div>
          <a className="priv-link rise" href="/privacy">
            Read the plain-English privacy policy →
          </a>
          <p className="acc-note rise" style={{ marginTop: 10 }}>
            Local parsing · deleted after 90 days · never used to train models · one-click delete ·{" "}
            <a href="/notice">notice for people in your chats</a>
          </p>
        </div>
      </section>

      {/* ===== 区块 5 · Social proof（克制版） ===== */}
      <section className="proof">
        <div className="wrap proof-in">
          <p className="proof-main rise">
            Built on published attachment research — <span className="tnum">135</span> sources
            reviewed. <a href="/methodology">See the methodology →</a>
          </p>
          <p className="proof-soon rise">
            We&apos;re in beta — no paid testimonials yet. Samples are synthetic.
          </p>
        </div>
      </section>

      {/* ===== 区块 6 · FAQ ===== */}
      <section className="faq block" aria-labelledby="faq-h">
        <div className="wrap">
          <p className="sec-label rise">Questions</p>
          <h2 id="faq-h" className="rise">
            Fair questions, honest answers.
          </h2>
          <div className="howto rise" id="faq-list">
            <FaqItem q="Is my chat uploaded to your servers?">
              No. The file is parsed in your browser — you can turn off your internet and
              everything still works. After purchase we upload only computed statistics and a
              few short quoted excerpts (phone numbers and emails automatically masked), never
              your full chat. Everything is deleted after 90 days, or in one click anytime.
            </FaqItem>
            <FaqItem q="What formats work?">
              WhatsApp export (<code>.txt</code>), iMessage (<code>chat.db</code>, coming soon),
              or plain-text paste. The report analyzes one-to-one conversations — group chats
              aren&apos;t supported, because conclusions have to be attributable.
            </FaqItem>
            <FaqItem q="How accurate is this?">
              We describe observable behavior, attach a confidence level to each finding, and
              say plainly when we don&apos;t know — see the &quot;What I Don&apos;t Know&quot; chapter in every
              report. We never invent what someone was feeling.
            </FaqItem>
            <FaqItem q="Can I get a refund?">
              Yes — 7 days, no conditions, one click from your report page. We&apos;d rather refund
              than argue.
            </FaqItem>
            <FaqItem q="Do I need the other person&apos;s permission?">
              This is a self-reflection tool for your own conversations. Only export chats you
              have the right to share, and read our{" "}
              <a href="/notice" style={{ color: "var(--teal)" }}>
                notice for people in your chats
              </a>{" "}
              — it explains what we think responsible use looks like.
            </FaqItem>
            <FaqItem q="Is this therapy?">No. This is a self-reflection tool, not mental health care.</FaqItem>
            <FaqItem q="What if my partner sees this?">
              The report is a mirror for you, not ammunition for a fight. We don&apos;t recommend
              using it to confront anyone. If something matters, an honest conversation
              offline beats any report.
            </FaqItem>
          </div>
        </div>
      </section>

      {/* ===== 区块 7 · 底部 CTA 复读 ===== */}
      <section className="final-cta">
        <div className="wrap">
          <h2 className="rise">You&apos;ve read the texts enough times. See what they add up to.</h2>
          <div className="rise">
            <CtaLink href="/analyze" position="footer">
              Analyze my chat <span className="arr" aria-hidden="true">→</span>
            </CtaLink>
            <p className="cta-fine">
              Takes about 1–5&nbsp;minutes · From <span className="tnum">$14.99</span> · No
              subscription
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}

/* ===== 子组件 ===== */

function CheckSvg() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RadarSvg() {
  return (
    <svg viewBox="0 0 130 120" width="100%" aria-hidden="true">
      <g stroke="var(--sand-line)" strokeWidth="1" fill="none">
        <polygon points="65,10 118,48 98,111 32,111 12,48" />
        <polygon points="65,32 97,55 85,93 45,93 33,55" />
        <line x1="65" y1="60" x2="65" y2="10" />
        <line x1="65" y1="60" x2="118" y2="48" />
        <line x1="65" y1="60" x2="98" y2="111" />
        <line x1="65" y1="60" x2="32" y2="111" />
        <line x1="65" y1="60" x2="12" y2="48" />
      </g>
      <polygon
        points="65,24 102,52 79,94 47,88 27,53"
        fill="rgba(15,118,110,.18)"
        stroke="var(--teal)"
        strokeWidth="1.6"
      />
      <g fill="var(--teal)">
        <circle cx="65" cy="24" r="2.2" />
        <circle cx="102" cy="52" r="2.2" />
        <circle cx="79" cy="94" r="2.2" />
        <circle cx="47" cy="88" r="2.2" />
        <circle cx="27" cy="53" r="2.2" />
      </g>
    </svg>
  );
}

function AttBar({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <div className="att-bar">
      <span>{label}</span>
      <span className="track">
        <span className="fill" style={{ width: `${val}%`, background: color }} />
      </span>
      <span className="val tnum">{val}</span>
    </div>
  );
}

function ChapCard({ n, title, desc, children }: { n: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <article className="chap-card" role="listitem">
      <span className="chap-num tnum">{n}</span>
      <h3>{title}</h3>
      <p>{desc}</p>
      <div className="chap-viz">{children}</div>
    </article>
  );
}

function LineViz() {
  return (
    <svg viewBox="0 0 200 56" width="100%" aria-hidden="true">
      <path d="M4 44 C30 44 34 12 60 12 S96 48 122 48 158 16 196 16" fill="none" stroke="var(--teal)" strokeWidth="2" />
      <path d="M4 32 C34 32 40 44 66 44 S104 14 130 14 170 38 196 38" fill="none" stroke="var(--clay)" strokeWidth="2" strokeDasharray="5 4" />
    </svg>
  );
}

function BarViz() {
  return (
    <svg viewBox="0 0 200 56" width="100%" aria-hidden="true">
      <g fill="var(--teal)">
        <rect x="6" y="30" width="16" height="26" rx="2" />
        <rect x="34" y="18" width="16" height="38" rx="2" />
        <rect x="62" y="38" width="16" height="18" rx="2" />
        <rect x="90" y="8" width="16" height="48" rx="2" />
        <rect x="118" y="26" width="16" height="30" rx="2" />
        <rect x="146" y="40" width="16" height="16" rx="2" />
      </g>
      <g fill="var(--clay-soft)">
        <rect x="174" y="34" width="16" height="22" rx="2" />
      </g>
    </svg>
  );
}

function BalanceViz() {
  return (
    <svg viewBox="0 0 200 56" width="100%" aria-hidden="true">
      <rect x="4" y="20" width="90" height="14" rx="7" fill="var(--teal)" />
      <rect x="100" y="20" width="52" height="14" rx="7" fill="var(--clay-soft)" />
      <line x1="100" y1="8" x2="100" y2="48" stroke="var(--ink-900)" strokeWidth="1.4" strokeDasharray="3 3" />
    </svg>
  );
}

function TimelineViz() {
  return (
    <svg viewBox="0 0 200 56" width="100%" aria-hidden="true">
      <line x1="4" y1="28" x2="196" y2="28" stroke="var(--sand-line)" strokeWidth="2" />
      <circle cx="52" cy="28" r="4" fill="var(--teal)" />
      <circle cx="118" cy="28" r="4" fill="var(--clay)" />
      <circle cx="170" cy="28" r="4" fill="var(--teal)" />
      <line x1="52" y1="28" x2="52" y2="10" stroke="var(--teal)" strokeWidth="1.4" />
      <line x1="118" y1="28" x2="118" y2="46" stroke="var(--clay)" strokeWidth="1.4" />
    </svg>
  );
}

function CheckViz() {
  return (
    <svg viewBox="0 0 200 56" width="100%" aria-hidden="true">
      <g fill="none" stroke="var(--teal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 14l4 4 7-8" />
        <path d="M8 32l4 4 7-8" />
        <path d="M8 32l4 4 7-8" transform="translate(0,-4)" />
      </g>
      <g fill="var(--ink-300)">
        <rect x="30" y="12" width="120" height="4" rx="2" />
        <rect x="30" y="28" width="96" height="4" rx="2" />
        <rect x="30" y="44" width="140" height="4" rx="2" />
      </g>
    </svg>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="step">
      <div className="step-n tnum">{n}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}

function AccItem({
  id,
  title,
  comingSoon,
  children,
}: {
  id: string;
  title: string;
  comingSoon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="acc" data-howto={id}>
      <button className="acc-head" aria-expanded={false}>
        <span>
          {title}
          {comingSoon && <span className="todo-tag">COMING SOON</span>}
        </span>
        <svg className="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="acc-body">
        <div className="acc-body-in">{children}</div>
      </div>
    </div>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="acc">
      <button className="acc-head" aria-expanded={false}>
        <span>{q}</span>
        <svg className="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="acc-body">
        <div className="acc-body-in">{children}</div>
      </div>
    </div>
  );
}
