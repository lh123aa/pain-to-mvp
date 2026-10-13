#!/usr/bin/env python3
"""
合规检查：robots.txt、频率限制、隐私脱敏。
任何爬取前必须调用。
"""
import hashlib
import time
import urllib.robotparser
from urllib.parse import urlparse
from pathlib import Path
from typing import Optional

USER_AGENT = "PainToMVPSkill/5.0 (+https://github.com/pain-to-mvp)"
DEFAULT_DELAY = 1.0  # 秒
_cache = {}

def check_robots(url: str, user_agent: str = USER_AGENT) -> bool:
    """检查 robots.txt 是否允许抓取。结果缓存 1 小时。"""
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    now = time.time()

    if base in _cache:
        rp, ts = _cache[base]
        if now - ts < 3600:
            return rp.can_fetch(user_agent, url)

    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(f"{base}/robots.txt")
    try:
        rp.read()
    except Exception:
        # PRD §4.1：fail-close——读不到 robots.txt 一律拒绝抓取
        rp.disallow_all = True
    _cache[base] = (rp, now)
    return rp.can_fetch(user_agent, url)

def check_terms(platform: str) -> dict:
    """返回平台条款提醒。Agent 需人工确认。"""
    notes = {
        "douyin": "遵守抖音用户协议，只爬公开内容，频率≤1/秒",
        "xiaohongshu": "遵守小红书社区规范，只爬公开笔记",
        "bilibili": "遵守B站用户协议，只爬公开评论",
        "youtube": "遵守 YouTube ToS，不爬私密视频",
        "reddit": "遵守 Reddit API ToS，100 QPM 限制",
        "amazon": "遵守 Amazon ToS，建议用官方 API",
    }
    return {"platform": platform, "note": notes.get(platform, "请自行确认平台条款")}

class RateLimiter:
    """简单频率限制器"""
    def __init__(self, delay: float = DEFAULT_DELAY):
        self.delay = delay
        self.last = 0.0

    def wait(self):
        elapsed = time.time() - self.last
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self.last = time.time()

def anonymize(author: Optional[str]) -> str:
    """作者名脱敏"""
    if not author:
        return "anonymous"
    return "user_" + hashlib.md5(author.encode()).hexdigest()[:8]

def preflight(url: str, platform: str) -> bool:
    """爬取前检查"""
    ok = check_robots(url)
    print(f"🔎 robots.txt: {'允许' if ok else '禁止'} — {url}")
    terms = check_terms(platform)
    print(f"📜 条款提醒：{terms['note']}")
    return ok
