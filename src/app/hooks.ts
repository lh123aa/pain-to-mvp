"use client";
import { useCallback, useEffect, useRef } from "react";
import { capture, sanitizeProperties } from "@/lib/posthog";

/* 进场：200ms fade + 2px rise（规范 §0.2） */
export function useRiseOnScroll() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12 }
    );
    document.querySelectorAll<HTMLElement>(".rise").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* 顶部滚动线 */
export function useScrolledTop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => el.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  return ref;
}

/* 手风琴 */
export function useAccordion() {
  useEffect(() => {
    const btns = Array.from(document.querySelectorAll<HTMLElement>(".acc-head"));
    const handlers = btns.map((btn) => {
      const h = () => {
        const acc = btn.closest(".acc") as HTMLElement;
        const body = acc.querySelector<HTMLElement>(".acc-body");
        if (!body) return;
        const open = acc.classList.toggle("open");
        btn.setAttribute("aria-expanded", String(open));
        body.style.maxHeight = open ? body.scrollHeight + "px" : "0px";
      };
      btn.addEventListener("click", h);
      return () => btn.removeEventListener("click", h);
    });
    return () => handlers.forEach((off) => off());
  }, []);
}

/* 隐私侧滑面板 */
export function usePanel(open: boolean, close: () => void) {
  const veil = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const v = veil.current;
    const p = panel.current;
    if (!v || !p) return;
    if (open) {
      p.hidden = false;
      requestAnimationFrame(() => {
        v.classList.add("open");
        p.classList.add("open");
      });
    } else {
      v.classList.remove("open");
      p.classList.remove("open");
      const t = setTimeout(() => {
        p.hidden = true;
      }, 300);
      return () => clearTimeout(t);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, close]);

  // 返回 ref 回调，供 <aside ref={...}> 使用（避免直接改 ref 对象触发 lint）
  const setVeilRef = useCallback((el: HTMLDivElement | null) => {
    veil.current = el;
  }, []);
  const setPanelRef = useCallback((el: HTMLElement | null) => {
    panel.current = el;
  }, []);
  return { veil: setVeilRef, panel: setPanelRef };
}

/* 埋点：先过 PII 白名单过滤，再交给 PostHog 最小上报器（无 key 时整条链路 no-op） */
export function track(ev: string, props: Record<string, unknown> = {}) {
  capture(ev, sanitizeProperties(props));
}
