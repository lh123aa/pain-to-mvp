#!/usr/bin/env python3
"""
工具巡检：检查已用工具是否有新版本、是否失效、是否有更好的替代。
用法：
  python audit_toolkit.py                 # 巡检所有已记录工具
  python audit_toolkit.py --new-needs "xiaohongshu scraper"  # 搜索新需求
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
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

TOOLKIT = Path("data/toolkit.json")
AUDIT_LOG = Path("data/tool_audit.jsonl")
LANDSCAPE = Path("references/tool-landscape.md")

def _load_toolkit():
    if not TOOLKIT.exists():
        return {"tools": [], "last_audit": None}
    return json.loads(TOOLKIT.read_text(encoding="utf-8"))

def _save_toolkit(data):
    TOOLKIT.parent.mkdir(parents=True, exist_ok=True)
    TOOLKIT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def _github_info(repo: str) -> dict:
    """获取 GitHub 仓库信息"""
    url = f"https://api.github.com/repos/{repo}"
    req = urllib.request.Request(url, headers={"User-Agent": "pain-to-mvp"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        return {
            "stars": data.get("stargazers_count"),
            "updated": data.get("updated_at"),
            "archived": data.get("archived"),
            "open_issues": data.get("open_issues_count"),
        }
    except Exception as e:
        return {"error": str(e)}

def _search_new(need: str, limit: int = 5) -> list:
    """搜索新的候选工具"""
    url = f"https://api.github.com/search/repositories?q={urllib.parse.quote(need)}&sort=stars&order=desc&per_page={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "pain-to-mvp"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        return [
            {
                "name": item["full_name"],
                "url": item["html_url"],
                "stars": item["stargazers_count"],
                "updated": item["updated_at"],
                "description": item.get("description", ""),
            }
            for item in data.get("items", [])
        ]
    except Exception as e:
        return [{"error": str(e)}]

def _append_audit(entry: dict):
    AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(AUDIT_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

def audit(skip_remote: bool = False):
    tk = _load_toolkit()
    now = datetime.now()
    print(f"🔍 巡检工具库（共 {len(tk['tools'])} 个工具）\n")

    results = []
    for tool in tk["tools"]:
        repo = tool.get("repo")
        if not repo or skip_remote:
            results.append({"name": tool.get("name"), "status": "skipped"})
            continue

        info = _github_info(repo)
        status = "ok"
        notes = []

        if info.get("error"):
            status = "unknown"
            notes.append(info["error"])
        else:
            if info.get("archived"):
                status = "archived"
                notes.append("仓库已归档，需找替代")
            # 检查最近更新
            updated = info.get("updated", "")
            if updated:
                try:
                    dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                    days = (now - dt.replace(tzinfo=None)).days if dt.tzinfo else (now - dt).days
                    if days > 365:
                        notes.append(f"超过 {days} 天未更新")
                        if status == "ok":
                            status = "stale"
                except Exception:
                    pass

        result = {"name": tool.get("name"), "repo": repo, "status": status, "notes": notes, **info}
        results.append(result)
        emoji = {"ok": "✅", "stale": "🟡", "archived": "🔴", "unknown": "❓", "skipped": "⏭️"}.get(status, "❓")
        print(f"  {emoji} {tool.get('name')}: {status} {' | '.join(notes)}")

    # 更新 last_audit
    tk["last_audit"] = now.isoformat()
    _save_toolkit(tk)

    _append_audit({
        "audited_at": now.isoformat(),
        "total": len(results),
        "issues": [r for r in results if r["status"] not in ("ok", "skipped")],
        "results": results,
    })

    print(f"\n💾 巡检记录 → {AUDIT_LOG}")
    return results

def add_tool(name, repo=None, platform=None, purpose=None):
    """把工具加入工具库"""
    tk = _load_toolkit()
    if any(t.get("name") == name for t in tk["tools"]):
        print(f"⚠️ {name} 已存在")
        return
    tk["tools"].append({
        "name": name,
        "repo": repo,
        "platform": platform,
        "purpose": purpose,
        "added_at": datetime.now().isoformat(),
        "status": "ok",
    })
    _save_toolkit(tk)
    print(f"➕ 已加入：{name}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--new-needs", help="搜索新需求的候选工具")
    p.add_argument("--skip-remote", action="store_true", help="跳过远程检查（离线）")
    p.add_argument("--add", help="加入工具名")
    p.add_argument("--repo", help="GitHub repo，如 owner/name")
    p.add_argument("--platform")
    p.add_argument("--purpose")
    args = p.parse_args()

    if args.new_needs:
        print(f"🔍 搜索新需求：{args.new_needs}\n")
        for r in _search_new(args.new_needs):
            print(f"  - {r.get('name')} ({r.get('stars', '?')} stars) {r.get('description', '')[:60]}")
    elif args.add:
        add_tool(args.add, args.repo, args.platform, args.purpose)
    else:
        audit(skip_remote=args.skip_remote)
