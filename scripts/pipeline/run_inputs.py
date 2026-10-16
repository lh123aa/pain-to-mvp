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

# crawl 每轮落盘的"本轮成功清单"文件名（OPEN_ISSUES #31）
CRAWL_MANIFEST = ".crawl_manifest.json"


def write_crawl_manifest(raw_dir: Path, files: Sequence[Path]) -> None:
    """落盘本轮 crawl 成功抓取的 raw 文件清单（OPEN_ISSUES #31）。

    背景：跨轮去重（#20）后，同关键词重跑全部命中已知评论 → 写入 0 新 →
    文件 mtime 不变 → collect_raw_files(since=) 为空 → 链路误判"未找到
    评论数据"断链（真实事故：2026-10-16 A4 稳定性第 2 轮）。清单只记
    成功抓取的视频（失败/robots 禁止不进清单），供下游识别本轮范围。
    """
    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    resolved = [str(Path(f).resolve()) for f in files]
    payload = {"files": resolved, "count": len(resolved)}
    (raw_dir / CRAWL_MANIFEST).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def collect_raw_files(raw_dir: Path, since: Optional[float] = None) -> list:
    """按 mtime 升序返回 raw 目录下全部 .jsonl；since 给定则只取该时刻之后修改的。

    since 给定且存在本轮 crawl 清单（#31）时清单优先：跨轮全去重（写入 0 新）
    的文件 mtime 不变，清单才是"本轮范围"的权威来源。清单必须新鲜
    （mtime >= since）且所列文件存在——陈旧/损坏清单一律拒收，绝不让
    上一轮旧产物冒充本轮（#3 复用禁令不受影响）。
    """
    raw_dir = Path(raw_dir)
    if not raw_dir.exists():
        return []
    if since is not None:
        manifest = raw_dir / CRAWL_MANIFEST
        if manifest.exists() and manifest.stat().st_mtime >= since:
            try:
                data = json.loads(manifest.read_text(encoding="utf-8"))
                listed = data.get("files") or []
            except (json.JSONDecodeError, OSError, AttributeError, UnicodeDecodeError):
                listed = []
            listed = sorted(
                (p for p in (Path(x) for x in listed) if p.exists()),
                key=lambda p: p.stat().st_mtime)
            if listed:
                print(f"🔁 命中本轮 crawl 清单（跨轮去重场景）：{len(listed)} 个 raw 文件")
                return listed
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
