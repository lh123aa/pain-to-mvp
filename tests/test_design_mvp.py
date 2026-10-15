# -*- coding: utf-8 -*-
"""design_mvp 推荐必须基于主导信号（频次最高），而非 dict 插入顺序（OPEN_ISSUES #24）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "pipeline"))

from design_mvp import design_mvp  # noqa: E402


def test_dominant_signal_drives_recommendation():
    # "期望"排在第一位但只有 1 票；"求助" 9 票才是主导信号
    pain = {
        "signal_distribution": {"期望": 1, "求助": 9},
        "representative_quotes": ["求个能自动记账的工具"],
    }
    out = design_mvp(pain)
    assert out["recommended_mvp"][0]["signal"] == "求助", (
        "首推必须是频次最高信号，而非 dict 第一个键")
    assert out["deliverable_hint"] == out["recommended_mvp"][0]["type"], (
        "deliverable_hint 必须跟随主导信号")


def test_monotonic_ordering_by_count():
    # 只用 SIGNAL_TO_MVP 里存在的真实信号
    pain = {
        "signal_distribution": {"期望": 2, "求助": 5, "抱怨": 3},
        "representative_quotes": [],
    }
    out = design_mvp(pain)
    sigs = [r["signal"] for r in out["recommended_mvp"]]
    assert sigs[0] == "求助", f"频次最高应排首，实际 {sigs}"
    assert sigs == ["求助", "抱怨", "期望"], f"应按频次降序，实际 {sigs}"
