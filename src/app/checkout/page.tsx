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
    const input = safeReadInput();
    // 真模式：调 /api/checkout 拿 Lemon Squeezy 托管页 URL，跳过去
    // mock 模式：保持原行为（本地伪造 MOCK- id + preview 参数，落到 /report）
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          email: email || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "checkout failed");
        setPaying(false);
        return;
      }
      const data: { mock: boolean; url: string; checkoutId: string } =
        await res.json();
      if (data.mock) {
        // mock：本地伪造订单 id + preview 参数（保持原行为，演示用）
        const enc = btoa(JSON.stringify(input)).replace(/=+$/g, "");
        const base64Url = enc.replace(/\+/g, "-").replace(/\//g, "_");
        router.push(
          `/report?checkout=${data.checkoutId}&email=${encodeURIComponent(email || "guest")}&preview=${base64Url}`
        );
      } else {
        // live：跳 Lemon Squeezy 托管页
        window.location.href = data.url;
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "checkout failed");
    } finally {
      setPaying(false);
    }
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
