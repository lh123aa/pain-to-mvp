#!/usr/bin/env python3
"""记录一个阶段的完成。"""
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

JOURNEY_DIR = Path("data/journeys")

def log_stage(project_id, phase, actions, tools, problems, solutions, outputs):
    project_dir = JOURNEY_DIR / project_id
    journey_file = project_dir / "journey.json"

    with open(journey_file, "r", encoding="utf-8") as f:
        journey = json.load(f)

    stage_record = {
        "phase": phase,
        "timestamp": datetime.now().isoformat(),
        "actions": actions,
        "tools": tools,
        "problems": problems,
        "solutions": solutions,
        "outputs": outputs
    }
    journey["phases"].append(stage_record)
    journey["stage"] = phase
    journey["progress"] = min(100, journey["progress"] + 10)

    with open(journey_file, "w", encoding="utf-8") as f:
        json.dump(journey, f, ensure_ascii=False, indent=2)

    with open(project_dir / "journey.md", "a", encoding="utf-8") as f:
        f.write(f"\n### {phase}\n")
        f.write(f"- **时间**：{stage_record['timestamp']}\n")
        f.write(f"- **做了什么**：{actions}\n")
        f.write(f"- **用了什么工具**：{tools}\n")
        f.write(f"- **遇到什么问题**：{problems}\n")
        f.write(f"- **怎么解决**：{solutions}\n")
        f.write(f"- **产出**：{outputs}\n")

    print(f"✅ 阶段已记录：{phase}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--phase", required=True)
    parser.add_argument("--actions", default="")
    parser.add_argument("--tools", default="")
    parser.add_argument("--problems", default="")
    parser.add_argument("--solutions", default="")
    parser.add_argument("--outputs", default="")
    args = parser.parse_args()
    log_stage(args.project_id, args.phase, args.actions, args.tools,
              args.problems, args.solutions, args.outputs)
