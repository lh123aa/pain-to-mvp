"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { initPostHog } from "@/lib/posthog";

/**
 * 路由级 pageview（W3-6）
 *
 * 只在 `NEXT_PUBLIC_POSTHOG_KEY` 存在时才真正上报（无 key 时 initPostHog 返回
 * disabled 客户端，isEnabled()=false → 直接 return，无网络、无 storage 写入）。
 *
 * PII：只发 `$pageview`，属性只有 path；path 由 `sanitizePath()` 去掉
 * `?query` 与 `#hash`，所以 `?token=` / `?order_id=` / `?email=` 不会被带上。
 * 组件不注入任何 DOM 监听，因此没有 autocapture / session replay / heatmap。
 */
export function Analytics() {
  const pathname = usePathname();
  // StrictMode 的 effect 双跑 / 同路径重复渲染时避免重复 pageview。
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const path = pathname ?? "/";
    if (lastPath.current === path) return;
    lastPath.current = path;

    const client = initPostHog();
    if (!client.isEnabled()) return;
    client.pageview(path);
  }, [pathname]);

  return null;
}
