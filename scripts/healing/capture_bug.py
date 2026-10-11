#!/usr/bin/env python3
"""捕获一个 Bug 并写入日志。"""
import argparse
import json
import uuid
from datetime import datetime
from pathlib import Path

BUG_DIR = Path("data/bugs")
BUG_DIR.mkdir(parents=True, exist_ok=True)
BUG_LOG = BUG_DIR / "bug-log.jsonl"

def capture_bug(phase, tool, severity, error, stack_trace="", context=""):
    bug_id = f"bug-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"
    bug = {
        "bug_id": bug_id,
        "timestamp": datetime.now().isoformat(),
        "phase": phase,
        "tool": tool,
        "severity": severity,
        "error": error,
        "stack_trace": stack_trace,
        "context": context,
        "status": "open",
        "fix_type": None,
        "fix_attempts": 0
    }

    with open(BUG_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(bug, ensure_ascii=False) + "\n")

    print(f"🐛 Bug 已记录：{bug_id}")
    return bug

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True)
    parser.add_argument("--tool", default="")
    parser.add_argument("--severity", default="medium")
    parser.add_argument("--error", required=True)
    parser.add_argument("--stack-trace", default="")
    parser.add_argument("--context", default="")
    args = parser.parse_args()
    capture_bug(args.phase, args.tool, args.severity, args.error,
                args.stack_trace, args.context)
