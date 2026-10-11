#!/usr/bin/env python3
"""启动一个项目历程记录。"""
import argparse
import json
from datetime import datetime
from pathlib import Path

JOURNEY_DIR = Path("data/journeys")

def start_journey(project_id, title, input_text=""):
    project_dir = JOURNEY_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "assets").mkdir(exist_ok=True)

    journey = {
        "project_id": project_id,
        "title": title,
        "input": input_text,
        "start_time": datetime.now().isoformat(),
        "status": "in_progress",
        "stage": "Phase 0",
        "progress": 0,
        "phases": [],
        "decisions": [],
        "lessons": [],
        "result": None
    }

    with open(project_dir / "journey.json", "w", encoding="utf-8") as f:
        json.dump(journey, f, ensure_ascii=False, indent=2)

    with open(project_dir / "journey.md", "w", encoding="utf-8") as f:
        f.write(f"# 项目历程：{title}\n\n")
        f.write(f"**项目 ID**：{project_id}\n")
        f.write(f"**开始时间**：{journey['start_time']}\n")
        f.write(f"**状态**：in_progress\n\n---\n\n")

    print(f"✅ 项目历程已启动：{project_dir}")
    return journey

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--input", default="")
    args = parser.parse_args()
    start_journey(args.project_id, args.title, args.input)
