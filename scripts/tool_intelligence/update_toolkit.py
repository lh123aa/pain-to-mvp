#!/usr/bin/env python3
"""
工具库更新：把评估后的工具合并进 tool-landscape.md。
用法：python update_toolkit.py --eval data/tool_eval.json
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
from datetime import datetime
from pathlib import Path

LANDSCAPE = Path("references/tool-landscape.md")

def update(eval_file):
    with open(eval_file, "r", encoding="utf-8") as f:
        tools = json.load(f)

    if not LANDSCAPE.exists():
        print(f"⚠️ 未找到 {LANDSCAPE}")
        return

    content = LANDSCAPE.read_text(encoding="utf-8")
    record = f"\n\n### 自动发现（{datetime.now().strftime('%Y-%m-%d')}）\n\n"
    record += "| 工具 | 分数 | 来源 | 说明 |\n|---|---|---|---|\n"
    for t in tools[:10]:
        record += f"| [{t['name']}]({t.get('url', '')}) | {t['evaluation']['total']} | {t.get('source', '')} | {t.get('description', '')[:50]} |\n"

    content += record
    LANDSCAPE.write_text(content, encoding="utf-8")
    print(f"✅ 已更新 {LANDSCAPE}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--eval", default="data/tool_eval.json")
    args = parser.parse_args()
    update(args.eval)
