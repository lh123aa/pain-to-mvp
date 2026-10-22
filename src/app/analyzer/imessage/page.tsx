import type { Metadata } from "next";
import Link from "next/link";
import { Footer, TopBar } from "@/app/components";
import { IMESSAGE_PAGE } from "@/content/seo/imessage";
import { seoJsonLd, seoMetadata } from "@/content/seo/shared";

/**
 * /analyzer/imessage —— SEO 落地页（PRD FR-11 · P-10）
 *
 * 诚实定位：iMessage 仍在 beta（W0-A1 spike 未出 go/no-go）。页面把状态写在
 * Hero 徽标与 FAQ 里，教程只讲 Mac 上复制 chat.db 的路径，不承诺读取 iCloud /
 * Apple ID；今天可用的路径（WhatsApp .txt 与粘贴文本）放在 CTA 说明里。
 * FAQ 静态可见，不依赖 JS。
 */
export const metadata: Metadata = seoMetadata(IMESSAGE_PAGE);

const copy = IMESSAGE_PAGE;

export default function ImessageAnalyzerPage() {
  return (
    <>
      <TopBar />
      <main>
        {/* 结构化数据：FAQPage + HowTo（PRD AC-11.1） */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: seoJsonLd(copy) }}
        />
        {/* Hero：先把 beta 状态说清楚，再给 CTA */}
        <section className="inner">
          <div className="wrap">
            <div className="inner-head">
              <p className="sec-label">{copy.eyebrow}</p>
              {copy.badge !== undefined && <span className="todo-tag">{copy.badge}</span>}
              <h1 style={{ marginTop: 10 }}>{copy.h1}</h1>
              <p>{copy.lede}</p>
            </div>
            <div className="trust">
              {copy.trust.map((item) => (
                <span className="trust-item" key={item}>
                  <CheckIcon />
                  {item}
                </span>
              ))}
            </div>
            <div className="cta-row">
              <Link className="btn-cta" href={copy.cta.href}>
                {copy.cta.label} <span className="arr" aria-hidden="true">→</span>
              </Link>
            </div>
            <p className="cta-fine">{copy.cta.note}</p>
          </div>
        </section>

        {/* Mac 导出教程（chat.db 路径） */}
        <section className="block" aria-labelledby="how-to-export">
          <div className="wrap">
            <p className="sec-label">{copy.howTo.eyebrow}</p>
            <h2 id="how-to-export">{copy.howTo.heading}</h2>
            <p className="sec-intro">{copy.howTo.intro}</p>
            <div className="steps">
              {copy.howTo.steps.map((step) => (
                <div className="step" key={step.number}>
                  <div className="step-n tnum">{step.number}</div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>
            <p className="acc-note">{copy.howTo.note}</p>
          </div>
        </section>

        {/* 隐私承诺：没有账号连接 */}
        <section className="block privacy" aria-labelledby="privacy-promise">
          <div className="wrap">
            <p className="sec-label">{copy.privacy.eyebrow}</p>
            <h2 id="privacy-promise">{copy.privacy.heading}</h2>
            <p className="sec-intro">{copy.privacy.intro}</p>
            <div className="priv-rows">
              {copy.privacy.rows.map((row) => (
                <div className="priv-row" key={row.number}>
                  <span className="n tnum">{row.number}</span>
                  <p>
                    <strong>{row.lead}</strong> {row.body}
                  </p>
                </div>
              ))}
            </div>
            <Link className="priv-link" href="/privacy">
              Read the plain-English privacy policy →
            </Link>
          </div>
        </section>

        {/* 为什么 iMessage 难做 */}
        <section className="block what" aria-labelledby="why-hard">
          <div className="wrap">
            <p className="sec-label">{copy.cards.eyebrow}</p>
            <h2 id="why-hard">{copy.cards.heading}</h2>
            <p className="sec-intro">{copy.cards.intro}</p>
            <div className="cards-scroll" role="list">
              {copy.cards.items.map((card) => (
                <article className="chap-card" role="listitem" key={card.number}>
                  <span className="chap-num tnum">{card.number}</span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 当前状态（今天能用的 / beta 不做的） */}
        <section className="block" aria-labelledby="status-heading">
          <div className="wrap">
            <p className="sec-label">{copy.limits.eyebrow}</p>
            <h2 id="status-heading">{copy.limits.heading}</h2>
            <p className="sec-intro">{copy.limits.intro}</p>
            <ul style={{ margin: "22px 0 0 20px", display: "grid", gap: 12, fontSize: 15.5, color: "var(--ink-700)", lineHeight: 1.65 }}>
              {copy.limits.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link className="sample-link" href="/sample">
              See a full sample report <span className="arr" aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        {/* FAQ */}
        <section className="block" aria-labelledby="faq-heading">
          <div className="wrap">
            <p className="sec-label">{copy.faq.eyebrow}</p>
            <h2 id="faq-heading">{copy.faq.heading}</h2>
            <div style={{ display: "grid", gap: 14, marginTop: 24 }}>
              {copy.faq.items.map((item) => (
                <div className="risk-card" key={item.question}>
                  <div className="risk-head">
                    <span className="risk-level mid">BETA</span>
                    <span className="risk-label">{item.question}</span>
                  </div>
                  <p>{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 内链 */}
        <section className="block" aria-labelledby="related-heading">
          <div className="wrap">
            <p className="sec-label">Related</p>
            <h2 id="related-heading" style={{ fontSize: 24 }}>
              Keep reading
            </h2>
            <nav aria-label="Related pages" style={{ display: "grid", gap: 4, marginTop: 12 }}>
              {copy.links.map((link) => (
                <Link className="sample-link" href={link.href} key={link.href}>
                  {link.label} <span className="arr" aria-hidden="true">→</span>
                </Link>
              ))}
            </nav>
          </div>
        </section>

        <section className="final-cta">
          <div className="wrap">
            <h2>{copy.finalCta.heading}</h2>
            <div>
              <Link className="btn-cta" href={copy.cta.href}>
                {copy.finalCta.label} <span className="arr" aria-hidden="true">→</span>
              </Link>
              <p className="cta-fine">{copy.finalCta.note}</p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 8.5l3.5 3.5 7.5-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
