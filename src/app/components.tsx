"use client";
/* The Tell · 共享组件：logo、隐私徽标、顶栏、Footer、隐私面板、FX-1 canvas */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { track, useAccordion, usePanel, useRiseOnScroll, useScrolledTop } from "./hooks";

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <Link
      className="wordmark"
      href="/"
      aria-label="The Tell — home"
      style={small ? { fontSize: 17 } : undefined}
    >
      <svg className="mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="1.5" y="4" width="17" height="12" rx="2.5" stroke="var(--ink-900)" strokeWidth="1.6" />
        <path d="M5 9.5h6M5 12.5h9" stroke="var(--ink-900)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="15" cy="7" r="1.6" fill="var(--teal)" />
      </svg>
      The&nbsp;Tell
    </Link>
  );
}

export function PrivacyPanel({ open, close }: { open: boolean; close: () => void }) {
  const { veil, panel } = usePanel(open, close);
  return (
    <>
      <div className="panel-veil" ref={veil} onClick={close} />
      <aside
        className="panel"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-h"
        hidden={!open}
      >
        <button className="p-close" onClick={close} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <h2 id="panel-h">How we protect your privacy</h2>
        <p className="p-sub">Three promises, verifiable in your browser&apos;s DevTools.</p>
        <p>
          <strong>1. Parsed here, not there.</strong> Your chat file is read in your browser. It never touches
          our servers — pull your internet cable mid-parse and nothing changes.
        </p>
        <p>
          <strong>2. Only the numbers travel.</strong> After purchase we receive computed statistics and a few
          short quoted excerpts. Phone numbers and emails are automatically masked. Never the full chat.
        </p>
        <p>
          <strong>3. Gone on a schedule.</strong> Everything is deleted after 90 days automatically — or delete
          it yourself in one click, anytime.
        </p>
        <div className="p-policies">
          <a href="/privacy">Privacy policy →</a>
          <a href="/notice">Notice for people in your chats →</a>
          <a href="/terms">Terms →</a>
          <a href="/refund">Refund policy →</a>
          <a href="/crisis-protocol">Crisis protocol →</a>
          <a href="/methodology">Methodology →</a>
        </div>
      </aside>
    </>
  );
}

export function TopBar() {
  const ref = useScrolledTop();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <header className="top" ref={ref}>
        <div className="wrap top-in">
          <Wordmark />
          <button className="badge-priv" onClick={() => setOpen(true)} aria-haspopup="dialog">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 1.5l5 2v4c0 3.2-2.1 5.6-5 6.9-2.9-1.3-5-3.7-5-6.9v-4l5-2z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            How we protect your privacy
          </button>
        </div>
      </header>
      <PrivacyPanel open={open} close={close} />
    </>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-in">
          <Wordmark small />
          <nav className="foot-links" aria-label="Footer">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/refund">Refund</a>
            <a href="/notice">Notice for people in your chats</a>
            <a href="/crisis-protocol">Crisis resources</a>
            <a href="/methodology">Methodology</a>
            <a href="mailto:hello@thetell.app">hello@thetell.app</a>
          </nav>
        </div>
        <p className="crisis">
          If you&apos;re in crisis, please reach out:{" "}
          <a href="tel:988">988</a> (US) or <a href="https://findahelpline.com" rel="noopener">findahelpline.com</a>.
        </p>
      </div>
    </footer>
  );
}

/* ===== FX-1「Tell Field」· 2D canvas 概念原型 =====
   生产版按 开发需求文档 §1.3 用 Three.js InstancedMesh 实现；
   此处用 2D canvas 复刻概念：抽象纸条噪声场 + 8s 暖光扫描带 + tell 彩蛋抖动。
   规则：纸面内容抽象灰线+圆点（非真实气泡）；左栏密度减半/opacity×0.5（保 H1 对比度）；
   漂移缓慢无方向感；reduced-motion 时只画一帧静态。 */
export function TellField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile = window.innerWidth < 700;
    const COUNT = isMobile ? 38 : 72;
    const SCAN = "#F5C978";
    type Slip = {
      x: number;
      y: number;
      z: number;
      depth: number;
      scale: number;
      phase: number;
      drift: number;
      rot: number;
      left: boolean;
      seed: number;
    };
    let slips: Slip[] = [];
    let w = 0,
      h = 0;
    const t0 = performance.now();
    let raf = 0;
    let mx = 0.5,
      my = 0.5,
      px = 0,
      py = 0;
    const CYCLE = 8000;
    let nextTell = 3000 + Math.random() * 6000,
      tellAt = -1,
      tellSlip: Slip | null = null;

    function size() {
      const r = cv!.parentElement!.getBoundingClientRect();
      w = cv!.width = r.width * devicePixelRatio;
      h = cv!.height = r.height * devicePixelRatio;
      ctx!.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      seed();
    }
    function seed() {
      slips = [];
      for (let i = 0; i < COUNT; i++) {
        const z = -1 - Math.random() * 5;
        const depth = (z + 6) / 5;
        let x = Math.random() * w;
        const inLeft = x < w * 0.52;
        if (inLeft && Math.random() < 0.5 && !isMobile) x += w * 0.52;
        slips.push({
          x,
          y: Math.random() * h,
          z,
          depth,
          scale: 0.4 + depth * 0.8,
          phase: Math.random() * Math.PI * 2,
          drift: 0.02 + Math.random() * 0.04,
          rot: (Math.random() - 0.5) * 0.14,
          left: x < w * 0.52,
          seed: Math.random(),
        } as Slip);
      }
    }
    addEventListener("resize", size);
    addEventListener(
      "pointermove",
      (e) => {
        mx = e.clientX / window.innerWidth;
        my = e.clientY / window.innerHeight;
      },
      { passive: true }
    );

    function draw(now: number) {
      const t = (now - t0) / 1000;
      ctx!.clearRect(0, 0, w, h);
      const scanPhase = ((now - t0) % CYCLE) / CYCLE;
      const scanZ = -6 + scanPhase * 5;
      if (!reduce && now - t0 > nextTell) {
        tellSlip = slips[(Math.random() * slips.length) | 0];
        tellAt = now;
        nextTell = now + 6000 + Math.random() * 3000;
      }
      if (tellAt > 0 && now - tellAt > 120) {
        tellSlip = null;
        tellAt = -1;
      }
      px += ((mx - 0.5) * 14 - px) * 0.05;
      py += ((my - 0.5) * 10 - py) * 0.05;

      for (const s of slips) {
        if (!reduce) {
          s.y += Math.sin(s.phase + t * s.drift * 6) * 0.06;
          s.x += Math.cos(s.phase + t * s.drift * 4) * 0.05;
        }
        const nearScan = Math.abs(s.z - scanZ) < 0.4;
        const jitter = tellSlip === s ? (Math.random() - 0.5) * 5 : 0;
        const sc = s.scale;
        const cw = 74 * sc,
          ch = 46 * sc;
        const par = (s.depth - 0.5) * 2;
        const alpha =
          (0.35 + s.depth * 0.25) * (s.left && !isMobile ? 0.5 : 1) * (nearScan ? 1.6 : 1);
        ctx!.save();
        ctx!.translate(s.x + px * par + jitter, s.y + py * par);
        ctx!.rotate(s.rot);
        ctx!.globalAlpha = Math.min(alpha, 0.82);
        ctx!.fillStyle = "#FFFFFF";
        roundRect(ctx!, -cw / 2, -ch / 2, cw, ch, 6 * sc);
        ctx!.fill();
        ctx!.strokeStyle = "rgba(22,32,43,0.10)";
        ctx!.lineWidth = 1;
        ctx!.stroke();
        if (nearScan) {
          ctx!.globalAlpha = 0.16;
          ctx!.fillStyle = SCAN;
          roundRect(ctx!, -cw / 2, -ch / 2, cw, ch, 6 * sc);
          ctx!.fill();
        }
        ctx!.globalAlpha = Math.min(alpha, 0.82) * 0.9;
        ctx!.fillStyle = nearScan ? "#8A7A5C" : "#9AA8B5";
        ctx!.beginPath();
        ctx!.arc(-cw / 2 + 10 * sc, -ch / 2 + 12 * sc, 4 * sc, 0, 7);
        ctx!.fill();
        const lines = s.seed > 0.5 ? 3 : 2;
        for (let i = 0; i < lines; i++) {
          const lw = (28 + ((s.seed * 977 + i * 131) % 24)) * sc;
          ctx!.fillRect(-cw / 2 + 22 * sc, -ch / 2 + 9 * sc + i * 10 * sc, lw, 3.2 * sc);
        }
        ctx!.restore();
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    }
    function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }
    size();
    if (reduce) draw(performance.now());
    else raf = requestAnimationFrame(draw);
    const onLeave = () => cancelAnimationFrame(raf);
    addEventListener("pagehide", onLeave, { once: true });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", size);
      removeEventListener("pagehide", onLeave);
    };
  }, []);
  return <canvas ref={ref} id="tell-field" aria-hidden="true" />;
}

/* 通用：进场动效 + 手风琴（在页面挂载后调用一次） */
export function useLandingEffects() {
  useRiseOnScroll();
  useAccordion();
}

/* CTA 点击埋点包装 */
export function CtaLink({
  href,
  position,
  children,
}: {
  href: string;
  position: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      className="btn-cta"
      href={href}
      onClick={() => track("cta_analyze_click", { position })}
    >
      {children}
    </Link>
  );
}
