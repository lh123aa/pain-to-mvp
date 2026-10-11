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
