# -*- coding: utf-8 -*-
"""T8：小簇置信惩罚 —— 3 条评论的簇不应与 200 条的簇同分同档。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "pipeline"))

from score_opportunity import _confidence_factor, _compose_total


def _pain(size):
    return {"size": size, "avg_pain": 4.0, "signal_distribution": {"付费意愿": 2}}


def _total(size, scores=None):
    s = scores or {"demand": 4, "competition": 4, "feasibility": 4, "reach": 4, "ai_leverage": 4}
    raw = _compose_total(s)
    return round(raw * _confidence_factor(size), 1)


def test_small_cluster_penalized():
    assert _total(200) == 80.0          # 惩罚系数 1.0，原始分
    assert _total(3) < _total(200)      # 小簇必须降分


def test_factor_bounded():
    assert _confidence_factor(3) >= 0.6   # 下限保护，不归零
    assert _confidence_factor(2000) == 1.0  # 大簇不加成


def test_factor_monotonic():
    vals = [_confidence_factor(s) for s in (3, 10, 20, 30, 40)]
    assert vals == sorted(vals), "规模越大置信度不应下降"


def test_score_records_confidence():
    # score() 应把置信系数写进结果，让下游可解释
    import json
    import tempfile
    from score_opportunity import score
    pains = [_pain(3), _pain(100)]
    for p in pains:
        p["representative_quotes"] = ["测试原话"]
        p["pain_summary"] = "测试摘要"
        p["cluster_id"] = 0
        p["total_pain"] = 10
        p["signal_distribution"] = {}
    with tempfile.TemporaryDirectory() as td:
        inp = Path(td) / "p.json"; out = Path(td) / "s.json"
        inp.write_text(json.dumps(pains, ensure_ascii=False), encoding="utf-8")
        res = score(str(inp), str(out), use_llm=False)
    assert all("score_confidence" in r for r in res)
    by_size = {r["size"]: r for r in res}
    assert by_size[100]["total_score"] > by_size[3]["total_score"]
