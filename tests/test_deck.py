# -*- coding: utf-8 -*-
"""T8：演示版生成器（scripts/generate_deck.py）测试。"""
from pathlib import Path

import generate_deck

ROOT = Path(__file__).resolve().parents[1]
MD_001 = ROOT / "docs" / "exec-report-001-backend-miniprogram.md"


def test_deck_has_cover_and_all_sections():
    md = MD_001.read_text(encoding="utf-8")
    html = generate_deck.build_deck(md, source="来源：exec-report-001.md")
    assert 'class="slide cover"' in html
    assert html.count('class="slide') >= 9  # 封面 + 全部小节
    assert "付费意愿信号（WTP）" in html
    assert "现有替代方案与缺口" in html
    assert "来源：exec-report-001.md" in html


def test_deck_zero_dependency():
    md = MD_001.read_text(encoding="utf-8")
    html = generate_deck.build_deck(md)
    low = html.lower()
    assert "<script" not in low
    assert "<link" not in low  # 无外部样式表
    assert "src=" not in low  # 无外部资源
    assert "<table>" in html  # 表格被保留


def test_deck_splits_assumptions_and_escapes():
    md = "# 标题\n\n> 来源：测试\n\n## 小节一\n- 项目\n\n## 小节二\n**加粗段**\n"
    html = generate_deck.build_deck(md)
    assert html.count('class="slide') == 3  # 封面 + 2 小节
    assert "来源：测试" in html
    assert "<strong>加粗段</strong>" in html


def test_deck_cli_writes_file(tmp_path):
    out = tmp_path / "deck.html"
    rc = generate_deck.main([str(MD_001), "-o", str(out)])
    assert rc == 0
    text = out.read_text(encoding="utf-8")
    assert text.startswith("<!--") and "slide" in text
