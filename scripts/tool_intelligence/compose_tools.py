#!/usr/bin/env python3
"""
工具组合：根据任务阶段推荐工具组合。
用法：python compose_tools.py --stage crawl --platform xiaohongshu
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
from pathlib import Path

# 内置组合表（可由 Agent 动态更新）
COMPOSITIONS = {
    ("discover", "xiaohongshu"): ["MediaCrawler", "Spider_XHS"],
    ("discover", "douyin"): ["TikTokDownloader", "MediaCrawler"],
    ("discover", "bilibili"): ["MediaCrawler", "bilibili-API-collect"],
    ("discover", "youtube"): ["yt-dlp"],
    ("discover", "reddit"): ["PRAW"],
    ("discover", "amazon"): ["easy-amazon-voc"],
    ("crawl", "xiaohongshu"): ["MediaCrawler"],
    ("crawl", "douyin"): ["TikTokDownloader"],
    ("crawl", "bilibili"): ["MediaCrawler"],
    ("crawl", "youtube"): ["youtube-comment-downloader"],
    ("crawl", "reddit"): ["PRAW"],
    ("crawl", "amazon"): ["easy-amazon-voc"],
    ("analyze", "*"): ["jieba", "Sentence Transformers", "BERTopic"],
    ("score", "*"): ["scoring-rubric"],
    ("output", "*"): ["card-template"],
}

def compose(stage, platform):
    key = (stage, platform)
    if key in COMPOSITIONS:
        return COMPOSITIONS[key]
    key = (stage, "*")
    if key in COMPOSITIONS:
        return COMPOSITIONS[key]
    return []

def main(stage, platform):
    tools = compose(stage, platform)
    result = {
        "stage": stage,
        "platform": platform,
        "tools": tools
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True)
    parser.add_argument("--platform", default="*")
    args = parser.parse_args()
    main(args.stage, args.platform)
