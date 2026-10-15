#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
幂等补丁：给所有入口脚本插入 UTF-8 稳定化引导块。

判定入口：脚本含 `argparse` 或 `if __name__ == "__main__"`。
插入点：第一个模块级 import 行之前。已在文件中的引导块会跳过（幂等）。
重新运行生成器后再次执行本脚本即可恢复修复。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

BOOTSTRAP = '''# --- UTF-8 入口稳定化（fix_utf8.py 自动插入） ---
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
# --- 结束 UTF-8 入口稳定化 ---'''

def is_entry(text: str) -> bool:
    return "argparse" in text or 'if __name__ == "__main__"' in text

def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "ensure_utf8" in text:
        return False
    if not is_entry(text):
        return False
    lines = text.splitlines()
    insert_at = None
    for i, line in enumerate(lines):
        if re.match(r"^(import |from )", line):
            insert_at = i
            break
    if insert_at is None:
        # 没有 import 的入口：放在 shebang/编码注释之后
        insert_at = 0
        for i, line in enumerate(lines):
            if not line.startswith("#") and line.strip():
                insert_at = i
                break
    lines.insert(insert_at, BOOTSTRAP)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return True

def main():
    patched = []
    for path in sorted(ROOT.glob("scripts/**/*.py")):
        if patch_file(path):
            patched.append(path.relative_to(ROOT))
    print(f"🔧 已给 {len(patched)} 个入口脚本插入 UTF-8 稳定化：")
    for p in patched:
        print(f"  - {p}")

if __name__ == "__main__":
    main()
