#!/usr/bin/env python3
"""内容筛选与排序：按评论量、时效、相关性打分。"""
from datetime import datetime, timedelta
from typing import List, Dict

def rank_score(item: Dict) -> float:
    score = 0.0
    # 评论量
    cc = item.get("comment_count", 0) or 0
    score += min(50, cc / 10)
    # 播放/点赞
    score += min(20, (item.get("play") or item.get("score") or 0) / 1000)
    # 时效（越新越高）
    ts = item.get("timestamp")
    if ts:
        try:
            if isinstance(ts, (int, float)):
                dt = datetime.fromtimestamp(ts)
            else:
                dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            days = (datetime.now(dt.tzinfo) - dt).days if dt.tzinfo else (datetime.now() - dt).days
            score += max(0, 30 - days / 10)
        except Exception:
            score += 10
    return round(score, 2)

def filter_and_rank(items: List[Dict], min_comments: int = 0) -> List[Dict]:
    filtered = []
    seen = set()
    for it in items:
        key = (it.get("platform"), it.get("source_id"))
        if key in seen:
            continue
        seen.add(key)
        if (it.get("comment_count") or 0) < min_comments:
            continue
        it["_rank_score"] = rank_score(it)
        filtered.append(it)
    filtered.sort(key=lambda x: x["_rank_score"], reverse=True)
    return filtered
