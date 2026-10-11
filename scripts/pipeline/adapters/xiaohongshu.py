#!/usr/bin/env python3
"""
小红书适配器。委托给 MediaCrawler（若已安装）。
"""
import os
import subprocess
import json
from typing import List, Dict, Any
from .base import BaseAdapter
from ..compliance import anonymize

class XiaohongshuAdapter(BaseAdapter):
    platform = "xiaohongshu"

    def is_available(self):
        return bool(os.getenv("MEDIACRAWLER_PATH"))

    def _run(self, mode: str, **kwargs):
        path = os.getenv("MEDIACRAWLER_PATH")
        if not path:
            raise RuntimeError(
                "小红书适配器需要 MediaCrawler。"
                "请设置环境变量 MEDIACRAWLER_PATH 指向 MediaCrawler 目录。"
            )
        cmd = ["python", "main.py", "--platform", "xhs", "--mode", mode]
        for k, v in kwargs.items():
            cmd.extend([f"--{k}", str(v)])
        out = subprocess.run(cmd, cwd=path, capture_output=True, text=True, timeout=300)
        if out.returncode != 0:
            raise RuntimeError(f"MediaCrawler 失败：{out.stderr}")
        # MediaCrawler 通常写文件，这里假设它输出 JSON 行
        return [json.loads(line) for line in out.stdout.splitlines() if line.strip()]

    def discover(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        raw = self._run("search", keyword=keyword, limit=limit)
        return [{
            "source_id": r.get("note_id"),
            "title": r.get("title"),
            "url": r.get("note_url"),
            "author": anonymize(r.get("nickname")),
            "comment_count": r.get("comment_count", 0),
            "likes": r.get("liked_count", 0),
            "platform": self.platform,
        } for r in raw]

    def crawl_comments(self, source_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        raw = self._run("detail", note_id=source_id, limit=limit)
        comments = []
        for r in raw:
            for c in r.get("comments", []):
                comments.append({
                    "id": c.get("comment_id"),
                    "platform": self.platform,
                    "source_id": source_id,
                    "content": c.get("content"),
                    "author": anonymize(c.get("nickname")),
                    "likes": c.get("like_count", 0),
                    "replies": len(c.get("sub_comments", [])),
                    "timestamp": str(c.get("create_time", "")),
                    "url": f"https://www.xiaohongshu.com/explore/{source_id}",
                })
        return comments[:limit]
