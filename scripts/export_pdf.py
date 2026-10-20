#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""HTML → PDF 一键导出（T8 导出交付包）。

后端自动选择（可用 --backend 强制）：
  1. cloakbrowser  本机隐身 Chromium（Playwright API）——用其专用 venv 运行本脚本：
       G:\\程序\\CloakBrowser\\.venv\\Scripts\\python.exe scripts\\export_pdf.py --all
  2. playwright    当前解释器装有 playwright 时（page.pdf 渲染，保真度最好）
  3. chrome        系统 Chromium 系浏览器的无头 CLI（--print-to-pdf）
                   浏览器可用 PAIN_MVP_BROWSER 环境变量或 --browser 指定

用法：
  python scripts/export_pdf.py --all                    # 4 份报告 + 深度交付物 + 服务页
  python scripts/export_pdf.py 001-backend-miniprogram first-order-deliverable-deck
  python scripts/export_pdf.py --all --dry-run           # 只列出将导出什么、用什么后端

说明：页面自带打印样式（@media print 自动浅色），导出的 PDF 无需手动调整。
输出目录默认 docs/pdf/（已加入 .gitignore，随时可由本脚本重建）。
"""
import argparse
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

# 5 份存量交付物 + 服务页 + 校准公示页
DEFAULT_TARGETS = [
    "001-backend-miniprogram",
    "002-promo-bottleneck",
    "003-landing-page-affordable",
    "004-overseas-infra",
    "first-order-deliverable",
    "service",
    "calibration",
    "tagging-checklist",
]

CHROME_HINTS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome():
    """返回可用的 Chromium 系浏览器可执行文件路径；找不到返回 None。"""
    env = os.environ.get("PAIN_MVP_BROWSER")
    if env and Path(env).is_file():
        return env
    for hint in CHROME_HINTS:
        if Path(hint).is_file():
            return hint
    return None


def pick_backend(force: str = "auto") -> str:
    if force != "auto":
        return force
    if importlib.util.find_spec("cloakbrowser"):
        return "cloakbrowser"
    if importlib.util.find_spec("playwright"):
        return "playwright"
    if find_chrome():
        return "chrome"
    return "none"


def resolve_targets(names):
    """名字 → 存在的 HTML 文件；返回 (files, missing)。接受 slug / 文件名 / 路径。"""
    files, missing = [], []
    seen = set()
    for n in names:
        p = Path(n)
        if p.suffix == ".html":
            cands = [p if p.is_absolute() else ROOT / p, DOCS / p.name]
        else:
            cands = [DOCS / f"{n}.html", ROOT / f"{n}.html", p]
        for c in cands:
            if c.is_file():
                rc = c.resolve()
                if rc not in seen:
                    seen.add(rc)
                    files.append(rc)
                break
        else:
            missing.append(n)
    return files, missing


def _export_with_api(pairs, kind: str) -> None:
    """用 Playwright 系 API 导出（cloakbrowser 优先）。"""
    pw = None
    if kind == "cloakbrowser":
        from cloakbrowser import launch  # type: ignore
        browser = launch(headless=True)
    else:
        from playwright.sync_api import sync_playwright  # type: ignore
        pw = sync_playwright().start()
        browser = pw.chromium.launch()
    try:
        for src, out in pairs:
            page = browser.new_page()
            page.goto(src.as_uri(), wait_until="load", timeout=60000)
            page.emulate_media(media="print")
            page.pdf(
                path=str(out),
                format="A4",
                print_background=True,
                margin={"top": "14mm", "bottom": "14mm", "left": "12mm", "right": "12mm"},
            )
            page.close()
    finally:
        browser.close()
        if pw is not None:
            pw.stop()


def _export_with_chrome(pairs, exe: str) -> None:
    """用 Chromium 系浏览器无头 CLI 导出（--print-to-pdf）。"""
    for src, out in pairs:
        cmd = [
            exe,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            f"--print-to-pdf={out}",
            "--no-pdf-header-footer",
            "--print-to-pdf-no-header",
            src.as_uri(),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if not (out.exists() and out.stat().st_size > 0):
            raise RuntimeError(f"{src.name} 导出失败：{(proc.stderr or proc.stdout)[:300]}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="HTML → PDF 一键导出（交付物 / 报告 / 服务页）")
    ap.add_argument("targets", nargs="*", help="报告 slug 或 HTML 文件名（可多个）")
    ap.add_argument("--all", action="store_true", help="导出全部 5 份交付物 + 服务页")
    ap.add_argument("--out-dir", default="docs/pdf", help="输出目录（默认 docs/pdf）")
    ap.add_argument("--backend", default="auto",
                    choices=["auto", "cloakbrowser", "playwright", "chrome"])
    ap.add_argument("--browser", help="Chromium 系浏览器可执行文件（chrome 后端）")
    ap.add_argument("--dry-run", action="store_true", help="只列出将导出什么")
    args = ap.parse_args(argv)

    names = list(args.targets)
    if args.all:
        names = DEFAULT_TARGETS + names  # --all 与显式目标合并（resolve_targets 自动去重）
    if not names:
        ap.error("请给出目标（slug / 文件名）或使用 --all")

    files, missing = resolve_targets(names)
    for m in missing:
        print(f"⚠️ 找不到：{m}", file=sys.stderr)
    if not files:
        return 1

    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir

    backend = pick_backend(args.backend)
    pairs = [(f, out_dir / (f.stem + ".pdf")) for f in files]

    if args.dry_run:
        print(f"backend: {backend}")
        for src, out in pairs:
            print(f"{src.relative_to(ROOT)} -> {out.relative_to(ROOT)}")
        if backend == "none":
            print("提示：当前解释器无 cloakbrowser/playwright 且未找到系统浏览器；"
                  "可安装 playwright，或用 --browser 指定浏览器路径。")
        return 0

    if backend == "none":
        print("❌ 没有可用的导出后端：未找到 cloakbrowser / playwright / 系统 Chromium 系浏览器。\n"
              "   可选：pip install playwright && playwright install chromium；"
              "或 --browser 指定浏览器可执行文件。", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        if backend in ("cloakbrowser", "playwright"):
            _export_with_api(pairs, backend)
        else:
            exe = args.browser or find_chrome()
            if not exe:
                print("❌ 未找到 Chromium 系浏览器，可用 --browser 指定路径。", file=sys.stderr)
                return 1
            _export_with_chrome(pairs, exe)
    except Exception as exc:
        print(f"❌ 导出失败：{exc}", file=sys.stderr)
        return 1

    for _, out in pairs:
        print(f"✅ {out.relative_to(ROOT)}  ({out.stat().st_size} bytes)")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
