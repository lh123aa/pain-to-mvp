"""mine 单文件输入坏行保护（OPEN_ISSUES #2）：与 merge_jsonl_records 行为一致。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from mine_pain_points import _load_input


def test_single_file_skips_bad_lines(tmp_path, capsys):
    f = tmp_path / "comments.jsonl"
    f.write_text(
        '{"id":"1","platform":"p","source_id":"s","content":"好内容"}\n'
        "这不是 JSON{{{垃圾行\n"
        '{"id":"2","platform":"p","source_id":"s","content":"又一条"}\n',
        encoding="utf-8")
    result = _load_input(input_file=f)  # 当前 RED: JSONDecodeError
    assert len(result) == 2
    assert {r["id"] for r in result} == {"1", "2"}
    out = capsys.readouterr().out
    assert "坏行" in out and "1" in out  # 跳过数量可见


def test_single_file_all_bad_returns_empty_not_crash(tmp_path):
    f = tmp_path / "all_bad.jsonl"
    f.write_text("garbage\ngarbage2\n", encoding="utf-8")
    assert _load_input(input_file=f) == []
