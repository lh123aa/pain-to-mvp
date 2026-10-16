#!/usr/bin/env python3
"""
评论爬取入口。带合规检查 + 降级 + 存储。
用法：
  python crawl_comments.py --input data/discovered/xxx.json --limit 500
  python crawl_comments.py --platform bilibili --source-id BV1xx --limit 500
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
import argparse
import json
import time
from pathlib import Path

from adapters import get_adapter
from compliance import preflight, RateLimiter
from run_inputs import write_crawl_manifest
from storage import jsonl_path_for, save_records

FALLBACK_ORDER = {
    "xiaohongshu": ["xiaohongshu", "douyin"],
    "douyin": ["douyin", "xiaohongshu"],
    "bilibili": ["bilibili"],
    "youtube": ["youtube"],
    "reddit": ["reddit"],
}

def crawl_one(platform, source_id, url, limit):
    """返回评论列表；robots 禁止/异常 → None（失败不进 crawl 清单，#31）。"""
    if not preflight(url, platform):
        print(f"⛔ robots.txt 禁止：{url}")
        return None  # 未抓取成功：不进清单（#31）
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
        return None  # 抓取异常：不进清单（#31）

def crawl_from_file(input_file, limit):
    data = json.loads(Path(input_file).read_text(encoding="utf-8"))
    total = 0
    crawled_paths = []  # 本轮成功抓取的 raw 文件（清单只记成功视频，#31）
    for item in data:
        platform = item.get("platform")
        source_id = item.get("source_id")
        url = item.get("url", "")
        if not platform or not source_id:
            continue
        print(f"\n🕷️ [{platform}] {item.get('title', '')[:50]}")
        comments = crawl_one(platform, source_id, url, limit)
        if comments is not None:
            total += len(comments)
            crawled_paths.append(jsonl_path_for(platform, source_id))
        # 礼貌延迟
        time.sleep(1.0)
    if crawled_paths:
        # 跨轮全去重（写入 0 新）时 mtime 不变，下游靠本清单识别"本轮范围"（#31）
        write_crawl_manifest(crawled_paths[0].parent, crawled_paths)
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
