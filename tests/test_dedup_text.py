# -*- coding: utf-8 -*-
"""T9：文本级去重 —— 同一评论在多个视频下重复出现不应虚增簇规模。"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "pipeline"))

from mine_pain_points import _dedup_by_text

BASE = "独立开发者怎么获客啊？投放太贵了根本烧不起，求一个低成本的渠道推荐"


def _c(i, sid, text=BASE):
    return {"id": i, "platform": "bilibili", "source_id": sid, "content": text}


def test_same_text_different_source_deduped():
    comments = [_c(1, "v1"), _c(2, "v1"), _c(3, "v2"), _c(4, "v3")]
    out = _dedup_by_text(comments)
    assert len(out) == 1
    assert out[0]["id"] == 1  # 保留首条，evidence 可溯源


def test_different_text_kept():
    comments = [
        _c(1, "v1"),
        _c(2, "v1", "支付流程太复杂，接入第三方手续费也高，个人开发者吃不消"),
    ]
    assert len(_dedup_by_text(comments)) == 2


def test_whitespace_variant_deduped():
    comments = [_c(1, "v1"), _c(2, "v2", "  " + BASE + "  ")]
    assert len(_dedup_by_text(comments)) == 1
