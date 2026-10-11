#!/usr/bin/env python3
"""
Reddit 适配器。依赖 praw，需环境变量 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET。
"""
import os
from typing import List, Dict, Any
from .base import BaseAdapter
from compliance import anonymize

class RedditAdapter(BaseAdapter):
    platform = "reddit"

    def is_available(self):
        try:
            import praw  # noqa
            return bool(os.getenv("REDDIT_CLIENT_ID"))
        except ImportError:
            return False

    def _client(self):
        import praw
        return praw.Reddit(
            client_id=os.getenv("REDDIT_CLIENT_ID"),
            client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
            user_agent="PainToMVPSkill/5.0",
        )

    def discover(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        if not self.is_available():
            raise RuntimeError("未安装 praw 或未配置 REDDIT_CLIENT_ID")
        reddit = self._client()
        results = []
        for post in reddit.subreddit("all").search(keyword, limit=limit, sort="relevance"):
            results.append({
                "source_id": post.id,
                "title": post.title,
                "url": f"https://reddit.com{post.permalink}",
                "author": anonymize(str(post.author)),
                "comment_count": post.num_comments,
                "score": post.score,
                "platform": self.platform,
            })
        return results

    def crawl_comments(self, source_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        if not self.is_available():
            raise RuntimeError("未安装 praw 或未配置 REDDIT_CLIENT_ID")
        reddit = self._client()
        submission = reddit.submission(id=source_id)
        submission.comments.replace_more(limit=0)
        results = []
        for c in submission.comments.list()[:limit]:
            results.append({
                "id": c.id,
                "platform": self.platform,
                "source_id": source_id,
                "content": c.body,
                "author": anonymize(str(c.author)),
                "likes": c.score,
                "replies": len(c.replies) if hasattr(c, "replies") else 0,
                "timestamp": str(c.created_utc),
                "url": f"https://reddit.com{c.permalink}",
            })
        return results
