#!/usr/bin/env python3
"""
从 data/cards/ 目录的 Markdown 卡片重建 dashboard.json。
用法：
  python write_dashboard.py
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
import json
import re
from datetime import datetime
from pathlib import Path

CARD_DIR = Path("data/cards")
DASHBOARD = Path("data/dashboard.json")

def _parse_card(path: Path) -> dict:
    """从 Markdown 卡片解析基本信息"""
    text = path.read_text(encoding="utf-8")
    card = {
        "id": path.stem,
        "title": "",
        "status": "discovered",
        "progress": 10,
        "stage": "新发现",
        "score": None,
        "representative_quotes": [],
        "discovered_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        "card_path": str(path),
        "timeline": [],
    }

    # 标题
    m = re.search(r"- \*\*标题\*\*：(.+)", text)
    if m:
        card["title"] = m.group(1).strip()

    # 状态
    m = re.search(r"- \*\*状态\*\*：(\w+)", text)
    if m:
        card["status"] = m.group(1).strip()

    # 机会分
    m = re.search(r"- \*\*机会分\*\*：([\d.]+)/100", text)
    if m:
        try:
            card["score"] = float(m.group(1))
        except ValueError:
            pass

    # 代表原话
    for line in text.splitlines():
        if line.startswith("- 「") and line.endswith("」"):
            card["representative_quotes"].append(line[2:-1])
            if len(card["representative_quotes"]) >= 3:
                break

    # 评分明细
    scores = {}
    for dim, key in [("需求强度", "demand"), ("竞争空缺", "competition"),
                     ("个人可行性", "feasibility"), ("触达难度", "reach"), ("AI杠杆", "ai_leverage")]:
        m = re.search(rf"\| {dim} \| (\d+)/5 \|", text)
        if m:
            scores[key] = int(m.group(1))
    if scores:
        card["scores"] = scores

    return card

def rebuild():
    reqs = []
    if CARD_DIR.exists():
        for p in sorted(CARD_DIR.glob("*.md")):
            try:
                reqs.append(_parse_card(p))
            except Exception as e:
                print(f"⚠️ 解析失败：{p} - {e}")

    # 按分数降序
    reqs.sort(key=lambda x: x.get("score") or 0, reverse=True)

    db = {
        "last_updated": datetime.now().isoformat(),
        "summary": {
            "total": len(reqs),
            "in_progress": sum(1 for r in reqs if r["status"] in ("in_progress", "analyzing", "mvp_design", "validating")),
            "completed": sum(1 for r in reqs if r["status"] == "completed"),
            "dropped": sum(1 for r in reqs if r["status"] == "dropped"),
            "high_score": sum(1 for r in reqs if (r.get("score") or 0) >= 70),
        },
        "requirements": reqs,
    }

    DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
    DASHBOARD.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ 已重建 dashboard.json：{len(reqs)} 个需求")
    return db

if __name__ == "__main__":
    rebuild()
