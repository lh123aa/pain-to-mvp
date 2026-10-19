# -*- coding: utf-8 -*-
"""T5：校准公示页（docs/calibration.md → calibration.html）内容与口径测试。"""
from pathlib import Path

from generate_reports_html import build_html

ROOT = Path(__file__).resolve().parents[1]
MD = ROOT / "docs" / "calibration.md"


def _html() -> str:
    return build_html(MD.read_text(encoding="utf-8"), "calibration", "校准公示")


def test_calibration_page_has_current_numbers():
    html = _html()
    for fact in ("8 / 20", "62.5%", "66.7%", "≥70%", "未达标"):
        assert fact in html, f"校准页缺关键数字：{fact}"


def test_calibration_page_has_methodology_and_trace():
    html = _html()
    for sec in ("什么是校准", "防灌水与纪律", "怎么核对"):
        assert sec in html, f"校准页缺小节：{sec}"
    assert "33%" in html and "60%" in html  # 轨迹
    assert "空理由拒收" in html


def test_calibration_page_no_placeholder_left():
    html = _html()
    assert "【待填】" not in html
    assert "TODO" not in html
