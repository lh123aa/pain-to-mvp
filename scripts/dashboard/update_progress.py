#!/usr/bin/env python3
"""
更新单个需求的进度（PRD §6.1 六阶段状态机）。
用法：
  python update_progress.py --id 20261011-001 --status scoring --progress 45 --stage "痛点提炼完成" --next "机会评分"

状态机（PRD §6.1，单向流转）：
  pending → discovering → crawling → mining → scoring → designing → done
  任意状态 → dropped（终态）；done/dropped 为终态不可再流转。
约束：progress 只增不减；dashboard.json 顶层必须含 schema_version。
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

DASHBOARD = Path("data/dashboard.json")

# PRD §6.1 六阶段 + 终态 dropped；顺序即流转方向（只增不减的阶段序）
STAGES = ["pending", "discovering", "crawling", "mining", "scoring", "designing", "done"]
TERMINAL = {"done", "dropped"}
SCHEMA_VERSION = 1

# 旧枚举（2026-10-15 状态机落地前）→ PRD 六阶段。加载时迁移，不改写历史文件本身，
# 保存时即归一。
LEGACY_STATUS = {
    "discovered": "designing",   # 卡片已导出 = MVP 方案已设计，待验证
    "analyzing": "mining",
    "mvp_design": "designing",
    "validating": "designing",
    "completed": "done",
    "in_progress": "mining",
    "pending": "pending",
}


def _migrate(req):
    """把单条需求的旧状态映射到 PRD 枚举；未知状态保留原值（update 时会拒绝）。"""
    st = req.get("status")
    if st is not None and st not in STAGES + ["dropped"]:
        req["status"] = LEGACY_STATUS.get(st, st)


def _load():
    if DASHBOARD.exists():
        db = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    else:
        db = {"last_updated": None, "summary": {}, "requirements": []}
    db["schema_version"] = SCHEMA_VERSION
    for r in db.get("requirements", []):
        _migrate(r)
    return db

def _save(db):
    db["schema_version"] = SCHEMA_VERSION
    DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
    DASHBOARD.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")

def _refresh_summary(db):
    reqs = db.get("requirements", [])
    db["summary"] = {
        "total": len(reqs),
        "in_progress": sum(1 for r in reqs
                           if r.get("status") not in (None, "pending", "done", "dropped")),
        "completed": sum(1 for r in reqs if r.get("status") == "done"),
        "dropped": sum(1 for r in reqs if r.get("status") == "dropped"),
        "high_score": sum(1 for r in reqs if (r.get("score") or 0) >= 70),
    }
    db["last_updated"] = datetime.now().isoformat()


def check_transition(current: str, new: str) -> str:
    """返回空串 = 合法；否则是拒绝理由（PRD §6.1 单向流转）。"""
    if new not in STAGES + ["dropped"]:
        return f"非法状态：{new}，只允许 {STAGES + ['dropped']}"
    current = current if current in STAGES + ["dropped"] else "pending"
    if new == current:
        return ""
    if current in TERMINAL:
        return f"终态不可流转：{current} → {new}（要重开请 dropped 后新建）"
    if new == "dropped":
        return ""  # 任意非终态可 drop
    if STAGES.index(new) <= STAGES.index(current):
        return f"状态不可回退：{current} → {new}（单向流转，要回退只能 dropped 后重开）"
    return ""


def update(req_id, status=None, progress=None, stage=None, next_action=None, note=None):
    db = _load()
    found = False
    for r in db.get("requirements", []):
        if r.get("id") == req_id:
            found = True
            if status:
                reason = check_transition(r.get("status", "pending"), status)
                if reason:
                    print(f"❌ {req_id}：{reason}")
                    return False
                r["status"] = status
            if progress is not None:
                # 只增不减（PRD §6.1）：新值低于现值时保持现值
                clamped = max(0, min(100, int(progress)))
                r["progress"] = max(r.get("progress") or 0, clamped)
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

def add_requirement(req_id, title, score=None, status="pending", stage="待挖掘", quotes=None):
    """新增一个需求（状态机起点 pending）"""
    if status not in STAGES:
        print(f"❌ 非法初始状态：{status}，只允许 {STAGES}")
        return False
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
    ok = update(args.id, args.status, args.progress, args.stage, args.next, args.note)
    raise SystemExit(0 if ok else 1)
