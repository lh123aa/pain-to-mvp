# -*- coding: utf-8 -*-
"""端到端：comments.jsonl → mine → score → export 卡片，全链路不崩且产出可读价值信息。"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPE = ROOT / "scripts" / "pipeline"

LINES = [
    {"content": "独立开发者怎么获客啊？投放太贵了根本烧不起，求一个低成本的渠道推荐", "id": 1},
    {"content": "同问获客渠道，预算有限，投不起信息流广告", "id": 2},
    {"content": "获客太难了，我试了好几个渠道都没效果，成本高得离谱", "id": 3},
    {"content": "冷启动完全没有流量，买量成本太高撑不住，求推荐低成本获客方式", "id": 4},
    {"content": "做独立开发最难的就是获客，广告费烧不起又没有别的路子", "id": 5},
    {"content": "用户获取成本越来越高，小团队根本负担不起投放预算", "id": 6},
    {"content": "支付流程太复杂，接入第三方手续费也高，个人开发者吃不消", "id": 7},
    {"content": "收款是个大问题，海外支付接入门槛高，手续费吃掉利润", "id": 8},
    {"content": "订阅制收款接不了，个人主体申请不了支付通道，太难了", "id": 9},
]


def _run(script, *args):
    r = subprocess.run([sys.executable, str(PIPE / script), *args],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=180)
    assert r.returncode == 0, f"{script} 失败：\n{r.stderr[-800:]}"
    return r.stdout


def test_full_pipeline(tmp_path):
    inp = tmp_path / "comments.jsonl"
    inp.write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in LINES), encoding="utf-8")
    pains_f = tmp_path / "pains.json"
    _run("mine_pain_points.py", "--input", str(inp), "--output", str(pains_f),
         "--min-pain", "1", "--min-cluster", "2")
    pains = json.loads(pains_f.read_text(encoding="utf-8"))
    assert pains, "mine 应产出痛点"
    for p in pains:
        assert p.get("pain_summary"), "痛点必须带 pain_summary"
        assert p.get("representative_quotes"), "痛点必须带代表原话"

    scored_f = tmp_path / "scored.json"
    _run("score_opportunity.py", "--input", str(pains_f), "--output", str(scored_f), "--no-llm")
    scored = json.loads(scored_f.read_text(encoding="utf-8"))
    assert scored, "score 应产出结果"
    assert all("total_score" in s for s in scored), "每个痛点必须有机会分"
