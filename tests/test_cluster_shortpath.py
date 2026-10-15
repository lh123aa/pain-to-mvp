# -*- coding: utf-8 -*-
"""短路径回归：痛点数 < min_cluster 或全噪音时，簇字段必须齐全。

真实事故（2026-10-14 18:31 run_all EXIT=1）：
爬到的痛点评论只有 1~2 条时，cluster_comments 走「不足 min_size」短路径，
返回的簇缺 total_pain/avg_pain/method，mine_pain_points.py:131-132 无条件
读 c["avg_pain"] → KeyError → 整条 run_all 崩。小数据量必现。
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from cluster import cluster_comments  # noqa: E402

REQUIRED = ("cluster_id", "size", "members", "representative",
            "total_pain", "avg_pain", "method")


def test_under_min_size_cluster_has_all_required_fields():
    """痛点数 < min_size 时（短路径），簇字段必须与主路径一致。"""
    rows = [{"content": "为什么这么贵，太坑了", "pain_score": 8,
             "clean_content": "为什么这么贵，太坑了"}]
    out = cluster_comments(rows, min_size=3)
    assert len(out) == 1, "不足 min_size 时应聚成单簇保留，而非丢弃"
    c = out[0]
    missing = [k for k in REQUIRED if k not in c]
    assert not missing, f"短路径簇缺字段 {missing} → mine 会 KeyError"
    assert c["total_pain"] == 8
    assert c["avg_pain"] == 8.0
    assert c["method"], "method 必须有值（报告要展示聚类方式）"


def test_all_noise_cluster_has_all_required_fields():
    """全噪音路径（T6 噪音过滤后无可用成员）同样必须字段齐全。"""
    # 长度 > min_size 以通过第一道门，但全是噪音（标签串）
    rows = [{"content": "标签一,标签二,标签三,标签四", "pain_score": 0,
             "clean_content": "标签一,标签二,标签三,标签四"}] * 5
    out = cluster_comments(rows, min_size=3)
    assert len(out) == 1, "全噪音应兜底保留单簇"
    missing = [k for k in REQUIRED if k not in out[0]]
    assert not missing, f"全噪音簇缺字段 {missing}"


def test_mine_survives_when_painful_below_min_cluster(tmp_path):
    """端到端复现真实事故：痛点数不足时 mine 必须正常退出（不 KeyError）。"""
    raw = tmp_path / "raw.jsonl"
    raw.write_text(
        '{"content": "为什么这么贵，太坑了，失望"}\n'      # 高分 → 进 painful
        '{"content": "价格太离谱了还不给退"}\n',           # 高分 → 进 painful
        encoding="utf-8")
    out = tmp_path / "pains.json"

    r = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "pipeline" / "mine_pain_points.py"),
         "--inputs", str(raw), "--output", str(out)],
        capture_output=True, text=True, cwd=str(ROOT), timeout=180)
    assert r.returncode == 0, f"mine 崩了：{(r.stderr or '')[-500:]}"
    assert "avg_pain" not in (r.stderr or ""), "不得再出现 avg_pain KeyError"
    assert out.exists(), "必须产出 pains 文件"
