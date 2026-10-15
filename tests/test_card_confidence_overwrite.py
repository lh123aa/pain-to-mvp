# -*- coding: utf-8 -*-
"""卡片展示 score_confidence（#26）+ 同日二次跑批不得覆盖（#25）。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from export_card import _build_card, export  # noqa: E402


def _entry(**overrides):
    e = {
        "cluster_id": 0, "size": 10, "avg_pain": 4.0,
        "signal_distribution": {"求助": 6},
        "representative_quotes": ["求一个能自动汇总周报的工具，手写太耗时间了"],
        "total_score": 72.0, "tier": "B",
        "scores": {"demand": 4, "competition": 3, "feasibility": 4,
                   "reach": 2, "ai_leverage": 4},
        "score_confidence": 0.86,
        "mvp": {"recommended_mvp": [{"type": "小工具", "rationale": "r"}],
                "validation_plan": [], "revenue_layers": [], "tech_stack": []},
    }
    e.update(overrides)
    return e


def test_card_shows_score_confidence():
    """score_confidence 已写入数据，卡片必须展示（OPEN_ISSUES #26）。"""
    built = _build_card(_entry(), 72.0, "B")
    assert "样本置信度" in built["content"], "卡片未展示样本置信度"
    assert "0.86" in built["content"], "置信度数值未上卡"


def test_card_confidence_missing_renders_dash():
    built = _build_card(_entry(score_confidence=None), 72.0, "B")
    assert "样本置信度" in built["content"]
    # 缺数据时不得伪造数值：跟维度一样渲染 —
    line = next(l for l in built["content"].splitlines() if "样本置信度" in l)
    assert "—" in line, f"缺置信度应显示 —，实际：{line}"


def test_same_day_second_run_does_not_overwrite(tmp_path, monkeypatch):
    """同日二次跑批：首跑卡片文件必须保留，id 不得重复（OPEN_ISSUES #25）。"""
    monkeypatch.chdir(tmp_path)
    src = tmp_path / "scored.json"
    first = [_entry(size=10, total_score=70.0)]
    second = [_entry(size=20, total_score=80.0,
                     representative_quotes=["另一批：求个便宜的海报模板合集站"])]
    src.write_text(json.dumps(first, ensure_ascii=False), encoding="utf-8")
    run1 = export(str(src), top=1)
    p1 = tmp_path / "data" / "cards" / f"{run1[0]['id']}.md"
    content_run1 = p1.read_text(encoding="utf-8")

    src.write_text(json.dumps(second, ensure_ascii=False), encoding="utf-8")
    run2 = export(str(src), top=1)
    p2 = tmp_path / "data" / "cards" / f"{run2[0]['id']}.md"

    assert p1.read_text(encoding="utf-8") == content_run1, (
        "同日二次跑批覆盖了首跑卡片文件")
    assert run1[0]["id"] != run2[0]["id"], "同日两次跑批 card_id 不得相同"
    assert p1.exists() and p2.exists(), "两跑的卡片文件都应存在"
    files = list((tmp_path / "data" / "cards").glob("*.md"))
    assert len(files) == 2, f"应有 2 张卡片，实际 {len(files)}"
