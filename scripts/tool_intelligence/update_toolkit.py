#!/usr/bin/env python3
"""
工具库更新：把评估后的工具合并进 tool-landscape.md。
用法：python update_toolkit.py --eval data/tool_eval.json
"""
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
