# -*- coding: utf-8 -*-
"""P3 清账：#16 fix_run_all marker 换新代码独有文本；#17 mine tag 运算符加括号。

#16：原 marker="import time" 过于通用（任何来源的 import time 都会让 patch
误跳过，掩盖"补丁未真正完成"的状态）。
#17：`platform or Path(input_file).stem if input_file else "all"` 三元优先级
低于 or，实际是 `(platform or stem) if input_file else "all"`——语义无害但
不显式，加括号固定意图并抽 _output_tag 可测。
"""
import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "generators"))

from apply_fixes import fix_run_all  # noqa: E402
from scripts.pipeline.mine_pain_points import _output_tag  # noqa: E402


def test_fix_run_all_marker_is_unique_to_new_code():
    """#16：patch1 的 marker 必须是新代码独有文本，不得是通用 'import time'。"""
    src = (ROOT / "generators" / "apply_fixes.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "fix_run_all")
    markers = [kw.value.value for node in ast.walk(fn)
               if isinstance(node, ast.Call)
               for kw in node.keywords
               if kw.arg == "marker" and isinstance(kw.value, ast.Constant)]
    assert markers, "fix_run_all 应有 marker"
    assert "import time" not in markers, (
        "marker 'import time' 过于通用，应换成新代码独有文本（OPEN_ISSUES #16）")
    # marker 必须是补丁新代码里的独有片段（能真正标识补丁完成）
    run_all_src = (ROOT / "scripts" / "pipeline" / "run_all.py").read_text(encoding="utf-8")
    for m in markers:
        assert m in run_all_src, f"marker {m!r} 必须出现在 run_all.py 中"


def test_output_tag_semantics():
    """#17：tag = (platform or stem) if input_file else 'all' —— 括号固定语义。"""
    assert _output_tag(None, None) == "all"
    assert _output_tag("bilibili", None) == "all", (
        "无 input_file 时保持现状 'all'（语义不变）")
    assert _output_tag(None, "data/raw/bili_s1.jsonl") == "bili_s1"
    assert _output_tag("bilibili", "data/raw/bili_s1.jsonl") == "bilibili", (
        "有 input_file 时 platform 优先于文件名")


def test_mine_file_has_explicit_parens():
    """#17：源码里必须是显式括号形式，防止读代码时误判优先级。"""
    src = (ROOT / "scripts" / "pipeline" / "mine_pain_points.py").read_text(encoding="utf-8")
    assert "_output_tag(" in src, "tag 计算应走 _output_tag 函数"
    assert "platform or Path(input_file).stem if input_file" not in src, (
        "隐式优先级写法应清除")
