"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Footer, TopBar } from "../components";
import { track } from "../hooks";
import {
  CHECKOUT_ID_STORAGE_KEY,
  CHECKOUT_MODE_STORAGE_KEY,
} from "../../lib/report-access";

/**
 * /checkout — 结账页
 *
 * live 分支：调 /api/checkout 拿 Lemon Squeezy 托管页 URL → 记录 checkout id →
 *   跳 LS 托管页；LS 支付完成回跳 /report?checkout=PENDING，报告页进入等待态，
 *   webhook 落库后由魔链邮件给出正式访问链接。
 * mock 分支：保持原有演示行为（MOCK- id + preview 参数 → /report 演示报告）。
 * 失败 / 取消：留在本页，显示错误 + 重试按钮，不丢用户已填 email。
 *
 * 合规（AC-7.2）：支付前可见 /terms /refund /privacy /notice 链接；
 *   展示 EU 14 天撤回权弃权勾选（链到 /refund 解释 7 天退款政策）。
 */

type CheckoutStatus = "idle" | "creating" | "redirecting";

type CheckoutApiResponse = {
  url?: string;
  mock?: boolean;
  checkoutId?: string;
  error?: string;
  detail?: string;
};

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
  const [status, setStatus] = useState<CheckoutStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // AC-7.2：EU 14 天撤回权弃权确认（购买前必须勾选）
  const [withdrawalWaiver, setWithdrawalWaiver] = useState(false);

  const paying = status !== "idle";
  const canceled =
    sp.get("canceled") === "1" ||
    sp.get("cancelled") === "1" ||
    sp.get("status") === "canceled";

  useEffect(() => {
    track("checkout_view", { mock: !sp.get("live") });
  }, [sp]);

  // 从 LS 托管页「后退/取消」回到本页时（bfcache），把 redirecting 状态复位，
  // 让用户可以直接重试（否则按钮会停留在 "Redirecting…"）。
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setStatus("idle");
        setError(null);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function pay() {
    if (status !== "idle" || !withdrawalWaiver) return;

    setStatus("creating");
    setError(null);

    const input = safeReadInput();
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          email: email || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CheckoutApiResponse;

      if (!res.ok || !data.url || !data.checkoutId) {
        throw new Error(
          data.detail ||
            "Checkout is temporarily unavailable. Please try again in a moment."
        );
      }

      if (data.mock) {
        // mock：本地伪造订单 id + preview 参数（保持原有演示行为）
        writeSession(CHECKOUT_MODE_STORAGE_KEY, "mock");
        const enc = btoa(JSON.stringify(input)).replace(/=+$/g, "");
        const base64Url = enc.replace(/\+/g, "-").replace(/\//g, "_");
        router.push(
          `/report?checkout=${data.checkoutId}&email=${encodeURIComponent(
            email || "guest"
          )}&preview=${base64Url}`
        );
        return;
      }

      // live：记录 checkout id 供报告页等待态展示参考号，然后跳 LS 托管页。
      // 注：LS 的 redirect_url 是服务端静态配置（lib/checkout.ts），无法在创建后回填
      // checkout id；真实访问凭证由 webhook 落库后通过魔链邮件送达。
      writeSession(CHECKOUT_MODE_STORAGE_KEY, "live");
      writeSession(CHECKOUT_ID_STORAGE_KEY, data.checkoutId);
      setStatus("redirecting");
      window.location.assign(data.url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Checkout failed. Please try again."
      );
      setStatus("idle");
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
              Email (for your magic link &amp; receipt)
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />

            {/* AC-7.2：购买前的法律链接（四份合规文档都可达） */}
            <p className="checkout-legal">
              By purchasing you agree to our <a href="/terms">Terms of Service</a>,{" "}
              <a href="/refund">Refund Policy</a>, and{" "}
              <a href="/privacy">Privacy Notice</a>. You also acknowledge our{" "}
              <a href="/notice">Legal Notice</a>.
            </p>

            {/* AC-7.2：EU 14 天撤回权弃权确认 */}
            <label className="waiver-row">
              <input
                type="checkbox"
                checked={withdrawalWaiver}
                onChange={(e) => setWithdrawalWaiver(e.target.checked)}
              />
              <span>
                I understand that by starting my report immediately I waive my EU
                14-day right of withdrawal. The 7-day refund policy still applies
                — see the <a href="/refund">Refund &amp; Cancellation Policy</a>.
              </span>
            </label>

            <button
              className="btn-cta"
              style={{ marginTop: 22, width: "100%", justifyContent: "center" }}
              onClick={pay}
              disabled={!withdrawalWaiver || paying}
              aria-busy={paying}
            >
              {status === "redirecting"
                ? "Redirecting to secure checkout…"
                : status === "creating"
                  ? "Processing…"
                  : "Pay $14.99 → full report"}
            </button>

            {error && (
              <div className="checkout-error" role="alert">
                <p>{error}</p>
                <button className="retry-btn" onClick={pay} disabled={paying}>
                  {paying ? "Retrying…" : "Try again"}
                </button>
              </div>
            )}

            {canceled && !error && (
              <div className="checkout-canceled" role="status">
                Payment canceled — you have not been charged. You can try again
                with the button above.
              </div>
            )}

            <p className="checkout-fine">
              Payments are handled by{" "}
              <a
                href="https://lemonsqueezy.com"
                target="_blank"
                rel="noopener"
                style={{ color: "var(--teal)" }}
              >
                Lemon Squeezy
              </a>{" "}
              (merchant of record — they handle VAT/GST, so you don&apos;t). This
              demo build uses a mock checkout; live payment switches on once the
              Lemon Squeezy keys are set.
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

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* sessionStorage 不可用时忽略（不影响主流程） */
  }
}

const styleTag = `
.checkout-box{border:1px solid var(--sand-line);border-radius:var(--r-card);background:#fff;padding:30px;box-shadow:var(--shadow-1)}
.checkout-line{display:flex;justify-content:space-between;align-items:center;padding:12px 0;font-size:15px}
.checkout-line .cl-label{color:var(--ink-700)}
.checkout-line .cl-val{font-family:var(--font-mono);font-size:14px;font-weight:600}
.mock-badge{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:var(--sand);color:var(--ink-500);border-radius:4px;padding:3px 9px;margin-top:14px}
.checkout-legal{font-size:12px;line-height:1.6;color:var(--ink-500);margin:14px 0 4px}
.checkout-legal a{color:var(--teal);text-decoration:underline}
.waiver-row{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;line-height:1.55;color:var(--ink-700);margin-top:10px;cursor:pointer}
.waiver-row input{margin-top:3px;flex:0 0 auto;accent-color:var(--teal)}
.waiver-row a{color:var(--teal);text-decoration:underline}
.checkout-error{margin-top:16px;border:1px solid #e6b8b0;background:#fdf3f1;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.5;color:#8a2f21}
.checkout-error p{margin:0 0 8px}
.retry-btn{border:1px solid #8a2f21;background:#fff;color:#8a2f21;border-radius:6px;padding:5px 12px;font-size:12.5px;font-weight:600;cursor:pointer}
.retry-btn:disabled{opacity:.55;cursor:default}
.checkout-canceled{margin-top:16px;border:1px solid var(--sand-line);background:var(--sand);border-radius:8px;padding:10px 14px;font-size:12.5px;line-height:1.5;color:var(--ink-700)}
.btn-cta:disabled{opacity:.55;cursor:not-allowed}
`;
