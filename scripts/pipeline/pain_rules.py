#!/usr/bin/env python3
"""
痛点识别规则引擎。
从评论文本中识别：求助、抱怨、对比、失望、期望。
"""
# --- UTF-8 入口稳定化（fix_utf8.py 自动插入） ---
import os as _os
import sys as _sys

_here = _os.path.dirname(_os.path.abspath(__file__))
for _cand in (_here, _os.path.dirname(_here), _os.path.join(_os.path.dirname(_here), "scripts")):
    if _os.path.isdir(_os.path.join(_cand, "pipeline")) and _cand not in _sys.path:
        _sys.path.insert(0, _cand)
        break
try:
    from pipeline.encoding import ensure_utf8

    ensure_utf8()
except Exception:
    pass
# --- 结束 UTF-8 入口稳定化 ---
import re
from typing import List, Dict

# 痛点信号词表
SIGNALS = {
    "help": {
        "words": ["求", "求助", "怎么", "如何", "有没有人", "谁知道", "请问", "求教", "教教"],
        "weight": 3,
        "label": "求助",
    },
    "complain": {
        "words": ["太难", "好难", "麻烦", "繁琐", "复杂", "坑", "踩坑", "吐槽", "烦"],
        "weight": 4,
        "label": "抱怨",
    },
    "compare": {
        "words": ["不如", "比", "平替", "替代", "对比", "哪个好", "选哪个"],
        "weight": 2,
        "label": "对比",
    },
    "disappoint": {
        "words": ["失望", "后悔", "垃圾", "差", "不行", "没用", "踩雷", "避雷", "浪费"],
        "weight": 5,
        "label": "失望",
    },
    "expect": {
        "words": ["希望", "如果能", "要是", "期待", "建议", "最好有", "需要"],
        "weight": 4,
        "label": "期望",
    },
    "pay": {
        "words": ["多少钱", "价格", "收费", "付费", "贵", "便宜", "免费", "值不值"],
        "weight": 5,
        "label": "付费意愿",
    },
    "why": {
        "words": ["为什么", "为啥", "怎么回", "难道", "是不是"],
        "weight": 3,
        "label": "困惑",
    },
}

def detect_signals(text: str) -> List[Dict]:
    """返回命中的信号列表"""
    hits = []
    for key, spec in SIGNALS.items():
        for w in spec["words"]:
            if w in text:
                hits.append({
                    "type": key,
                    "label": spec["label"],
                    "word": w,
                    "weight": spec["weight"],
                })
                break
    return hits

def pain_score(text: str) -> int:
    """返回文本的痛点强度分（累加命中信号权重）"""
    hits = detect_signals(text)
    return sum(h["weight"] for h in hits)

def filter_painful(comments: List[Dict], min_score: int = 3) -> List[Dict]:
    """过滤出痛点较强的评论，附加信号"""
    result = []
    for c in comments:
        text = c.get("clean_content") or c.get("content") or ""
        hits = detect_signals(text)
        score = sum(h["weight"] for h in hits)
        if score >= min_score:
            c["pain_signals"] = hits
            c["pain_score"] = score
            result.append(c)
    result.sort(key=lambda x: x["pain_score"], reverse=True)
    return result

if __name__ == "__main__":
    import json
    samples = [
        "这个工具太难用了，我找了好久都没找到解决方案",
        "求推荐一个平替，太贵了",
        "哈哈",
        "为什么我的报错啊，太失望了，后悔买",
    ]
    for s in samples:
        print(f"「{s}」 → {pain_score(s)} 分")
