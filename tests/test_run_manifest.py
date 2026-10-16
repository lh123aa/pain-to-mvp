"""OPEN_ISSUES #31 跨轮去重断链：同关键词重跑全部命中已知评论（#20 去重）→
写入 0 新 → 文件 mtime 不变 → collect_raw_files(since=) 为空 → e2e/run_all
误判"未找到评论数据"断链（真实事故：2026-10-16 A4 稳定性第 2 轮）。

修复：crawl 成功抓取后落盘"本轮清单"（.crawl_manifest.json），collect_raw_files
在 since 过滤为空时回退该清单。清单必须新鲜（mtime >= since）且所列文件存在，
陈旧/损坏清单一律拒收——不违反 #3"绝不复用上一轮旧产物"。
"""
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.pipeline.run_inputs import collect_raw_files, write_crawl_manifest


def _old_raw_file(raw_dir: Path, name: str = "bilibili_1.jsonl") -> Path:
    """mtime 在 1 小时前的 raw 文件（since 过滤必然排除）。"""
    f = raw_dir / name
    f.write_text('{"id":"1","platform":"bilibili","source_id":"s1"}\n',
                 encoding="utf-8")
    past = time.time() - 3600
    os.utime(f, (past, past))
    return f


# ---------- write_crawl_manifest + collect 回退 ----------

def test_fresh_manifest_rescues_dedup_rerun(tmp_path):
    """全去重轮：无文件 mtime >= since，但清单新鲜 → 返回清单文件。"""
    f = _old_raw_file(tmp_path)
    write_crawl_manifest(tmp_path, [f])
    got = collect_raw_files(tmp_path, since=time.time() - 60)
    assert [p.name for p in got] == ["bilibili_1.jsonl"]


def test_stale_manifest_from_previous_run_rejected(tmp_path):
    """清单早于本轮 since → 上一轮旧产物，拒收 → 返回 []。"""
    f = _old_raw_file(tmp_path)
    write_crawl_manifest(tmp_path, [f])
    manifest = tmp_path / ".crawl_manifest.json"
    past = time.time() - 3600
    os.utime(manifest, (past, past))
    assert collect_raw_files(tmp_path, since=time.time() - 60) == []


def test_manifest_filters_deleted_files(tmp_path):
    """清单所列文件已被删除 → 过滤；全部失效 → 落回 since 过滤（空）。"""
    f = _old_raw_file(tmp_path)
    write_crawl_manifest(tmp_path, [f, tmp_path / "ghost.jsonl"])
    got = collect_raw_files(tmp_path, since=time.time() - 60)
    assert [p.name for p in got] == ["bilibili_1.jsonl"]

    f.unlink()
    assert collect_raw_files(tmp_path, since=time.time() - 60) == []


def test_corrupt_manifest_falls_back_to_mtime(tmp_path):
    """清单损坏（非 JSON）→ 不炸，落回 mtime 过滤。"""
    (tmp_path / ".crawl_manifest.json").write_text("not json", encoding="utf-8")
    f = _old_raw_file(tmp_path)
    assert collect_raw_files(tmp_path, since=time.time() - 60) == []

    fresh = tmp_path / "bilibili_new.jsonl"
    fresh.write_text('{"id":"2","platform":"bilibili","source_id":"s2"}\n',
                     encoding="utf-8")
    got = collect_raw_files(tmp_path, since=time.time() - 60)
    assert [p.name for p in got] == ["bilibili_new.jsonl"]


def test_fresh_manifest_is_authoritative_scope(tmp_path):
    """清单新鲜时以清单为本轮权威范围：不在清单内的新文件不混入。"""
    listed = _old_raw_file(tmp_path, "bilibili_crawled.jsonl")
    stray = tmp_path / "bilibili_stray.jsonl"
    stray.write_text('{"id":"3","platform":"bilibili","source_id":"s3"}\n',
                     encoding="utf-8")
    write_crawl_manifest(tmp_path, [listed])
    got = collect_raw_files(tmp_path, since=time.time() - 60)
    assert [p.name for p in got] == ["bilibili_crawled.jsonl"]


def test_no_manifest_since_still_filters_by_mtime(tmp_path):
    """无清单 → 行为与旧版一致：只取 mtime >= since。"""
    _old_raw_file(tmp_path, "old.jsonl")
    fresh = tmp_path / "new.jsonl"
    fresh.write_text('{"id":"2","platform":"bilibili","source_id":"s2"}\n',
                     encoding="utf-8")
    got = collect_raw_files(tmp_path, since=time.time() - 60)
    assert [p.name for p in got] == ["new.jsonl"]


# ---------- crawl 接线：清单只记本轮成功视频 ----------

@pytest.fixture
def cc(monkeypatch, tmp_path):
    """crawl_comments 模块 + 全网络桩（preflight/adapter/save_records 落 tmp）。"""
    import crawl_comments as cc_mod

    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    monkeypatch.setattr(cc_mod, "preflight",
                        lambda url, platform: "blocked" not in url)
    monkeypatch.setattr(
        cc_mod, "get_adapter",
        lambda platform: SimpleNamespace(
            is_available=lambda: True,
            crawl_comments=lambda source_id, limit=0: [{"id": f"{source_id}-1"}]))
    monkeypatch.setattr(
        cc_mod, "save_records",
        lambda records, platform, source_id="": (
            (raw_dir / f"{platform}_{source_id or 'all'}.jsonl")
            .write_text("", encoding="utf-8") or 0))
    monkeypatch.setattr(cc_mod, "jsonl_path_for",
                        lambda platform, source_id="": raw_dir / f"{platform}_{source_id or 'all'}.jsonl")
    monkeypatch.setattr(cc_mod, "time", SimpleNamespace(sleep=lambda s: None))
    return cc_mod, raw_dir


def _discovered(tmp_path, items):
    f = tmp_path / "disc.json"
    f.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    return f


def test_crawl_from_file_manifest_lists_only_success(cc, tmp_path):
    """成功视频进清单；robots 禁止的失败视频不进（防旧产物冒充本轮）。"""
    cc_mod, raw_dir = cc
    inp = _discovered(tmp_path, [
        {"platform": "bilibili", "source_id": "vidOK",
         "url": "https://www.bilibili.com/video/BVok", "title": "ok"},
        {"platform": "bilibili", "source_id": "vidBLOCK",
         "url": "https://blocked.example/x", "title": "blocked"},
    ])
    cc_mod.crawl_from_file(inp, 5)

    manifest = raw_dir / ".crawl_manifest.json"
    assert manifest.exists(), "crawl 完成后必须落盘本轮清单（#31）"
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    names = [Path(p).name for p in payload["files"]]
    assert names == ["bilibili_vidOK.jsonl"]


def test_crawl_one_returns_none_when_preflight_blocks(cc):
    """robots 禁止 = 未抓取成功 → None（清单只记成功；len() 不再吃掉失败）。"""
    cc_mod, _ = cc
    assert cc_mod.crawl_one("bilibili", "x", "https://blocked.example/x", 5) is None


def test_crawl_one_returns_none_on_adapter_failure(cc, monkeypatch):
    """适配器异常 = 抓取失败 → None（不进清单，落回 since 过滤诚实断链）。"""
    cc_mod, _ = cc
    monkeypatch.setattr(
        cc_mod, "get_adapter",
        lambda platform: SimpleNamespace(is_available=lambda: False))
    assert cc_mod.crawl_one("bilibili", "x", "https://ok.example/x", 5) is None


def test_crawl_all_failed_writes_no_manifest(cc, tmp_path, monkeypatch):
    """全失败轮：不落清单（陈旧清单会被新鲜度拒收）→ 下游诚实断链。"""
    cc_mod, raw_dir = cc
    monkeypatch.setattr(cc_mod, "preflight", lambda url, platform: False)
    inp = _discovered(tmp_path, [
        {"platform": "bilibili", "source_id": "vidA",
         "url": "https://www.bilibili.com/video/BVa", "title": "a"},
    ])
    cc_mod.crawl_from_file(inp, 5)
    assert not (raw_dir / ".crawl_manifest.json").exists()
    assert collect_raw_files(raw_dir, since=time.time() - 60) == []
