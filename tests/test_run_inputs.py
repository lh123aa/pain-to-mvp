"""raw 文件全量合并去重、文件名安全、空输入守卫。"""
from pathlib import Path

from scripts.pipeline.run_inputs import (
    collect_raw_files,
    merge_jsonl_records,
    safe_filename,
)


def test_merge_dedups(tmp_path):
    a = tmp_path / "a.jsonl"
    a.write_text('{"id":"1","platform":"bilibili","source_id":"s1"}\n', encoding="utf-8")
    b = tmp_path / "b.jsonl"
    b.write_text('{"id":"1","platform":"bilibili","source_id":"s1"}\n'
                 '{"id":"2","platform":"bilibili","source_id":"s1"}\n', encoding="utf-8")
    assert len(merge_jsonl_records([a, b])) == 2


def test_collect_raw_files_returns_all(tmp_path):
    for n in ("a.jsonl", "b.jsonl", "c.jsonl"):
        (tmp_path / n).write_text('{"id":"1","platform":"p","source_id":"s"}\n', encoding="utf-8")
    assert len(collect_raw_files(tmp_path)) == 3


def test_collect_raw_files_since_filters_old(tmp_path):
    import os, time
    old = tmp_path / "old.jsonl"
    old.write_text('{"id":"1","platform":"p","source_id":"s"}\n', encoding="utf-8")
    past = time.time() - 3600
    os.utime(old, (past, past))
    new = tmp_path / "new.jsonl"
    new.write_text('{"id":"2","platform":"p","source_id":"s"}\n', encoding="utf-8")
    files = collect_raw_files(tmp_path, since=time.time() - 60)
    assert [f.name for f in files] == ["new.jsonl"]


def test_merge_skips_bad_lines(tmp_path):
    f = tmp_path / "x.jsonl"
    f.write_text('{"id":"1","platform":"p","source_id":"s"}\n'
                 'not json\n\n', encoding="utf-8")
    assert len(merge_jsonl_records([f])) == 1


def test_safe_filename():
    assert safe_filename('a/b:c*d?"<>|') == "a_b_c_d_____"
    assert len(safe_filename("x" * 200)) <= 60


def test_mine_empty_input_returns_empty(tmp_path):
    from scripts.pipeline import mine_pain_points
    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")
    assert mine_pain_points.mine(input_file=str(empty)) == []


def test_mine_cli_inputs_flag_works(tmp_path):
    """CLI 级回归：--inputs 多文件必须真正接通 mine(inputs=...)。"""
    import subprocess
    import sys
    a = tmp_path / "a.jsonl"
    a.write_text('{"id":"1","platform":"p","source_id":"s","content":"太难用了，求推荐平替"}\n',
                 encoding="utf-8")
    b = tmp_path / "b.jsonl"
    b.write_text('{"id":"2","platform":"p","source_id":"s","content":"价格太贵了，有没有免费的"}\n',
                 encoding="utf-8")
    r = subprocess.run(
        [sys.executable, "scripts/pipeline/mine_pain_points.py",
         "--inputs", str(a), str(b), "--min-pain", "3", "--min-cluster", "1"],
        capture_output=True, text=True, timeout=300,
    )
    assert r.returncode == 0, (r.stdout[-500:] + r.stderr[-500:])
    assert "载入 2 条评论" in r.stdout


def test_pipeline_entries_use_inputs_flag():
    """护栏：run_all/e2e 必须接通 --inputs（曾因补丁标记撞车整体回退）。"""
    root = Path(__file__).resolve().parent.parent
    for rel in ("scripts/pipeline/run_all.py", "scripts/e2e_test.py"):
        src = (root / rel).read_text(encoding="utf-8")
        assert '"--inputs"' in src, f"{rel} 未使用 --inputs（多文件合并不生效）"


def test_discover_keyword_with_path_chars(tmp_path, monkeypatch):
    """Review Focus #3：关键词含 / : * 等路径非法字符时不得 traceback，
    必须产出净化后的输出文件（CLI 级回归，单测覆盖不到接线）。

    设计：原实现子进程打真实 B 站 API，v_voucher 风控偶发 fail-close exit 1
    导致测试红（OPEN_ISSUES #22）。改为 in-process：monkeypatch
    get_adapter（dc 模块级引用）+ discover_content.OUTPUT_DIR 到 tmp_path，
    直接调用 discover() 函数。验证 safe_filename 净化 + fail-close 退出码
    语义 + 成功产出路径，不碰网络、CI 可复现。

    注：patch `dc.get_adapter`（函数实际引用的模块级符号）而非 BilibiliAdapter
    类——conftest 把 scripts/pipeline 放 sys.path 最前，`scripts.pipeline.*`
    与 `adapters.*` 是独立模块对象，patch 类会导致 mock 漏打网络路径。
    """
    import json
    from unittest.mock import patch, MagicMock

    import scripts.pipeline.discover_content as dc

    results = [{
        "source_id": "mock-1", "title": "获客增长 mock",
        "url": "https://www.bilibili.com/video/mock", "author": "anon",
        "comment_count": 42, "play": 1000, "platform": "bilibili",
    }]

    fake_adapter = MagicMock()
    fake_adapter.is_available.return_value = True
    fake_adapter.discover.return_value = list(results)

    out_dir = tmp_path / "discovered"
    monkeypatch.setattr(dc, "OUTPUT_DIR", out_dir)
    with patch.object(dc, "get_adapter", return_value=fake_adapter):
        ranked = dc.discover("获客/增长", ["bilibili"], 2)

    assert len(ranked) == 1, "应产出 1 条 mock 结果"
    new_files = list(out_dir.glob("*.json"))
    assert new_files, "应产出发现结果文件"
    produced = new_files[0]
    assert "/" not in produced.name and "获客_增长" in produced.name, \
        f"输出文件名未净化：{produced.name}"
    payload = json.loads(produced.read_text(encoding="utf-8"))
    assert len(payload) == 1, "JSON 应含 1 条记录"
    assert payload[0]["_rank_score"] > 0, "rank_score 应 > 0"

    # 额外守卫：fail-close 路径（discover 返回空）必须 exit 非 0
    fake_adapter.discover.return_value = []
    out_dir2 = tmp_path / "discovered2"
    monkeypatch.setattr(dc, "OUTPUT_DIR", out_dir2)
    with patch.object(dc, "get_adapter", return_value=fake_adapter):
        try:
            dc.discover("获客/增长", ["bilibili"], 2)
            raised = False
        except SystemExit as e:
            raised = True
            assert e.code != 0, f"fail-close 必须退出非 0，got {e.code}"
    assert raised, "空结果必须 SystemExit"
