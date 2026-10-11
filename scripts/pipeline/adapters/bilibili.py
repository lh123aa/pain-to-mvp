#!/usr/bin/env python3
"""
B站适配器。优先用 bilibili-API-collect 的思路直接调用 API。
依赖：requests。Cookie（SESSDATA）可选，从环境变量 BILI_SESSDATA 读。
"""
import os
import time
import requests
from typing import List, Dict, Any
from .base import BaseAdapter
from ..compliance import RateLimiter, anonymize

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

class BilibiliAdapter(BaseAdapter):
    platform = "bilibili"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": UA})
        sess = os.getenv("BILI_SESSDATA")
        if sess:
            self.session.cookies.set("SESSDATA", sess, domain=".bilibili.com")
        self.limiter = RateLimiter(1.0)

    def is_available(self):
        return True

    def discover(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        """搜索视频"""
        url = "https://api.bilibili.com/x/web-interface/search/type"
        params = {"search_type": "video", "keyword": keyword, "page": 1}
        self.limiter.wait()
        try:
            r = self.session.get(url, params=params, timeout=15)
            data = r.json()
        except Exception as e:
            raise RuntimeError(f"B站搜索失败：{e}")

        results = []
        for item in (data.get("data", {}).get("result") or [])[:limit]:
            results.append({
                "source_id": str(item.get("aid")),
                "title": item.get("title", "").replace("<em class=\"keyword\">", "").replace("</em>", ""),
                "url": f"https://www.bilibili.com/video/{item.get('bvid')}",
                "author": anonymize(item.get("author")),
                "comment_count": item.get("review", 0),
                "play": item.get("play", 0),
                "platform": self.platform,
            })
        return results

    def crawl_comments(self, source_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        """爬取视频评论（aid）"""
        url = "https://api.bilibili.com/x/v2/reply/main"
        results = []
        page = 1
        while len(results) < limit:
            params = {"type": 1, "oid": source_id, "mode": 3, "next": page}
            self.limiter.wait()
            try:
                r = self.session.get(url, params=params, timeout=15)
                data = r.json()
            except Exception as e:
                raise RuntimeError(f"B站评论失败：{e}")

            replies = data.get("data", {}).get("replies") or []
            if not replies:
                break
            for item in replies:
                results.append({
                    "id": str(item.get("rpid")),
                    "platform": self.platform,
                    "source_id": source_id,
                    "content": item.get("content", {}).get("message", ""),
                    "author": anonymize(item.get("member", {}).get("uname")),
                    "likes": item.get("like", 0),
                    "replies": item.get("rcount", 0),
                    "timestamp": str(item.get("ctime", "")),
                    "url": f"https://www.bilibili.com/video/av{source_id}",
                })
            page += 1
            if len(results) >= limit:
                break
        return results[:limit]
