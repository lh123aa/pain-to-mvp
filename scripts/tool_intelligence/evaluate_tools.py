#!/usr/bin/env python3
"""
工具评估：按六维矩阵打分。
用法：python evaluate_tools.py --input data/tool_discovery.jsonl --output data/tool_eval.json
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

WEIGHTS = {
    "function": 0.30,
    "maintenance": 0.20,
    "install": 0.15,
    "compliance": 0.15,
    "community": 0.10,
    "composability": 0.10
}

def score_tool(tool):
    """根据工具元数据估算分数（0-100）"""
    scores = {}

    # 功能匹配度：暂用描述长度估算
    desc = tool.get("description", "") or ""
    scores["function"] = min(100, len(desc) * 2) if desc else 50

    # 维护活跃度：根据 updated 时间
    updated = tool.get("updated", "")
    if updated:
        try:
            dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            days = (datetime.now(dt.tzinfo) - dt).days
            scores["maintenance"] = max(0, 100 - days)
        except Exception:
            scores["maintenance"] = 50
    else:
        scores["maintenance"] = 50

    # 安装复杂度：默认 70（未知）
    scores["install"] = 70

    # 合规安全：默认 70
    scores["compliance"] = 70

    # 社区验证：根据 stars
    stars = tool.get("stars", 0) or 0
    scores["community"] = min(100, stars / 10)

    # 可组合性：默认 70
    scores["composability"] = 70

    total = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)
    return {"total": round(total, 1), "dimensions": scores}

def evaluate(input_file, output_file):
    tools = []
    with open(input_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                tools.append(json.loads(line))

    for tool in tools:
        tool["evaluation"] = score_tool(tool)

    tools.sort(key=lambda x: x["evaluation"]["total"], reverse=True)

    Path(output_file).parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(tools, f, ensure_ascii=False, indent=2)

    print(f"✅ 评估完成：{len(tools)} 个工具")
    for t in tools[:5]:
        print(f"  - {t['name']}: {t['evaluation']['total']}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/tool_discovery.jsonl")
    parser.add_argument("--output", default="data/tool_eval.json")
    args = parser.parse_args()
    evaluate(args.input, args.output)
