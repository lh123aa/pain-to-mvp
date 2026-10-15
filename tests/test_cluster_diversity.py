# -*- coding: utf-8 -*-
"""簇内多样性校验：同句式玩梗复读簇不得成簇进卡片（OPEN_ISSUES #23）。

背景：min_cluster=3 过松，3 条同句式玩梗（同一条笑话的变体）即可聚成一簇
并进入卡片。修复采用多样性校验而非单纯提阈值——簇内两两 bigram Jaccard
全部 ≥ 0.5 判定为复读簇丢弃；只要存在一对差异明显的真实表达即保留。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "pipeline"))

from cluster import _is_homogeneous_repetition, cluster_comments  # noqa: E402

MEMES = [
    {"content": "笑死，干运维还没用到Python真好笑", "pain_score": 5},
    {"content": "笑死，干运维还没用到Python哈哈真好笑", "pain_score": 5},
    {"content": "笑死，干运维还没用到Python呢真好笑", "pain_score": 5},
]
REAL = [
    {"content": "独立开发者怎么获客啊？投放太贵了根本烧不起，求一个低成本的渠道推荐", "pain_score": 8},
    {"content": "支付流程太复杂，接入第三方手续费也高，个人开发者吃不消", "pain_score": 7},
    {"content": "教程看半天还是不会上架应用商店，审核规则根本不透明", "pain_score": 6},
]


def test_meme_repetition_cluster_dropped():
    """3 条同句式玩梗：两两相似度全部 ≥0.5 → 复读簇，成簇后应被丢弃。"""
    assert _is_homogeneous_repetition(MEMES), "同句式复读应被识别"
    clusters = cluster_comments([dict(c) for c in MEMES], min_size=3)
    # 主路径聚类后复读簇被丢弃（全复读数据 → 无卡片数据）
    for c in clusters:
        assert not _is_homogeneous_repetition(c["members"]), (
            f"复读簇不应进卡片：{c['representative']}")


def test_real_diverse_cluster_kept():
    """真实痛点簇：句式各异，不得被多样性校验误杀。

    min_size=1 隔离变量：只验证多样性校验这一维度，
    避免小样本被 KMeans 拆簇后死于规模门（与 #23 无关）。
    """
    assert not _is_homogeneous_repetition(REAL), "真实多样簇不应被判复读"
    clusters = cluster_comments([dict(c) for c in REAL], min_size=1)
    assert clusters, "真实痛点簇必须保留"
    for c in clusters:
        assert not _is_homogeneous_repetition(c["members"]), (
            f"真实簇被误判复读：{c['representative']}")


def test_mixed_cluster_with_one_distinct_voice_kept():
    """簇内只要有一对差异明显（存在不同声音），即保留不误杀。"""
    mixed = REAL + [dict(m) for m in MEMES[:1]]
    assert not _is_homogeneous_repetition(mixed)


def test_single_member_not_repetition():
    assert not _is_homogeneous_repetition(REAL[:1])
