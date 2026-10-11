#!/usr/bin/env python3
"""
YouTube 适配器。优先 youtube-comment-downloader（无需 API key）。
依赖：pip install youtube-comment-downloader yt-dlp
"""
from typing import List, Dict, Any
from .base import BaseAdapter
from ..compliance import anonymize

class YouTubeAdapter(BaseAdapter):
    platform = "youtube"

    def is_available(self):
        try:
            import yt_dlp  # noqa
            return True
        except ImportError:
            return False

    def discover(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        if not self.is_available():
            raise RuntimeError("未安装 yt-dlp。运行：pip install yt-dlp")
        import yt_dlp
        opts = {"quiet": True, "extract_flat": True, "skip_download": True}
        results = []
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{keyword}", download=False)
            for entry in info.get("entries", []):
                if not entry:
                    continue
                results.append({
                    "source_id": entry.get("id"),
                    "title": entry.get("title"),
                    "url": f"https://www.youtube.com/watch?v={entry.get('id')}",
                    "author": anonymize(entry.get("uploader")),
                    "comment_count": entry.get("comment_count") or 0,
                    "platform": self.platform,
                })
        return results

    def crawl_comments(self, source_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        if not self.is_available():
            raise RuntimeError("未安装 yt-dlp")
        try:
            from youtube_comment_downloader import YoutubeCommentDownloader
        except ImportError:
            raise RuntimeError("未安装 youtube-comment-downloader。运行：pip install youtube-comment-downloader")

        downloader = YoutubeCommentDownloader()
        url = f"https://www.youtube.com/watch?v={source_id}"
        results = []
        for i, c in enumerate(downloader.get_comments(source_id)):
            if i >= limit:
                break
            results.append({
                "id": c.get("cid"),
                "platform": self.platform,
                "source_id": source_id,
                "content": c.get("text"),
                "author": anonymize(c.get("author")),
                "likes": c.get("votes") or 0,
                "replies": c.get("reply_count") or 0,
                "timestamp": c.get("time"),
                "url": url,
            })
        return results
