#!/usr/bin/env python3
"""
工具组合：根据任务阶段推荐工具组合。
用法：python compose_tools.py --stage crawl --platform xiaohongshu
"""
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
