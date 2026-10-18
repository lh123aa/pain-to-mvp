"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Footer, TopBar } from "../components";
import { track } from "../hooks";

/**
 * /checkout — mock 结账页（Lemon Squeezy 真结账占位）
 * 真实接入后：本页改为渲染 Lemon Squeezy 托管 checkout iframe / 或重定向到
 * LEMON_SQUEEZY 返回的 checkout_url。当前用 mock 展示订单 + 模拟支付成功 → 报告页。
 */
export default function CheckoutPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading checkout…</div>}>
      <CheckoutInner />
    </Suspense>
  );
}

function CheckoutInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    track("checkout_view", { mock: !sp.get("live") });
  }, [sp]);

  async function pay() {
    setPaying(true);
    // mock：模拟 Lemon Squeezy 托管页 → 成功 → 报告
    await new Promise((r) => setTimeout(r, 900));
    const input = safeReadInput();
    const enc = btoa(JSON.stringify(input)).replace(/=+$/g, "");
    const base64Url = enc.replace(/\+/g, "-").replace(/\//g, "_");
    const id = "MOCK-" + Date.now().toString(36).toUpperCase();
    // 报告页凭 checkout id 取数据；mock 时把 input 直接塞进 query（演示）
    router.push(
      `/report?checkout=${id}&email=${encodeURIComponent(email || "guest")}&preview=${base64Url}`
    );
  }

  return (
    <>
      <style>{styleTag}</style>
      <TopBar />
      <section className="inner">
        <div className="wrap" style={{ maxWidth: 520 }}>
          <div className="inner-head">
            <p className="sec-label">Secure checkout</p>
            <h1>Unlock your full report</h1>
          </div>

          <div className="checkout-box">
            <div className="checkout-line">
              <span className="cl-label">The Tell — Relationship Report</span>
              <span className="cl-val">$14.99</span>
            </div>
            <div className="checkout-line">
              <span className="cl-label">One-time · printable PDF · 7-day refund</span>
              <span className="cl-val">USD</span>
            </div>

            <label className="field-label" htmlFor="email">
              Email (for your magic link & receipt)
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />

            <button className="btn-cta" style={{ marginTop: 22, width: "100%", justifyContent: "center" }} onClick={pay} disabled={paying}>
              {paying ? "Processing…" : "Pay $14.99 → full report"}
            </button>

            <p className="checkout-fine">
              Payments are handled by{" "}
              <a href="https://lemonsqueezy.com" target="_blank" rel="noopener" style={{ color: "var(--teal)" }}>
                Lemon Squeezy
              </a>{" "}
              (merchant of record — they handle VAT/GST, so you don&apos;t). This demo build uses
              a mock checkout; live payment switches on once the Lemon Squeezy keys are set.
            </p>
            <span className="mock-badge">Demo mode — no real charge</span>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

function safeReadInput() {
  if (typeof window === "undefined")
    return { fileName: "(sample)", speakerA: "You", speakerB: "Them", pasted: "" };
  try {
    const raw = localStorage.getItem("tell:input");
    if (raw) return JSON.parse(raw);
  } catch {
    /* noop */
  }
  return { fileName: "(sample)", speakerA: "You", speakerB: "Them", pasted: "" };
}

const styleTag = `
.checkout-box{border:1px solid var(--sand-line);border-radius:var(--r-card);background:#fff;padding:30px;box-shadow:var(--shadow-1)}
.checkout-line{display:flex;justify-content:space-between;align-items:center;padding:12px 0;font-size:15px}
.checkout-line .cl-label{color:var(--ink-700)}
.checkout-line .cl-val{font-family:var(--font-mono);font-size:14px;font-weight:600}
.mock-badge{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:var(--sand);color:var(--ink-500);border-radius:4px;padding:3px 9px;margin-top:14px}
`;
