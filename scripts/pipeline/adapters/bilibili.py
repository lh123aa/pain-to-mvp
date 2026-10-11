
#!/usr/bin/env python3
"""
B站适配器：直接调用 API，所有请求带 WBI 签名（2023 年后 B站强制要求，
否则返回 -403/风控码）。Cookie（SESSDATA）可选，从环境变量 BILI_SESSDATA 读。
依赖：requests。
"""
import os
import requests
from typing import List, Dict, Any

from .base import BaseAdapter
from compliance import RateLimiter, anonymize
from wbi import enc_wbi, NAV_URL

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

SEARCH_URL = "https://api.bilibili.com/x/web-interface/wbi/search/type"
REPLY_URL = "https://api.bilibili.com/x/v2/reply/main"


class BilibiliAdapter(BaseAdapter):
    platform = "bilibili"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": UA})
        sess = os.getenv("BILI_SESSDATA")
        if sess:
            self.session.cookies.set("SESSDATA", sess, domain=".bilibili.com")
        self.limiter = RateLimiter(1.0)
        self._img_key = None
        self._sub_key = None

    def is_available(self):
        return True

    def _wbi_keys(self):
        """获取 WBI 签名用的 img_key/sub_key（内存缓存）。"""
        if self._img_key and self._sub_key:
            return self._img_key, self._sub_key
        try:
            r = self.session.get(NAV_URL, timeout=15)
            wbi_img = r.json().get("data", {}).get("wbi_img", {})
        except Exception as e:
            raise RuntimeError(f"B站 WBI keys 获取失败：{e}")
        img = wbi_img.get("img_url", "").rsplit("/", 1)[-1].split(".")[0]
        sub = wbi_img.get("sub_url", "").rsplit("/", 1)[-1].split(".")[0]
        if not img or not sub:
            raise RuntimeError("B站 WBI keys 解析失败")
        self._img_key, self._sub_key = img, sub
        return img, sub

    def _get(self, url: str, params: dict) -> dict:
        """带 WBI 签名请求；B站 HTTP 200 也可能带业务错误码，统一检查。"""
        img, sub = self._wbi_keys()
        self.limiter.wait()
        try:
            r = self.session.get(url, params=enc_wbi(params, img, sub), timeout=15)
            data = r.json()
        except Exception as e:
            raise RuntimeError(f"B站请求失败：{e}")
        code = data.get("code", 0)
        if code != 0:
            raise RuntimeError(f"B站接口返回错误码 {code}：{data.get('message', '')}")
        return data

    def discover(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        """搜索视频（WBI 签名端点）"""
        data = self._get(SEARCH_URL,
                         {"search_type": "video", "keyword": keyword, "page": 1})
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
        """爬取视频评论（aid）：WBI 签名 + 游标分页（next 取 data.cursor.next）。"""
        results = []
        cursor = 0
        while len(results) < limit:
            data = self._get(REPLY_URL, {
                "type": 1, "oid": source_id, "mode": 3, "ps": 20, "next": cursor,
            })
            page = data.get("data", {})
            replies = page.get("replies") or []
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
            cursor = (page.get("cursor") or {}).get("next", 0)
            if not cursor:
                break
        return results[:limit]
