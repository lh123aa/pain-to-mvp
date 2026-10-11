#!/usr/bin/env python3
"""
抖音适配器。委托给 TikTokDownloader（若已安装）。
未安装时抛出明确提示，由上层降级。
"""
import os
import subprocess
import json
from typing import List, Dict, Any
from .base import BaseAdapter
from compliance import anonymize

class DouyinAdapter(BaseAdapter):
    platform = "douyin"

    def is_available(self):
        # 检查 TikTokDownloader 是否存在
        return bool(os.getenv("TIKTOK_DOWNLOADER_PATH"))

    def discover(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        if not self.is_available():
            raise RuntimeError(
                "抖音适配器需要 TikTokDownloader。"
                "请设置环境变量 TIKTOK_DOWNLOADER_PATH 指向 TikTokDownloader 目录，"
                "或改用 MediaCrawler。"
            )
        # 调用 TikTokDownloader CLI 的封装示例（实际命令以项目文档为准）
        cmd = ["python", "main.py", "--mode", "search", "--keyword", keyword, "--limit", str(limit)]
        out = subprocess.run(cmd, cwd=os.getenv("TIKTOK_DOWNLOADER_PATH"),
                             capture_output=True, text=True, timeout=120)
        if out.returncode != 0:
            raise RuntimeError(f"TikTokDownloader 失败：{out.stderr}")
        return json.loads(out.stdout)

    def crawl_comments(self, source_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        if not self.is_available():
            raise RuntimeError("未配置 TIKTOK_DOWNLOADER_PATH")
        cmd = ["python", "main.py", "--mode", "comments", "--aweme_id", source_id, "--limit", str(limit)]
        out = subprocess.run(cmd, cwd=os.getenv("TIKTOK_DOWNLOADER_PATH"),
                             capture_output=True, text=True, timeout=120)
        if out.returncode != 0:
            raise RuntimeError(f"TikTokDownloader 评论失败：{out.stderr}")
        raw = json.loads(out.stdout)
        return [{
            "id": r.get("cid"),
            "platform": self.platform,
            "source_id": source_id,
            "content": r.get("text"),
            "author": anonymize(r.get("user")),
            "likes": r.get("digg_count", 0),
            "replies": r.get("reply_comment_total", 0),
            "timestamp": str(r.get("create_time", "")),
            "url": f"https://www.douyin.com/video/{source_id}",
        } for r in raw]
