#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""机会报告 → 简约演示版（单文件 slide deck，零依赖，可离线打开）。

定位：T8 导出交付包的一部分 —— 客户把报告拿去开会 / 转发时用的「演示版」。
规则：报告的每个 `##` 小节 = 一页幻灯片；浅色主题；空格 / 方向键翻页
（CSS scroll-snap，无 JS）；Ctrl+P 每页一屏导出 PDF。

用法：
  python scripts/generate_deck.py docs/exec-report-001-backend-miniprogram.md \
      -o docs/001-backend-miniprogram-deck.html
"""
import argparse
import html as html_mod
import re
from pathlib import Path

from generate_reports_html import inline_md

CSS = """
:root { --ink:#16181d; --muted:#6b7280; --line:#e5e7eb; --accent:#2f6fed; --soft:#f4f5f7; --card:#fff; }
* { box-sizing:border-box; margin:0; padding:0; }
html { scroll-snap-type:y proximity; }
body { background:var(--soft); color:var(--ink); font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif; line-height:1.8; }
.deck { max-width:880px; margin:0 auto; padding:18px 16px 56px; }
.slide { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:44px 48px; margin-bottom:20px; min-height:78vh; scroll-snap-align:start; display:flex; flex-direction:column; justify-content:center; }
.kicker { color:var(--accent); font-size:.8rem; letter-spacing:.08em; margin-bottom:18px; }
.cover h1 { font-size:1.8rem; line-height:1.5; margin-bottom:18px; }
.meta { color:var(--muted); font-size:.88rem; }
.hint { color:var(--muted); font-size:.8rem; margin-top:30px; }
.slide h2 { font-size:1.25rem; color:var(--accent); margin-bottom:20px; padding-bottom:12px; border-bottom:2px solid var(--line); }
.slide h3 { font-size:.98rem; margin:16px 0 6px; }
.slide p { margin:7px 0; font-size:.95rem; }
.slide .lead { color:var(--accent); font-weight:600; margin:14px 0 4px; }
.bullet { margin-left:2px; }
blockquote { background:#f8fafc; border-left:3px solid var(--accent); border-radius:0 10px 10px 0; padding:10px 16px; margin:9px 0; color:#334155; font-size:.9rem; }
.note { color:var(--muted); font-size:.85rem; }
table { width:100%; border-collapse:collapse; font-size:.86rem; margin:10px 0; }
th { text-align:left; color:var(--muted); font-weight:600; padding:6px 8px; border-bottom:2px solid var(--line); background:#fafbfc; }
td { padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
.deck-footer { text-align:center; color:var(--muted); font-size:.78rem; margin-top:6px; }
@media print {
  html { scroll-snap-type:none; }
  body { background:#fff; }
  .deck { max-width:none; padding:0; }
  .slide { border:none; border-radius:0; min-height:auto; padding:24px 4px; margin:0; break-after:page; page-break-after:always; display:block; }
  .slide:last-of-type { break-after:auto; page-break-after:auto; }
}
@page { margin:16mm 14mm; }
"""


def split_sections(md_text: str):
    """→ (标题, 封面 meta 行列表, [{'title': 小节名, 'lines': 行}, ...])"""
    title = None
    meta = []
    sections = []
    current = None
    for raw in md_text.splitlines():
        s = raw.rstrip()
        if s.startswith("# ") and title is None:
            title = s[2:].strip()
            continue
        if s.startswith("## "):
            current = {"title": s[3:].strip(), "lines": []}
            sections.append(current)
            continue
        if current is None:
            if s.startswith("> "):
                meta.append(s[2:].strip())
            continue
        if s.strip() in ("", "---"):
            continue
        current["lines"].append(s)
    return title, meta, sections


def render_lines(lines) -> str:
    """把一个小节的 Markdown 行渲染成幻灯片内容（表格 / 引语 / 列表 / 段落）。"""
    out = []
    tbl = []

    def flush_table():
        nonlocal tbl
        if not tbl:
            return
        rows = []
        for i, r in enumerate(tbl):
            tag = "h" if i == 0 else "d"
            cells = "".join(f"<t{tag}>{inline_md(c)}</t{tag}>" for c in r)
            rows.append(f"<tr>{cells}</tr>")
        out.append("<table>" + "".join(rows) + "</table>")
        tbl = []

    for s in lines:
        t = s.strip()
        if not t:
            continue
        if t.startswith("|"):
            cells = [c.strip() for c in t.strip("|").split("|")]
            if all(set(c) <= set("-: ") for c in cells):
                continue  # 分隔行
            tbl.append(cells)
            continue
        flush_table()
        if t.startswith("### "):
            out.append(f"<h3>{inline_md(t[4:])}</h3>")
        elif t.startswith("> "):
            out.append(f'<p class="note">{inline_md(t[2:])}</p>')
        elif t.startswith("- 「") or t.startswith("「"):
            out.append(f'<blockquote>{inline_md(t.lstrip("- "))}</blockquote>')
        elif t.startswith("- "):
            out.append(f'<p class="bullet">• {inline_md(t[2:])}</p>')
        elif re.match(r"^\*\*(.+?)\*\*$", t):
            out.append(f'<p class="lead">{inline_md(t)}</p>')
        else:
            out.append(f"<p>{inline_md(t)}</p>")
    flush_table()
    return "\n".join(out)


def build_deck(md_text: str, source: str = "") -> str:
    """报告 Markdown → 单文件演示版 HTML（全部转义；无外部资源、无 JS）。"""
    title, meta, sections = split_sections(md_text)
    title = title or "机会报告 · 演示版"
    meta_html = "".join(f'<p class="meta">{inline_md(m)}</p>' for m in meta)
    slides = [
        '<section class="slide cover">'
        '<p class="kicker">pain-to-mvp · 机会报告演示版</p>'
        f"<h1>{inline_md(title)}</h1>"
        f"{meta_html}"
        f'<p class="hint">共 {len(sections) + 1} 页 · 空格 / 方向键翻页 · Ctrl+P 导出 PDF</p>'
        "</section>"
    ]
    for sec in sections:
        slides.append(
            f'<section class="slide"><h2>{inline_md(sec["title"])}</h2>'
            f'{render_lines(sec["lines"])}</section>'
        )
    footer = (
        f'<p class="deck-footer">{inline_md(source)} · 由 pain-to-mvp 生成（单文件，可离线打开）</p>'
        if source
        else ""
    )
    return (
        "<!-- 由 pain-to-mvp 演示版生成器生成 · 每小节一页 · Ctrl+P 可导出 PDF -->\n"
        '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        f"<title>{html_mod.escape(title)} · 演示版</title>\n"
        f"<style>{CSS}</style>\n</head>\n<body>\n<div class=\"deck\">\n"
        + "\n".join(slides)
        + f"\n{footer}\n</div>\n</body>\n</html>\n"
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="机会报告 → 简约演示版（单文件 HTML，零依赖）")
    ap.add_argument("input", help="报告 Markdown 路径")
    ap.add_argument("-o", "--output", required=True, help="输出 HTML 路径")
    args = ap.parse_args(argv)

    src = Path(args.input)
    md = src.read_text(encoding="utf-8")
    html_out = build_deck(md, source=f"来源：{src.name}")
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_out, encoding="utf-8")
    print(f"✅ {out.name}  ({len(html_out)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
