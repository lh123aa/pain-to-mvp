
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pain-to-MVP 项目生成器 - P2
内容发现 + 评论爬取 + 合规 + 存储
运行：python generate_p2.py
"""
from pathlib import Path

FILES = {}

# ============================================================
# scripts/pipeline/storage.py
# ============================================================
FILES["scripts/pipeline/storage.py"] = r'''#!/usr/bin/env python3
"""
标准存储层：统一 JSONL + SQLite 写入，字段标准化。
所有工具的输出都应经过这里，保证下游可消费。
"""
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterable, Dict, Any

DATA_DIR = Path("data")
DB_PATH = DATA_DIR / "pain_to_mvp.db"
JSONL_DIR = DATA_DIR / "raw"

STANDARD_FIELDS = [
    "id", "platform", "source_id", "source_title", "content",
    "author", "likes", "replies", "timestamp", "url", "extra"
]

def _normalize(record: Dict[str, Any]) -> Dict[str, Any]:
    """把任意工具的字段映射到标准格式"""
    out = {k: record.get(k) for k in STANDARD_FIELDS}
    # 兼容常见字段名
    mapping = {
        "comment_id": "id", "cid": "id", "rpid": "id",
        "text": "content", "body": "content", "reply": "content",
        "nickname": "author", "uname": "author", "user": "author",
        "like_count": "likes", "score": "likes", "digg_count": "likes", "votes": "likes",
        "create_time": "timestamp", "created_utc": "timestamp", "time": "timestamp",
        "reply_count": "replies", "rcount": "replies",
    }
    for src, dst in mapping.items():
        if not out.get(dst) and record.get(src) is not None:
            out[dst] = record[src]
    out["extra"] = {k: v for k, v in record.items() if k not in STANDARD_FIELDS}
    return out

def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            platform TEXT,
            source_id TEXT,
            source_title TEXT,
            content TEXT,
            author TEXT,
            likes INTEGER,
            replies INTEGER,
            timestamp TEXT,
            url TEXT,
            extra TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_platform ON comments(platform)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_source ON comments(source_id)")
    conn.commit()
    return conn

def save_records(records: Iterable[Dict[str, Any]], platform: str, source_id: str = ""):
    """批量写入 JSONL + SQLite，自动去重"""
    JSONL_DIR.mkdir(parents=True, exist_ok=True)
    jsonl_path = JSONL_DIR / f"{platform}_{source_id or 'all'}.jsonl"

    conn = init_db()
    inserted = 0
    skipped = 0

    with open(jsonl_path, "a", encoding="utf-8") as f:
        for r in records:
            norm = _normalize(r)
            norm["platform"] = norm.get("platform") or platform
            if not norm.get("id"):
                skipped += 1
                continue
            try:
                conn.execute(
                    """INSERT OR IGNORE INTO comments
                       (id, platform, source_id, source_title, content, author,
                        likes, replies, timestamp, url, extra)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        norm["id"], norm["platform"], norm.get("source_id") or source_id,
                        norm.get("source_title"), norm.get("content"), norm.get("author"),
                        norm.get("likes") or 0, norm.get("replies") or 0,
                        norm.get("timestamp"), norm.get("url"),
                        json.dumps(norm.get("extra") or {}, ensure_ascii=False)
                    )
                )
                if conn.total_changes:
                    inserted += 1
                f.write(json.dumps(norm, ensure_ascii=False) + "\n")
            except sqlite3.Error:
                skipped += 1

    conn.commit()
    conn.close()
    print(f"💾 写入 {inserted} 条（跳过 {skipped}）→ {jsonl_path}")
    return inserted

def query_comments(platform=None, source_id=None, limit=1000):
    conn = init_db()
    sql = "SELECT * FROM comments WHERE 1=1"
    params = []
    if platform:
        sql += " AND platform=?"; params.append(platform)
    if source_id:
        sql += " AND source_id=?"; params.append(source_id)
    sql += " LIMIT ?"; params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    cols = ["id","platform","source_id","source_title","content","author",
            "likes","replies","timestamp","url","extra","created_at"]
    return [dict(zip(cols, r)) for r in rows]

def stats():
    conn = init_db()
    total = conn.execute("SELECT COUNT(*) FROM comments").fetchone()[0]
    by_platform = conn.execute(
        "SELECT platform, COUNT(*) FROM comments GROUP BY platform"
    ).fetchall()
    conn.close()
    return {"total": total, "by_platform": dict(by_platform)}

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--stats", action="store_true")
    args = p.parse_args()
    if args.stats:
        print(json.dumps(stats(), ensure_ascii=False, indent=2))
'''

# ============================================================
# scripts/pipeline/compliance.py
# ============================================================
FILES["scripts/pipeline/compliance.py"] = r'''#!/usr/bin/env python3
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
        # 读不到 robots.txt，默认允许（保守起见可改为 False）
        rp.allow_all = True
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
'''

# ============================================================
# scripts/pipeline/adapters/base.py
# ============================================================
FILES["scripts/pipeline/adapters/base.py"] = r'''#!/usr/bin/env python3
"""
平台适配器基类。每个平台实现 discover() 和 crawl_comments()。
返回标准格式列表，由 storage.save_records() 写入。
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Any

class BaseAdapter(ABC):
    platform: str = "base"

    @abstractmethod
    def discover(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        """发现候选内容（视频/帖子），返回 [{source_id, title, url, comment_count, ...}]"""
        pass

    @abstractmethod
    def crawl_comments(self, source_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        """爬取评论，返回标准格式"""
        pass

    def is_available(self) -> bool:
        """检查依赖是否安装"""
        return True
'''

# ============================================================
# scripts/pipeline/adapters/bilibili.py
# ============================================================
FILES["scripts/pipeline/adapters/bilibili.py"] = r'''#!/usr/bin/env python3
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
'''

# ============================================================
# scripts/pipeline/adapters/youtube.py
# ============================================================
FILES["scripts/pipeline/adapters/youtube.py"] = r'''#!/usr/bin/env python3
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
'''

# ============================================================
# scripts/pipeline/adapters/reddit.py
# ============================================================
FILES["scripts/pipeline/adapters/reddit.py"] = r'''#!/usr/bin/env python3
"""
Reddit 适配器。依赖 praw，需环境变量 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET。
"""
import os
from typing import List, Dict, Any
from .base import BaseAdapter
from ..compliance import anonymize

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
'''

# ============================================================
# scripts/pipeline/adapters/douyin.py
# ============================================================
FILES["scripts/pipeline/adapters/douyin.py"] = r'''#!/usr/bin/env python3
"""
抖音适配器。委托给 TikTokDownloader（若已安装）。
未安装时抛出明确提示，由上层降级。
"""
import os
import subprocess
import json
from typing import List, Dict, Any
from .base import BaseAdapter
from ..compliance import anonymize

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
'''

# ============================================================
# scripts/pipeline/adapters/xiaohongshu.py
# ============================================================
FILES["scripts/pipeline/adapters/xiaohongshu.py"] = r'''#!/usr/bin/env python3
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
'''

# ============================================================
# scripts/pipeline/adapters/__init__.py
# ============================================================
FILES["scripts/pipeline/adapters/__init__.py"] = r'''from .bilibili import BilibiliAdapter
from .youtube import YouTubeAdapter
from .reddit import RedditAdapter
from .douyin import DouyinAdapter
from .xiaohongshu import XiaohongshuAdapter

ADAPTERS = {
    "bilibili": BilibiliAdapter,
    "youtube": YouTubeAdapter,
    "reddit": RedditAdapter,
    "douyin": DouyinAdapter,
    "xiaohongshu": XiaohongshuAdapter,
}

def get_adapter(platform: str):
    cls = ADAPTERS.get(platform)
    if not cls:
        raise ValueError(f"不支持的平台：{platform}。可选：{list(ADAPTERS.keys())}")
    return cls()
'''

# ============================================================
# scripts/pipeline/discover_content.py
# ============================================================
FILES["scripts/pipeline/discover_content.py"] = r'''#!/usr/bin/env python3
"""
内容发现入口。跨平台搜索候选内容，输出排序列表。
用法：
  python discover_content.py --keyword "独立开发者获客" --platforms bilibili youtube --limit 20
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

from adapters import get_adapter
from compliance import preflight
from pipeline_score import filter_and_rank

OUTPUT_DIR = Path("data/discovered")

def discover(keyword, platforms, limit):
    all_results = []
    for p in platforms:
        print(f"\n🌐 平台：{p}")
        try:
            adapter = get_adapter(p)
            if not adapter.is_available():
                print(f"⚠️ {p} 适配器不可用（依赖未装或未配置）")
                continue
            results = adapter.discover(keyword, limit=limit)
            print(f"✅ 发现 {len(results)} 条候选")
            all_results.extend(results)
        except Exception as e:
            print(f"❌ {p} 失败：{e}")
            # 记录 bug
            try:
                from healing.capture_bug import capture_bug
                capture_bug(phase="Phase 2", tool=p, severity="medium", error=str(e))
            except Exception:
                pass

    ranked = filter_and_rank(all_results)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file = OUTPUT_DIR / f"{keyword}_{datetime.now().strftime('%Y%m%d_%H%M')}.json"
    out_file.write_text(json.dumps(ranked, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n💾 已保存 {len(ranked)} 条 → {out_file}")

    print("\n📊 Top 5 值得爬取：")
    for r in ranked[:5]:
        print(f"  - [{r['platform']}] {r.get('title', '')[:40]} | 评论 {r.get('comment_count', 0)} | 分 {r['_rank_score']}")
    return ranked

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--keyword", required=True)
    p.add_argument("--platforms", nargs="+", default=["bilibili"])
    p.add_argument("--limit", type=int, default=20)
    args = p.parse_args()
    discover(args.keyword, args.platforms, args.limit)
'''

# ============================================================
# scripts/pipeline/pipeline_score.py
# ============================================================
FILES["scripts/pipeline/pipeline_score.py"] = r'''#!/usr/bin/env python3
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
'''

# ============================================================
# scripts/pipeline/crawl_comments.py
# ============================================================
FILES["scripts/pipeline/crawl_comments.py"] = r'''#!/usr/bin/env python3
"""
评论爬取入口。带合规检查 + 降级 + 存储。
用法：
  python crawl_comments.py --input data/discovered/xxx.json --limit 500
  python crawl_comments.py --platform bilibili --source-id BV1xx --limit 500
"""
import argparse
import json
import time
from pathlib import Path

from adapters import get_adapter
from compliance import preflight, RateLimiter
from storage import save_records

FALLBACK_ORDER = {
    "xiaohongshu": ["xiaohongshu", "douyin"],
    "douyin": ["douyin", "xiaohongshu"],
    "bilibili": ["bilibili"],
    "youtube": ["youtube"],
    "reddit": ["reddit"],
}

def crawl_one(platform, source_id, url, limit):
    if not preflight(url, platform):
        print(f"⛔ robots.txt 禁止：{url}")
        return []
    try:
        adapter = get_adapter(platform)
        if not adapter.is_available():
            raise RuntimeError(f"{platform} 适配器不可用")
        comments = adapter.crawl_comments(source_id, limit=limit)
        save_records(comments, platform=platform, source_id=source_id)
        return comments
    except Exception as e:
        print(f"❌ {platform}/{source_id} 失败：{e}")
        try:
            from healing.capture_bug import capture_bug
            capture_bug(phase="Phase 4", tool=platform, severity="medium",
                        error=str(e), context=f"source_id={source_id}")
        except Exception:
            pass
        return []

def crawl_from_file(input_file, limit):
    data = json.loads(Path(input_file).read_text(encoding="utf-8"))
    total = 0
    for item in data:
        platform = item.get("platform")
        source_id = item.get("source_id")
        url = item.get("url", "")
        if not platform or not source_id:
            continue
        print(f"\n🕷️ [{platform}] {item.get('title', '')[:50]}")
        comments = crawl_one(platform, source_id, url, limit)
        total += len(comments)
        # 礼貌延迟
        time.sleep(1.0)
    print(f"\n✅ 共爬取 {total} 条评论")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--input", help="发现结果 JSON 文件")
    p.add_argument("--platform")
    p.add_argument("--source-id")
    p.add_argument("--url", default="")
    p.add_argument("--limit", type=int, default=500)
    args = p.parse_args()

    if args.input:
        crawl_from_file(args.input, args.limit)
    elif args.platform and args.source_id:
        crawl_one(args.platform, args.source_id, args.url or f"https://example.com", args.limit)
    else:
        print("请提供 --input 或 --platform + --source-id")
'''


def generate():
    root = Path.cwd()
    print(f"📁 生成 P2 文件到：{root}\n")
    for rel_path, content in FILES.items():
        p = root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"✅ {rel_path}")

    print("\n🎉 P2 生成完成！")
    print("\n本次生成：")
    print("  - scripts/pipeline/storage.py：标准存储层（JSONL + SQLite）")
    print("  - scripts/pipeline/compliance.py：robots.txt + 频率限制 + 脱敏")
    print("  - scripts/pipeline/pipeline_score.py：内容筛选排序")
    print("  - scripts/pipeline/discover_content.py：跨平台内容发现")
    print("  - scripts/pipeline/crawl_comments.py：评论爬取（带降级）")
    print("  - scripts/pipeline/adapters/：bilibili / youtube / reddit / douyin / xiaohongshu")
    print("\n验证：")
    print("  # B站（无需 key，立即可用）")
    print("  python scripts/pipeline/discover_content.py --keyword '独立开发者' --platforms bilibili --limit 10")
    print("  # 然后爬评论")
    print("  python scripts/pipeline/crawl_comments.py --input data/discovered/xxx.json --limit 200")
    print("  # 查看统计")
    print("  python scripts/pipeline/storage.py --stats")
    print("\n下一步：等待 P3（痛点聚类 + 机会评分）")


if __name__ == "__main__":
    generate()
