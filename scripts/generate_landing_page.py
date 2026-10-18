#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""需求验证落地页生成器 —— 从一个"机会"的配置生成可部署的测试落地页（单文件 HTML，零依赖）。

定位：机会报告「深度版」的权益之一 —— 用户拿到报告后当天就能开跑验证：
落地页 + 留资表单（金数据 / 腾讯问卷，零后端），用真实预约信号验证需求。

用法：
  python scripts/generate_landing_page.py --demo -o docs/landing-page-demo-001.html
  python scripts/generate_landing_page.py --config client.json -o client.html

配置字段（JSON / UTF-8，除 headline 外均有默认值）见 DEMO 与 DEFAULTS。
生成的文件不含任何外部资源（可直接离线打开 / GitHub Pages 部署）；
<!-- 由 pain-to-mvp 落地页生成器生成 -->
"""
import argparse
import html as html_mod
import json
from pathlib import Path


def esc(x) -> str:
    return html_mod.escape(str(x))


def _quotes(items) -> str:
    return "\n".join(f'<blockquote>{esc(q)}</blockquote>' for q in items)


def _props(items) -> str:
    cards = []
    for it in items:
        title = esc(it.get("title", ""))
        desc = esc(it.get("desc", ""))
        cards.append(f'<div class="prop"><h3>{title}</h3><p>{desc}</p></div>')
    return "\n".join(cards)


DEFAULTS = {
    "product_name": "",
    "headline": "一句话价值主张（必填）",
    "subhead": "",
    "audience": "",
    "pain_points": [],
    "value_props": [],
    "cta_text": "抢先预约内测",
    "form_url": "",
    "form_note": "",
    "evidence_note": "",
    "footer_note": "本页面为需求验证用途 · 预约信息仅用于与你联系，不作他用。",
}

DEMO = {
    "product_name": "小程序前端生成器（验证页 Demo）",
    "headline": "只写后端，也能做出小程序前端——基于模板自动生成，你只管数据绑定",
    "subhead": "选模板 → 生成前端 → 接数据接口，不用再啃 jQuery / AngularJS。",
    "audience": "后端开发者、独立开发者、想快速验证小程序方向的微创业者",
    "pain_points": [
        "「我是做后端的，想做一个有关垂直领域的微信小程序，前端只会 jquery 和简单的 angularJS，如果有一种工具可以让你基于预设的模板做界面设计，自动生成前端代码，你只需要关注怎么与后端做数据绑定，就爽了。」",
        "「服务器一般选什么配置？服务器费用是否包含在开发费用里面？后期维护怎么搞，这一块感觉就比较麻烦。」",
    ],
    "value_props": [
        {"title": "① 预设模板选界面", "desc": "列表 / 表单 / 详情三类高频界面，选好就能用"},
        {"title": "② 自动生成前端代码", "desc": "不用手写前端，生成后直接改文案、换字段"},
        {"title": "③ 只关注数据绑定", "desc": "附数据绑定说明：后端接口对上前端字段就完事"},
    ],
    "cta_text": "预约首批内测",
    "form_url": "",
    "evidence_note": "本页由机会报告 #20261016-001 生成：112 条 B 站公开评论聚合，痛点原话匿名化、可逐条回溯。",
    "footer_note": "Demo 由 pain-to-mvp 深度版报告附带生成 · 用于需求验证",
}

CSS = """
:root { --ink:#1a1a1a; --muted:#666; --line:#e5e5e5; --accent:#2f6fed; --bg:#fafafa; }
* { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--bg); color:var(--ink); font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif; line-height:1.8; }
main { max-width:640px; margin:0 auto; padding:48px 20px 64px; }
.hero { text-align:center; padding:32px 0 40px; }
.hero .badge { display:inline-block; font-size:12px; color:var(--accent); border:1px solid var(--accent); border-radius:99px; padding:2px 12px; margin-bottom:16px; }
h1 { font-size:1.6rem; line-height:1.5; margin-bottom:12px; }
.sub { color:var(--muted); font-size:.95rem; margin-bottom:8px; }
.aud { color:var(--muted); font-size:.85rem; margin-bottom:24px; }
.btn { display:inline-block; background:var(--accent); color:#fff; text-decoration:none; padding:12px 32px; border-radius:10px; font-weight:600; }
.btn-off { background:#9db4e8; }
.hint { color:var(--muted); font-size:.8rem; margin-top:10px; }
section { margin-bottom:40px; }
h2 { font-size:1.05rem; margin-bottom:16px; }
blockquote { background:#fff; border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:0 10px 10px 0; padding:12px 16px; margin-bottom:10px; color:#333; font-size:.9rem; }
.prop { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:12px; }
.prop h3 { font-size:.95rem; margin-bottom:6px; }
.prop p { color:var(--muted); font-size:.85rem; }
.cta2 { text-align:center; background:#fff; border:1px solid var(--line); border-radius:14px; padding:28px 20px; }
footer { text-align:center; color:var(--muted); font-size:.78rem; margin-top:48px; }
"""


def build_page(cfg: dict) -> str:
    """把配置渲染成单文件 HTML（全部字段转义；无外部资源）。"""
    cfg = {**DEFAULTS, **cfg}
    form_url = str(cfg.get("form_url") or "").strip()
    if form_url and form_url != "#":
        cta = f'<a class="btn" href="{esc(form_url)}" target="_blank" rel="noopener">{esc(cfg["cta_text"])}</a>'
        form_hint = ""
    else:
        cta = f'<span class="btn btn-off">{esc(cfg["cta_text"])}</span>'
        form_hint = '<p class="hint">演示占位——上线前把配置里的 form_url 替换为你的金数据 / 腾讯问卷链接，即可开始收集预约。</p>'

    pain_html = _quotes(cfg.get("pain_points") or [])
    props_html = _props(cfg.get("value_props") or [])
    pains_block = (
        f'<section><h2>他们说的问题，先听原话</h2>{pain_html}'
        + (f'<p class="hint">{esc(cfg["evidence_note"])}</p>' if cfg.get("evidence_note") else "")
        + "</section>"
        if pain_html
        else ""
    )
    props_block = f'<section><h2>我们准备这样解决</h2>{props_html}</section>' if props_html else ""

    return (
        "<!-- 由 pain-to-mvp 落地页生成器生成 · 上线前替换 form_url 即可收集预约 · 建议部署：GitHub Pages（零成本） -->\n"
        '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        f"<title>{esc(cfg['product_name'] or cfg['headline'])} · 预约</title>\n"
        f"<style>{CSS}</style>\n</head>\n<body>\n<main>\n"
        '<header class="hero">\n'
        f'<p class="badge">{esc(cfg["product_name"] or "需求验证")} · 预约内测</p>\n'
        f"<h1>{esc(cfg['headline'])}</h1>\n"
        + (f'<p class="sub">{esc(cfg["subhead"])}</p>\n' if cfg.get("subhead") else "")
        + (f'<p class="aud">适合：{esc(cfg["audience"])}</p>\n' if cfg.get("audience") else "")
        + f"{cta}\n{form_hint}\n</header>\n"
        + pains_block + "\n" + props_block + "\n"
        + '<section class="cta2">\n<h2>愿意试试吗？</h2>\n'
        f'<p class="hint">{esc(cfg.get("form_note") or "留下联系方式，内测开放时第一时间通知你。")}</p>\n'
        f'<p style="margin-top:14px">{cta}</p>\n</section>\n'
        + f'<footer>{esc(cfg["footer_note"])}</footer>\n'
        + "</main>\n</body>\n</html>\n"
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="生成需求验证落地页（单文件 HTML，零依赖）")
    ap.add_argument("--demo", action="store_true", help="用内置示例配置（机会卡 #20261016-001）生成")
    ap.add_argument("--config", help="JSON 配置路径（与 --demo 二选一）")
    ap.add_argument("-o", "--output", required=True, help="输出 HTML 路径")
    args = ap.parse_args(argv)

    if args.demo:
        cfg = dict(DEMO)
    elif args.config:
        cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    else:
        ap.error("需要 --demo 或 --config 之一")

    html_out = build_page(cfg)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_out, encoding="utf-8")
    print(f"✅ {out.name}  ({len(html_out)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
