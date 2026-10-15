# -*- coding: utf-8 -*-
"""T6：聚类噪音过滤（标签串 / 灌水短句不进痛点簇）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "pipeline"))

from cluster import _is_noise, _select_representative, cluster_comments

# 验收样本：来自 data 真实评论
TAG_LIST = "独立开发，知识付费，跨境电商，差异化，独立开发出海"
JOKE = "哈哈哈哈哈哈哈哈"
REAL_HELP = "独立开发者怎么获客啊？投放太贵了根本烧不起，求一个低成本的渠道推荐"


def test_tag_list_is_noise():
    assert _is_noise(TAG_LIST)


def test_joke_is_noise():
    assert _is_noise(JOKE)


def test_real_pain_not_noise():
    assert not _is_noise(REAL_HELP)


def test_short_but_meaningful_not_noise():
    # 短但超过 12 字的正常吐槽不应误杀
    assert not _is_noise("价格太贵了学生党买不起")


def test_representative_prefers_clean():
    members = [
        {"clean_content": TAG_LIST, "pain_score": 9},
        {"clean_content": REAL_HELP, "pain_score": 5},
        {"clean_content": "求推荐出海渠道", "pain_score": 3},
    ]
    rep = _select_representative(members)
    assert rep[0] == REAL_HELP
    assert TAG_LIST not in rep


def test_representative_fallback_when_all_noise():
    members = [{"clean_content": TAG_LIST, "pain_score": 9}]
    rep = _select_representative(members)
    assert rep == [TAG_LIST]  # 全噪音时回退，不返回空


def test_representative_excludes_offtopic_outlier():
    """高 pain_score 但与簇主题无关的离群句不应成为代表句（T9：超市菜价问题）。"""
    members = [
        {"clean_content": "超市菜价这么贵，菜农为啥不直接把菜送到超市呢", "pain_score": 13},
        {"clean_content": "独立开发者获客太难了，投放太贵烧不起", "pain_score": 7},
        {"clean_content": "独立开发获客成本太高，小团队烧不起广告", "pain_score": 7},
        {"clean_content": "做独立开发最难的是获客，买量成本太高", "pain_score": 6},
    ]
    rep = _select_representative(members, top=2)
    assert "超市菜价这么贵，菜农为啥不直接把菜送到超市呢" not in rep


def test_cluster_end_to_end_excludes_noise():
    comments = [
        {"clean_content": REAL_HELP, "pain_score": 8},
        {"clean_content": "投放太贵烧不起，求低成本渠道", "pain_score": 7},
        {"clean_content": "同问获客渠道，预算有限", "pain_score": 6},
        {"clean_content": TAG_LIST, "pain_score": 9},
        {"clean_content": JOKE, "pain_score": 9},
    ]
    clusters = cluster_comments(comments, min_size=2)
    assert clusters, "应至少产出一个簇"
    for c in clusters:
        for rep in c["representative"]:
            assert rep != TAG_LIST
            assert rep != JOKE
