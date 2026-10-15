"""export 容错缺失 scores（OPEN_ISSUES #4）+ 评分维度命名空间清理。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from export_card import export
import score_opportunity


def _minimal_entry(**overrides):
    e = {
        "cluster_id": 0, "size": 8, "avg_pain": 4.0,
        "signal_distribution": {"求助": 5},
        "representative_quotes": ["求推荐一个能自动记账的工具，手工记太烦了"],
        "total_score": 66.0, "tier": "B",
        "mvp": {"recommended_mvp": [{"type": "小工具", "rationale": "r"}],
                "validation_plan": [], "revenue_layers": [], "tech_stack": []},
    }
    e.update(overrides)
    return e


def test_export_tolerates_missing_scores(tmp_path, monkeypatch):
    """旧格式条目（无 scores 键）导出不得裸 KeyError（当前 RED: KeyError）"""
    monkeypatch.chdir(tmp_path)
    src = tmp_path / "scored.json"
    src.write_text(json.dumps([_minimal_entry()], ensure_ascii=False), encoding="utf-8")
    cards = export(str(src), top=1)  # 当前 RED: p["scores"] KeyError
    assert cards and cards[0]["scores"] == {}
    md = Path(cards[0]["card_path"]).read_text(encoding="utf-8")
    assert "—" in md  # 缺失维度渲染为占位符而非伪造分


def test_export_renders_partial_scores(tmp_path, monkeypatch):
    """部分维度有值时只渲染有值维度"""
    monkeypatch.chdir(tmp_path)
    src = tmp_path / "scored.json"
    src.write_text(json.dumps(
        [_minimal_entry(scores={"demand": 4, "competition": None,
                                "feasibility": 3, "reach": None, "ai_leverage": None})],
        ensure_ascii=False), encoding="utf-8")
    cards = export(str(src), top=1)
    md = Path(cards[0]["card_path"]).read_text(encoding="utf-8")
    assert "4/5" in md and "3/5" in md


def test_score_exposes_dims_contract():
    """评分维度命名空间：DIMS 五元组取代名存实亡的 WEIGHTS（权重值为死代码）"""
    assert score_opportunity.DIMS == (
        "demand", "competition", "feasibility", "reach", "ai_leverage")
