# -*- coding: utf-8 -*-
"""T10：主题聚焦过滤 —— 多视频混合评论中剔除与目标领域无关的闲聊。"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "pipeline"))

from mine_pain_points import _keep_topics

LINES = [
    {"content": "独立开发者怎么获客啊？投放太贵了根本烧不起，求一个低成本的渠道推荐", "id": 1},
    {"content": "请问up，开发者出海，im软件一般哪些用的比较多？还有就是收款怎么解决？", "id": 2},
    {"content": "做独立开发最难的就是获客，广告费烧不起又没有别的路子", "id": 3},
    {"content": "超市菜价这么贵，菜农为啥不直接把菜送到超市呢", "id": 4},
    {"content": "你怎么不问问工地干活的，为什么不想做包工头", "id": 5},
    {"content": "眼睛不行了 总是渣渣渣", "id": 6},
]


def test_keep_topics_filters_offtopic():
    out = _keep_topics(LINES, topics=["独立开发", "开发者", "获客", "出海"])
    texts = [c["content"] for c in out]
    assert len(out) == 3
    assert all(any(k in t for k in ["独立开发", "开发者", "获客", "出海"]) for t in texts)
    assert "超市菜价" not in "".join(texts)
    assert "包工头" not in "".join(texts)


def test_keep_topics_none_passthrough():
    assert _keep_topics(LINES, topics=None) == LINES


def test_cli_topics_flag(tmp_path):
    inp = tmp_path / "c.jsonl"
    inp.write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in LINES), encoding="utf-8")
    out = tmp_path / "p.json"
    r = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parents[1] / "scripts" / "pipeline" / "mine_pain_points.py"),
         "--input", str(inp), "--output", str(out), "--min-pain", "1", "--min-cluster", "1",
         "--topics", "独立开发", "开发者", "获客", "出海"],
        capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-400:]
    pains = json.loads(out.read_text(encoding="utf-8"))
    blob = json.dumps(pains, ensure_ascii=False)
    assert "超市菜价" not in blob
    assert "包工头" not in blob
