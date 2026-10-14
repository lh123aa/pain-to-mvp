# -*- coding: utf-8 -*-
"""T7：痛点一句话摘要 pain_summary —— 让最终结果直接可读、有价值。"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPE = ROOT / "scripts" / "pipeline"
sys.path.insert(0, str(PIPE))

from export_card import _build_card

PAINFUL_LINES = [
    {"content": "独立开发者怎么获客啊？投放太贵了根本烧不起，求一个低成本的渠道推荐", "id": 1},
    {"content": "同问获客渠道，预算有限，投不起信息流广告", "id": 2},
    {"content": "获客太难了，我试了好几个渠道都没效果，成本高得离谱", "id": 3},
    {"content": "冷启动完全没有流量，买量成本太高撑不住，求推荐低成本获客方式", "id": 4},
    {"content": "做独立开发最难的就是获客，广告费烧不起又没有别的路子", "id": 5},
    {"content": "用户获取成本越来越高，小团队根本负担不起投放预算", "id": 6},
]


def _mine(tmp: Path):
    inp = tmp / "comments.jsonl"
    inp.write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in PAINFUL_LINES), encoding="utf-8")
    out = tmp / "pains.json"
    r = subprocess.run(
        [sys.executable, str(PIPE / "mine_pain_points.py"), "--input", str(inp),
         "--output", str(out), "--min-pain", "1", "--min-cluster", "2"],
        capture_output=True, text=True, cwd=str(ROOT), timeout=120,
    )
    assert r.returncode == 0, r.stderr[-500:]
    return json.loads(out.read_text(encoding="utf-8"))


def test_pain_summary_present_and_useful():
    with tempfile.TemporaryDirectory() as td:
        pains = _mine(Path(td))
    assert pains, "应产出痛点"
    p = pains[0]
    assert p.get("pain_summary"), "每个痛点必须有 pain_summary"
    summary = p["pain_summary"]
    assert p["size"] and str(p["size"]) in summary, "摘要应包含规模数字"
    assert p["representative_quotes"] and p["representative_quotes"][0][:6] in summary, "摘要应含代表句"


def test_build_card_prefers_pain_summary():
    pain = {
        "pain_summary": "12条评论集中反映「获客成本太高」：投放太贵烧不起",
        "title": "",
        "representative_quotes": ["投放太贵了"],
        "signal_distribution": {},
        "scores": {},
        "mvp": {},
        "total_score": 66,
        "tier": "B",
    }
    card = _build_card(pain, 66, "B")
    assert "12条评论集中反映" in card["description"]


def test_build_card_fallback_title_then_quote():
    base = {"representative_quotes": ["预算有限投不起广告"], "signal_distribution": {}, "scores": {}, "mvp": {}}
    card1 = _build_card(dict(base), 50, "C")
    assert card1["description"] == "预算有限投不起广告"  # 无 summary 时退到标题
    card2 = _build_card({**base, "title": "标题优先"}, 50, "B")
    assert card2["description"] == "标题优先"
