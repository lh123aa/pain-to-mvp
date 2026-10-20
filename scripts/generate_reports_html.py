#!/usr/bin/env python3
"""生成公开版机会报告与付费交付物的单文件 HTML（零依赖，可离线打开）"""
import re, html as html_mod
from pathlib import Path

DOCS = Path(__file__).parent.parent / "docs"

REPORTS = [
    ("001-backend-miniprogram", "exec-report-001-backend-miniprogram.md"),
    ("002-promo-bottleneck", "exec-report-002-promo-bottleneck.md"),
    ("003-landing-page-affordable", "exec-report-003-landing-page-affordable.md"),
    ("004-overseas-infra", "exec-report-004-overseas-infra.md"),
]

# 付费交付物：单独再生成，不进入公开列表页（index.html）
DELIVERABLES = [
    ("first-order-deliverable", "first-order-deliverable-backend-miniprogram.md"),
]

# 独立页面（服务说明等）：单独再生成，不进入报告列表页
PAGES = [
    ("service", "service.md"),
    ("calibration", "calibration.md"),
    ("sample-custom-report", "sample-custom-report.md"),
]

CSS = """
:root {
  --bg: #0f0f0f; --card: #1a1a1a; --border: #2a2a2a;
  --text: #e5e5e5; --muted: #888; --accent: #4a9eff;
  --green: #34d399; --yellow: #fbbf24; --red: #f87171;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: -apple-system,'PingFang SC','Microsoft YaHei',sans-serif; line-height:1.7; }
.container { max-width:720px; margin:0 auto; padding:24px 16px 48px; }
.badge { display:inline-block; padding:3px 10px; border-radius:99px; font-size:12px; font-weight:600; margin:0 6px 16px 0; }
.badge-s { background:#f8717122; color:var(--red); }
.badge-a { background:#fbbf2422; color:var(--yellow); }
.badge-b { background:#4a9eff22; color:var(--accent); }
h1 { font-size:1.5rem; line-height:1.4; margin-bottom:8px; }
.meta { color:var(--muted); font-size:.85rem; margin-bottom:24px; }
.card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:16px; }
.card h2 { font-size:1.05rem; color:var(--accent); margin-bottom:12px; }
h3 { font-size:.95rem; color:var(--text); margin:14px 0 6px; }
strong { color:#fff; }
.card p, .card li { font-size:.92rem; }
.card ul { padding-left:20px; margin:8px 0; }
.card li { margin-bottom:4px; }
.quote { border-left:3px solid var(--accent); padding:8px 14px; margin:8px 0; background:#111; border-radius:0 8px 8px 0; color:#ccc; font-size:.88rem; font-style:italic; }
.note { color:var(--muted); font-size:.85rem; margin:6px 0; }
.cta { background:linear-gradient(135deg,#1a1a2e,#16213e); border:1px solid var(--accent); border-radius:12px; padding:18px; margin-top:20px; }
.cta h3 { font-size:1rem; color:var(--accent); margin-bottom:8px; }
.cta p { font-size:.9rem; color:var(--muted); margin-bottom:4px; }
footer { text-align:center; margin-top:32px; color:var(--muted); font-size:.78rem; }
table { width:100%; border-collapse:collapse; font-size:.85rem; margin:8px 0; }
th { text-align:left; color:var(--muted); font-weight:500; padding:6px 8px; border-bottom:1px solid var(--border); }
td { padding:6px 8px; border-bottom:1px solid #222; }
.day-tbl td:first-child { white-space:nowrap; color:var(--accent); font-weight:600; }
/* 打印 / 导出 PDF：自动切换浅色主题（T8 导出交付包） */
@media print {
  :root { --bg:#fff; --card:#fff; --border:#ddd; --text:#111; --muted:#666; --accent:#1a5fd0; }
  body { background:#fff; color:#111; }
  .card { border:1px solid #ddd; }
  strong { color:#111; }
  .quote { background:#f7f7f7; color:#333; }
  .cta { background:#f4f7ff; }
  tr, .quote { break-inside:avoid; }
  a { color:inherit; }
  footer { margin-top:16px; }
}
@page { margin: 14mm 12mm; }
"""


def tier_badge(score: float) -> str:
    t = "s" if score >= 85 else ("a" if score >= 70 else "b")
    return f'<span class="badge badge-{t}">{t.upper()} 档 · {score}/100</span>'


def inline_md(text: str) -> str:
    """转义 + 行内渲染：**x** → <strong>，[文字](链接) → <a>"""
    t = html_mod.escape(text)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" style="color:var(--accent)">\1</a>', t)
    return t


def md_line_to_html(line: str, in_table: bool = False) -> str:
    s = line.strip()
    if not s:
        return ""
    # 表格行
    if s.startswith("|"):
        cells = [c.strip() for c in s.strip("|").split("|")]
        if all(set(c) <= set("-: ") for c in cells):
            return ""  # 分隔行
        tag = "th" if in_table and "动作" in s or "天" in s or "维度" in s else "td"
        return "<tr>" + "".join(f"<{tag}>{html_mod.escape(c)}</{tag}>" for c in cells) + "</tr>"
    # blockquote meta
    if s.startswith("> "):
        text = s[2:]
        if "来源" in text or "证据" in text or "⚠️" in text or "置信" in text:
            return f'<div class="meta">{html_mod.escape(text)}</div>'
        return f'<div class="note">{html_mod.escape(text)}</div>'
    # h1
    if s.startswith("# "):
        return f"<h1>{html_mod.escape(s[2:])}</h1>"
    # h2 → card
    if s.startswith("## "):
        return f'<div class="card"><h2>{html_mod.escape(s[3:])}</h2>'
    # quote 「」
    if "「" in s and (s.startswith("- 「") or s.startswith("「")):
        return f'<div class="quote">{html_mod.escape(s.lstrip("- "))}</div>'
    # 列表项
    if s.startswith("- "):
        item = s[2:]
        return f"<li>{html_mod.escape(item)}</li>"
    # 水平线（卡边界）
    if s == "---":
        return "</div>"  # 关闭 card
    # 普通段落 / 加粗
    bold_m = re.match(r"^\*\*(.+?)\*\*$", s)
    if bold_m:
        return f'<p style="font-weight:600;color:var(--accent);margin:10px 0 4px">{html_mod.escape(bold_m.group(1))}</p>'
    return f"<p>{html_mod.escape(s)}</p>"


def build_html(md_text: str, slug: str, title_hint: str) -> str:
    # 提取分数
    score_m = re.search(r"机会分.*?(\d+\.?\d*)/100", md_text)
    score = float(score_m.group(1)) if score_m else 0.0
    badge = tier_badge(score) if score else ""

    h1_m = re.search(r"^# (.+)$", md_text, re.M)
    title = html_mod.escape(h1_m.group(1).strip()) if h1_m else title_hint

    body_parts = []
    in_table = False
    in_list = False
    in_card = False
    table_buf = []
    list_buf = []

    def flush_list():
        nonlocal list_buf
        if list_buf:
            body_parts.append("<ul>" + "".join(list_buf) + "</ul>")
            list_buf = []

    def flush_table():
        nonlocal table_buf
        if table_buf:
            is_day = any("Day" in r for r in table_buf)
            cls = ' class="day-tbl"' if is_day else ""
            body_parts.append(f"<table{cls}>" + "".join(table_buf) + "</table>")
            table_buf = []

    for line in md_text.splitlines():
        s = line.strip()
        if s.startswith("|"):
            # 表格行
            if s == "---" or set(s.replace("|","").replace("-","").replace(":","").strip()) == set() or s.replace("|","-: ").replace("-","").replace(":","").replace("|","").strip() == "":
                continue
            cells = [c.strip() for c in s.strip("|").split("|")]
            if all(set(c) <= set("-: ") for c in cells):
                continue  # 分隔行
            flush_list()
            tag = "th"
            # 首行 = th（通过表头判断含"动作"/"维度"/"信号"等关键词）
            row_html = "<tr>" + "".join(f"<{tag}>{inline_md(c)}</{tag}>" for c in cells) + "</tr>"
            table_buf.append(row_html)
            in_table = True
            continue
        else:
            if in_table:
                flush_table()
                in_table = False
            flush_list()

        if not s:
            continue
        if s == "---":
            if in_card:
                body_parts.append("</div>")
                in_card = False
            continue
        if s.startswith("# "):
            body_parts.append(f"<h1>{html_mod.escape(s[2:])}</h1>")
        elif s.startswith("### "):
            body_parts.append(f"<h3>{html_mod.escape(s[4:])}</h3>")
        elif s.startswith("## "):
            body_parts.append(f'<div class="card"><h2>{html_mod.escape(s[3:])}</h2>')
            in_card = True
        elif s.startswith("> "):
            text = s[2:]
            if "来源" in text or "证据" in text or "⚠️" in text or "置信" in text:
                body_parts.append(f'<div class="meta">{inline_md(text)}</div>')
            else:
                body_parts.append(f'<div class="note">{inline_md(text)}</div>')
        elif s.startswith("- 「"):
            body_parts.append(f'<div class="quote">{inline_md(s[2:])}</div>')
        elif s.startswith("- "):
            list_buf.append(f"<li>{inline_md(s[2:])}</li>")
            in_list = True
        else:
            # 普通行：检查是否 Day 表格内的续行
            bold_m = re.match(r"^\*\*(.+?)\*\*$", s)
            if bold_m:
                body_parts.append(f'<p style="font-weight:600;color:var(--accent);margin:10px 0 4px">{html_mod.escape(bold_m.group(1))}</p>')
            else:
                body_parts.append(f"<p>{inline_md(s)}</p>")

    flush_list()
    flush_table()
    if in_card:
        body_parts.append("</div>")

    body_html = "\n".join(body_parts)

    page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>{CSS}</style>
</head>
<body>
<div class="container">
{badge}
{body_html}
<footer>
pain-to-mvp 管线自动生成 · 数据来源：B 站评论区真实评论 · 2026-10 · <a href="#" style="color:var(--accent)">← 返回报告列表</a>
</footer>
</div>
</body>
</html>"""
    return page


def build_index_html() -> str:
    """生成报告列表页（GitHub Pages 首页）"""
    # 评论数来自对应机会卡（事实，已核实）
    sizes = {
        "001-backend-miniprogram": "112",
        "002-promo-bottleneck": "21",
        "003-landing-page-affordable": "9",
        "004-overseas-infra": "31",
    }
    cards = []
    for slug, md_file in REPORTS:
        md_text = (DOCS / md_file).read_text(encoding="utf-8")
        h1_m = re.search(r"^# (.+)$", md_text, re.M)
        title = h1_m.group(1).strip() if h1_m else slug
        score_m = re.search(r"机会分.*?(\d+\.?\d*)/100", md_text)
        score = score_m.group(1) if score_m else "?"
        size = sizes.get(slug, "?")
        tier = "S" if float(score) >= 85 else ("A" if float(score) >= 70 else "B")
        tcls = f"badge-{tier.lower()}"
        cards.append(f"""
        <a class="card card-link" href="{slug}.html">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span class="badge {tcls}">{tier} 档 · {score}/100</span>
            <span style="color:var(--muted);font-size:.8rem">{size} 条评论</span>
          </div>
          <h2 style="color:var(--text);font-size:1rem;margin:0">{html_mod.escape(title)}</h2>
        </a>
        """)

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>机会报告 · pain-to-mvp</title>
<style>{CSS}
.card-link {{ display:block; text-decoration:none; color:inherit; }}
.card-link:hover {{ border-color:var(--accent); }}
</style>
</head>
<body>
<div class="container">
  <h1 style="margin-bottom:8px">机会报告</h1>
  <div class="meta">pain-to-mvp 管线自动挖掘 · 数据来源：B 站评论区真实评论 · 2026-10 · 共 {len(REPORTS)} 份</div>
  {''.join(cards)}
  <footer>本报告为免费公开版，证据链可逐条回溯核对 · 更新于 2026-10 · <a href="calibration.html" style="color:var(--accent)">校准公示 →</a> · <a href="service.html" style="color:var(--accent)">定制报告服务 →</a></footer>
</div>
</body>
</html>"""


if __name__ == "__main__":
    for slug, md_file in REPORTS:
        md_text = (DOCS / md_file).read_text(encoding="utf-8")
        html_out = build_html(md_text, slug, slug)
        out = DOCS / f"{slug}.html"
        out.write_text(html_out, encoding="utf-8")
        print(f"✅ {out.name}  ({len(html_out)} bytes)")
    for slug, md_file in DELIVERABLES:
        md_text = (DOCS / md_file).read_text(encoding="utf-8")
        html_out = build_html(md_text, slug, slug)
        out = DOCS / f"{slug}.html"
        out.write_text(html_out, encoding="utf-8")
        print(f"✅ {out.name}  ({len(html_out)} bytes)")
    for slug, md_file in PAGES:
        md_text = (DOCS / md_file).read_text(encoding="utf-8")
        html_out = build_html(md_text, slug, slug)
        out = DOCS / f"{slug}.html"
        out.write_text(html_out, encoding="utf-8")
        print(f"✅ {out.name}  ({len(html_out)} bytes)")
    idx = DOCS / "index.html"
    idx.write_text(build_index_html(), encoding="utf-8")
    print(f"✅ index.html  ({len(idx.read_text())} bytes)")
