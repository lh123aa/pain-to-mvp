# -*- coding: utf-8 -*-
"""落地页生成器：单文件输出、字段转义、配置覆盖、零外部依赖。"""
import json

import generate_landing_page as glp  # conftest 已把 scripts/ 加进 sys.path


def test_demo_page_is_single_file_and_has_cta():
    html = glp.build_page(glp.DEMO)
    assert "<!DOCTYPE html>" in html
    assert glp.DEMO["headline"] in html
    assert "预约" in html, "CTA 必须存在"
    # 零依赖：不允许任何外部资源引用（可离线打开 / GitHub Pages 直发）
    assert "<script" not in html
    assert "<link" not in html


def test_config_json_overrides_demo(tmp_path):
    cfg = {"headline": "测试标题：给猫做副业工具的验证页", "cta_text": "点我预约",
           "form_url": "https://example.com/form"}
    p = tmp_path / "cfg.json"
    p.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "out.html"
    assert glp.main(["--config", str(p), "-o", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert "测试标题" in text
    assert 'href="https://example.com/form"' in text
    assert "点我预约" in text


def test_html_escaping_prevents_injection():
    html = glp.build_page({**glp.DEMO,
                           "headline": "<script>alert(1)</script>",
                           "pain_points": ['"><img src=x onerror=alert(1)>']})
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "<img" not in html


def test_missing_form_url_shows_placeholder_hint():
    html = glp.build_page({**glp.DEMO, "form_url": ""})
    assert "btn-off" in html, "未配置表单链接时必须使用占位按钮"
    assert "form_url" in html, "必须提示上线前替换 form_url"
