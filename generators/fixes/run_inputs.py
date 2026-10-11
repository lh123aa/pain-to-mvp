#!/usr/bin/env python3
"""run 级输入工具：raw 文件收集、多文件合并去重、输出文件名安全。

背景：阶段之间曾用"取最新的一个文件"传数据，多视频爬取时后面的文件
覆盖前面的，导致大部分评论被静默丢弃。本模块提供全量收集与去重合并。
"""
import json
import re
from pathlib import Path
from typing import Optional, Sequence

_ILLEGAL = re.compile(r'[\\/:*?"<>|]')


def collect_raw_files(raw_dir: Path, since: Optional[float] = None) -> list:
    """按 mtime 升序返回 raw 目录下全部 .jsonl；since 给定则只取该时刻之后修改的。"""
    raw_dir = Path(raw_dir)
    if not raw_dir.exists():
        return []
    files = sorted(raw_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    if since is not None:
        files = [p for p in files if p.stat().st_mtime >= since]
    return files


def merge_jsonl_records(paths: Sequence[Path]) -> list:
    """合并多个 JSONL 文件，按 (platform, source_id, id) 去重；坏行跳过。"""
    seen = set()
    merged = []
    for p in paths:
        for line in Path(p).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            key = (rec.get("platform"), rec.get("source_id"), rec.get("id"))
            if key in seen:
                continue
            seen.add(key)
            merged.append(rec)
    return merged


def safe_filename(name: str, max_len: int = 60) -> str:
    """替换路径非法字符并截断，用于构造输出文件名。"""
    cleaned = _ILLEGAL.sub("_", str(name or "")).strip()
    return cleaned[:max_len] or "unnamed"
