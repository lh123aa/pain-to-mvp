#!/usr/bin/env python3
"""
更新单个需求的进度。
用法：
  python update_progress.py --id 20261011-001 --status analyzing --progress 45 --stage "痛点提炼完成" --next "机会评分"
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

DASHBOARD = Path("data/dashboard.json")

VALID_STATUS = ["discovered", "analyzing", "mvp_design", "validating", "completed", "dropped", "in_progress"]

def _load():
    if DASHBOARD.exists():
        return json.loads(DASHBOARD.read_text(encoding="utf-8"))
    return {"last_updated": None, "summary": {}, "requirements": []}

def _save(db):
    DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
    DASHBOARD.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")

def _refresh_summary(db):
    reqs = db.get("requirements", [])
    db["summary"] = {
        "total": len(reqs),
        "in_progress": sum(1 for r in reqs if r.get("status") in ("in_progress", "analyzing", "mvp_design", "validating")),
        "completed": sum(1 for r in reqs if r.get("status") == "completed"),
        "dropped": sum(1 for r in reqs if r.get("status") == "dropped"),
        "high_score": sum(1 for r in reqs if (r.get("score") or 0) >= 70),
    }
    db["last_updated"] = datetime.now().isoformat()

def update(req_id, status=None, progress=None, stage=None, next_action=None, note=None):
    db = _load()
    found = False
    for r in db.get("requirements", []):
        if r.get("id") == req_id:
            found = True
            if status:
                if status not in VALID_STATUS:
                    print(f"⚠️ 未知状态：{status}，可选：{VALID_STATUS}")
                r["status"] = status
            if progress is not None:
                r["progress"] = max(0, min(100, int(progress)))
            if stage:
                r["stage"] = stage
            if next_action:
                r["next_action"] = next_action
            # 时间线
            r.setdefault("timeline", []).append({
                "timestamp": datetime.now().isoformat(),
                "status": r.get("status"),
                "progress": r.get("progress"),
                "stage": r.get("stage"),
                "note": note,
            })
            break

    if not found:
        print(f"⚠️ 未找到需求：{req_id}")
        return False

    _refresh_summary(db)
    _save(db)
    print(f"✅ 已更新 {req_id}")
    return True

def add_requirement(req_id, title, score=None, status="discovered", stage="新发现", quotes=None):
    """新增一个需求"""
    db = _load()
    if any(r.get("id") == req_id for r in db.get("requirements", [])):
        print(f"⚠️ {req_id} 已存在")
        return False
    db.setdefault("requirements", []).append({
        "id": req_id,
        "title": title,
        "status": status,
        "progress": 5,
        "stage": stage,
        "score": score,
        "representative_quotes": quotes or [],
        "discovered_at": datetime.now().isoformat(),
        "timeline": [{"timestamp": datetime.now().isoformat(), "status": status, "progress": 5, "stage": stage}],
    })
    _refresh_summary(db)
    _save(db)
    print(f"➕ 新增 {req_id}")
    return True

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--id", required=True)
    p.add_argument("--status")
    p.add_argument("--progress", type=int)
    p.add_argument("--stage")
    p.add_argument("--next")
    p.add_argument("--note")
    args = p.parse_args()
    update(args.id, args.status, args.progress, args.stage, args.next, args.note)
