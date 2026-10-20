#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 docs/tagging-checklist.md 渲染为单文件 HTML（含打印样式，可导出 PDF）。"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SRC = DOCS / "tagging-checklist.md"
OUT = DOCS / "tagging-checklist.html"

CSS = """
:root {
  --bg:#0f0f0f; --card:#1a1a1a; --border:#2a2a2a; --text:#e5e5e5;
  --muted:#888; --accent:#4a9eff; --green:#34d399; --yellow:#fbbf24;
}
* { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--bg); color:var(--text); font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif; line-height:1.75; }
.container { max-width:760px; margin:0 auto; padding:28px 18px 56px; }
h1 { font-size:1.55rem; line-height:1.4; margin-bottom:8px; }
.meta { color:var(--muted); font-size:.84rem; margin-bottom:22px; }
.card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px 22px; margin-bottom:14px; }
.card h2 { font-size:1.05rem; color:var(--accent); margin-bottom:10px; }
h3 { font-size:.95rem; margin:14px 0 6px; }
p { margin:6px 0; font-size:.93rem; }
ul,ol { padding-left:22px; margin:8px 0; }
li { margin-bottom:5px; font-size:.93rem; }
strong { color:#fff; }
code { background:#111; border:1px solid var(--border); border-radius:6px; padding:1px 6px; font-size:.85em; }
blockquote { border-left:3px solid var(--accent); background:#111; border-radius:0 8px 8px 0; padding:10px 14px; color:#bbb; font-size:.9rem; margin:10px 0; }
table { width:100%; border-collapse:collapse; font-size:.86rem; margin:10px 0; }
th { text-align:left; color:var(--muted); font-weight:600; padding:7px 8px; border-bottom:1px solid var(--border); background:#151515; }
td { padding:7px 8px; border-bottom:1px solid #222; vertical-align:top; }
tr { break-inside:avoid; }
.footer { margin-top:26px; color:var(--muted); font-size:.8rem; text-align:center; }
@media print {
  :root { --bg:#fff; --card:#fff; --border:#ddd; --text:#111; --muted:#666; --accent:#1a5fd0; }
  body { background:#fff; color:#111; }
  .card { border:1px solid #ddd; break-inside:avoid; }
  strong { color:#111; }
  code { background:#f5f5f5; }
  blockquote { background:#f7f7f7; color:#333; }
  th { background:#f2f2f2; }
}
@page { margin:14mm 12mm; }
"""


def inline(text: str) -> str:
    t = html.escape(text)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    return t


def render(md: str) -> str:
    lines = md.splitlines()
    parts = []
    i = 0
    in_card = False

    def close_card():
        nonlocal in_card
        if in_card:
            parts.append("</div>")
            in_card = False

    while i < len(lines):
        s = lines[i].strip()
        if not s:
            i += 1
            continue

        if s == "---":
            close_card()
            i += 1
            continue

        if s.startswith("# "):
            close_card()
            parts.append(f"<h1>{inline(s[2:])}</h1>")
            i += 1
            continue

        if s.startswith("## "):
            close_card()
            parts.append(f'<div class="card"><h2>{inline(s[3:])}</h2>')
            in_card = True
            i += 1
            continue

        if s.startswith("> "):
            buf = []
            while i < len(lines) and lines[i].strip().startswith("> "):
                buf.append(lines[i].strip()[2:])
                i += 1
            text = "<br>".join(inline(x) for x in buf)
            cls = "meta" if len(parts) <= 1 else "note"
            if cls == "meta":
                parts.append(f'<div class="meta">{text}</div>')
            else:
                parts.append(f"<blockquote>{text}</blockquote>")
            continue

        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(set(c) <= set("-: ") for c in row):
                    rows.append(row)
                i += 1
            if rows:
                head, body = rows[0], rows[1:]
                th = "".join(f"<th>{inline(c)}</th>" for c in head)
                trs = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
                parts.append(f"<table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>")
            continue

        if s.startswith("- "):
            items = []
            while i < len(lines) and lines[i].strip().startswith("- "):
                items.append(f"<li>{inline(lines[i].strip()[2:])}</li>")
                i += 1
            parts.append("<ul>" + "".join(items) + "</ul>")
            continue

        if re.match(r"^\d+\.\s", s):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i].strip()):
                text = lines[i].strip().split(". ", 1)[-1]
                items.append(f"<li>{inline(text)}</li>")
                i += 1
            parts.append("<ol>" + "".join(items) + "</ol>")
            continue

        parts.append(f"<p>{inline(s)}</p>")
        i += 1

    close_card()
    return "\n".join(parts)


def main() -> None:
    md = SRC.read_text(encoding="utf-8")
    body = render(md)
    html_out = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>评论区需求打标清单 · pain-to-mvp</title>
<style>{CSS}</style>
</head>
<body>
<div class="container">
{body}
<div class="footer">免费资料 · 可自由转发 · 请保留出处 · 2026-10</div>
</div>
</body>
</html>"""
    OUT.write_text(html_out, encoding="utf-8")
    print(f"OK {OUT.name} {len(html_out)} bytes")


if __name__ == "__main__":
    main()
