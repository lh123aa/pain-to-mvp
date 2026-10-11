#!/usr/bin/env python3
"""
执行日志：每次任务结束记录全过程。
用法：
  python log_execution.py --task "独立开发者获客" --phases 5 --duration 120 --outcome success --tools "MediaCrawler,BERTopic"
"""
import argparse
import json
import uuid
from datetime import datetime
from pathlib import Path

EXEC_DIR = Path("data/executions")
EXEC_DIR.mkdir(parents=True, exist_ok=True)
INDEX = Path("data/executions/index.jsonl")

def log(task, phases, duration, outcome, tools, notes=""):
    entry = {
        "execution_id": f"exec-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}",
        "task": task,
        "timestamp": datetime.now().isoformat(),
        "phases_completed": phases,
        "duration_seconds": duration,
        "outcome": outcome,  # success / partial / failed
        "tools_used": [t.strip() for t in tools.split(",") if t.strip()],
        "notes": notes,
    }
    with open(INDEX, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # 单独存一份
    file = EXEC_DIR / f"{entry['execution_id']}.json"
    file.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📝 执行日志已记录：{entry['execution_id']}")
    return entry

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--task", required=True)
    p.add_argument("--phases", type=int, default=0)
    p.add_argument("--duration", type=int, default=0)
    p.add_argument("--outcome", default="success")
    p.add_argument("--tools", default="")
    p.add_argument("--notes", default="")
    args = p.parse_args()
    log(args.task, args.phases, args.duration, args.outcome, args.tools, args.notes)
