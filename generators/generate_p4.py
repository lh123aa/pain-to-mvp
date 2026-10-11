
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pain-to-MVP 项目生成器 - P4
工具智能层增强 + 自优化循环 + 执行日志 + 知识库更新
运行：python generate_p4.py
"""
from pathlib import Path

FILES = {}

# ============================================================
# scripts/tool_intelligence/audit_toolkit.py
# ============================================================
FILES["scripts/tool_intelligence/audit_toolkit.py"] = r'''#!/usr/bin/env python3
"""
工具巡检：检查已用工具是否有新版本、是否失效、是否有更好的替代。
用法：
  python audit_toolkit.py                 # 巡检所有已记录工具
  python audit_toolkit.py --new-needs "xiaohongshu scraper"  # 搜索新需求
"""
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
'''

# ============================================================
# scripts/tool_intelligence/sync_toolkit.py
# ============================================================
FILES["scripts/tool_intelligence/sync_toolkit.py"] = r'''#!/usr/bin/env python3
"""
把 data/toolkit.json 同步到 references/tool-landscape.md。
用法：python sync_toolkit.py
"""
import json
from datetime import datetime
from pathlib import Path

TOOLKIT = Path("data/toolkit.json")
LANDSCAPE = Path("references/tool-landscape.md")
MARKER = "<!-- AUTO-SYNCED -->"

def sync():
    if not TOOLKIT.exists():
        print(f"⚠️ 未找到 {TOOLKIT}")
        return
    tk = json.loads(TOOLKIT.read_text(encoding="utf-8"))

    lines = [MARKER, f"\n## 自动同步的工具库（{datetime.now().strftime('%Y-%m-%d')}）\n"]
    lines.append("| 工具 | 平台 | 用途 | 状态 | 最后巡检 |")
    lines.append("|---|---|---|---|---|")
    for t in tk.get("tools", []):
        lines.append(
            f"| [{t.get('name')}]({t.get('repo') or ''}) | {t.get('platform') or '-'} | "
            f"{t.get('purpose') or '-'} | {t.get('status', 'ok')} | {t.get('last_audit') or '-'} |"
        )
    content = "\n".join(lines) + "\n"

    existing = LANDSCAPE.read_text(encoding="utf-8") if LANDSCAPE.exists() else ""
    if MARKER in existing:
        before = existing.split(MARKER)[0]
        existing = before + content
    else:
        existing = existing + "\n" + content

    LANDSCAPE.write_text(existing, encoding="utf-8")
    print(f"✅ 已同步 → {LANDSCAPE}")

if __name__ == "__main__":
    sync()
'''

# ============================================================
# scripts/self_improve/log_execution.py
# ============================================================
FILES["scripts/self_improve/log_execution.py"] = r'''#!/usr/bin/env python3
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
'''

# ============================================================
# scripts/self_improve/update_knowledge.py
# ============================================================
FILES["scripts/self_improve/update_knowledge.py"] = r'''#!/usr/bin/env python3
"""
知识库更新：从执行日志和 Bug 日志中提炼经验，更新 references。
用法：python update_knowledge.py
"""
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

EXEC_INDEX = Path("data/executions/index.jsonl")
BUG_LOG = Path("data/bugs/bug-log.jsonl")
LESSONS = Path("references/lessons-learned.md")

def _read_jsonl(path):
    if not path.exists():
        return []
    items = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    items.append(json.loads(line))
                except Exception:
                    pass
    return items

def distill():
    execs = _read_jsonl(EXEC_INDEX)
    bugs = _read_jsonl(BUG_LOG)

    # 工具使用频率
    tool_counter = Counter()
    for e in execs:
        for t in e.get("tools_used", []):
            tool_counter[t] += 1

    # 失败任务
    failed = [e for e in execs if e.get("outcome") != "success"]

    # Bug 分类
    bug_categories = Counter()
    for b in bugs:
        err = (b.get("error") or "").lower()
        if "timeout" in err or "connection" in err:
            bug_categories["网络问题"] += 1
        elif "login" in err or "cookie" in err or "401" in err or "403" in err:
            bug_categories["登录/授权"] += 1
        elif "rate limit" in err or "429" in err:
            bug_categories["限流"] += 1
        elif "parse" in err or "json" in err:
            bug_categories["解析"] += 1
        else:
            bug_categories["其他"] += 1

    # 生成 lessons-learned.md
    lines = [f"# 经验总结（自动更新 {datetime.now().strftime('%Y-%m-%d %H:%M')}）\n"]

    lines.append("\n## 一、工具使用频率\n")
    lines.append("| 工具 | 使用次数 |\n|---|---|")
    for t, n in tool_counter.most_common(20):
        lines.append(f"| {t} | {n} |")

    lines.append("\n## 二、失败任务\n")
    if failed:
        for e in failed[-10:]:
            lines.append(f"- [{e['timestamp']}] {e['task']}（{e.get('notes', '')}）")
    else:
        lines.append("- 暂无失败记录")

    lines.append("\n## 三、Bug 分类统计\n")
    lines.append("| 类别 | 次数 |\n|---|---|")
    for c, n in bug_categories.most_common():
        lines.append(f"| {c} | {n} |")

    lines.append("\n## 四、建议\n")
    if bug_categories.get("限流", 0) > 3:
        lines.append("- ⚠️ 限流问题频繁，建议降低请求频率或引入代理池")
    if bug_categories.get("登录/授权", 0) > 3:
        lines.append("- ⚠️ 登录态问题频繁，建议统一 Cookie 管理机制")
    if bug_categories.get("解析", 0) > 3:
        lines.append("- ⚠️ 解析问题频繁，建议统一字段映射与容错")
    if not (bug_categories or failed):
        lines.append("- ✅ 系统运行良好")

    LESSONS.parent.mkdir(parents=True, exist_ok=True)
    LESSONS.write_text("\n".join(lines), encoding="utf-8")
    print(f"✅ 经验已更新 → {LESSONS}")
    return {"tools": dict(tool_counter), "bugs": dict(bug_categories), "failed": len(failed)}

if __name__ == "__main__":
    distill()
'''

# ============================================================
# scripts/self_improve/optimizer.py
# ============================================================
FILES["scripts/self_improve/optimizer.py"] = r'''#!/usr/bin/env python3
"""
自优化入口：分析执行日志 → 生成优化建议 → 更新工具组合表。
用法：
  python optimizer.py              # 分析并输出建议
  python optimizer.py --apply      # 应用低风险优化
"""
import argparse
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

EXEC_INDEX = Path("data/executions/index.jsonl")
BUG_LOG = Path("data/bugs/bug-log.jsonl")
SUGGESTIONS = Path("data/optimization_suggestions.json")

def _read_jsonl(path):
    if not path.exists():
        return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    out.append(json.loads(line))
                except Exception:
                    pass
    return out

def analyze():
    execs = _read_jsonl(EXEC_INDEX)
    bugs = _read_jsonl(BUG_LOG)
    suggestions = []

    # 慢任务
    slow = [e for e in execs if e.get("duration_seconds", 0) > 600]
    if slow:
        suggestions.append({
            "type": "performance",
            "priority": "medium",
            "message": f"发现 {len(slow)} 个慢任务（>10分钟），建议加缓存或并行化",
            "evidence": [e["execution_id"] for e in slow[:5]],
        })

    # 反复失败的工具
    tool_fail = Counter()
    for e in execs:
        if e.get("outcome") != "success":
            for t in e.get("tools_used", []):
                tool_fail[t] += 1
    for tool, n in tool_fail.items():
        if n >= 2:
            suggestions.append({
                "type": "tool_replacement",
                "priority": "high",
                "message": f"工具 {tool} 失败 {n} 次，建议查找替代",
                "tool": tool,
            })

    # Bug 类型集中
    bug_cat = Counter()
    for b in bugs:
        err = (b.get("error") or "").lower()
        if "rate limit" in err or "429" in err:
            bug_cat["rate_limit"] += 1
        elif "login" in err or "cookie" in err:
            bug_cat["auth"] += 1
    if bug_cat["rate_limit"] >= 3:
        suggestions.append({
            "type": "config",
            "priority": "high",
            "message": "限流问题频繁，建议降低 RateLimiter delay 或引入代理池",
        })
    if bug_cat["auth"] >= 3:
        suggestions.append({
            "type": "config",
            "priority": "high",
            "message": "登录态问题频繁，建议统一 Cookie 刷新机制",
        })

    # 无 Bug 且任务顺利 → 可以考虑扩平台
    if len(execs) >= 5 and not bugs:
        suggestions.append({
            "type": "expansion",
            "priority": "low",
            "message": "系统稳定，可考虑扩展到新平台（小红书/YouTube/Reddit）",
        })

    SUGGESTIONS.parent.mkdir(parents=True, exist_ok=True)
    SUGGESTIONS.write_text(json.dumps({
        "generated_at": datetime.now().isoformat(),
        "suggestions": suggestions,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"🧠 生成 {len(suggestions)} 条优化建议")
    for s in suggestions:
        emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(s["priority"], "⚪")
        print(f"  {emoji} [{s['type']}] {s['message']}")
    return suggestions

def apply_low_risk():
    """只应用低风险项（写日志，不自动改代码）"""
    if not SUGGESTIONS.exists():
        analyze()
    data = json.loads(SUGGESTIONS.read_text(encoding="utf-8"))
    applied = []
    for s in data["suggestions"]:
        if s["priority"] == "low" and s["type"] in ("expansion", "performance"):
            applied.append(s["message"])
    print(f"\n✅ 已记录 {len(applied)} 条低风险优化（需人工确认后生效）")
    return applied

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    if args.apply:
        analyze()
        apply_low_risk()
    else:
        analyze()
'''

# ============================================================
# scripts/self_improve/audit_runner.py
# ============================================================
FILES["scripts/self_improve/audit_runner.py"] = r'''#!/usr/bin/env python3
"""
定时巡检入口：工具巡检 + 知识库更新 + 自优化建议。
由 GitHub Actions 每天触发。
用法：python audit_runner.py
"""
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent

def run(script, *args):
    cmd = [sys.executable, str(script), *args]
    print(f"\n$ {' '.join(cmd)}")
    r = subprocess.run(cmd)
    return r.returncode == 0

def main():
    print("=" * 50)
    print("🔄 开始每日巡检")
    print("=" * 50)

    run(BASE / "tool_intelligence" / "audit_toolkit.py")
    run(BASE / "tool_intelligence" / "sync_toolkit.py")
    run(BASE / "self_improve" / "update_knowledge.py")
    run(BASE / "self_improve" / "optimizer.py")

    print("\n✅ 巡检完成")

if __name__ == "__main__":
    main()
'''

# ============================================================
# .github/workflows/daily-audit.yml
# ============================================================
FILES[".github/workflows/daily-audit.yml"] = r'''name: Daily Audit

on:
  schedule:
    - cron: '0 2 * * *'   # 每天 UTC 02:00（北京时间 10:00）
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install deps
        run: pip install requests pyyaml
      - name: Run audit
        run: python scripts/self_improve/audit_runner.py
      - name: Commit changes
        run: |
          git config user.name "audit-bot"
          git config user.email "bot@pain-to-mvp.local"
          git add -A
          git diff --quiet && git diff --staged --quiet || git commit -m "chore: daily audit $(date +%Y-%m-%d)"
          git push
'''

# ============================================================
# data/toolkit.json（初始种子）
# ============================================================
FILES["data/toolkit.json"] = r'''{
  "last_audit": null,
  "tools": [
    {"name": "MediaCrawler", "repo": "NanmiCoder/MediaCrawler", "platform": "xiaohongshu,douyin,bilibili,weibo,zhihu", "purpose": "评论爬取", "status": "ok"},
    {"name": "TikTokDownloader", "repo": "JoeanAmier/TikTokDownloader", "platform": "douyin,tiktok", "purpose": "视频+评论", "status": "ok"},
    {"name": "youtube-comment-downloader", "repo": "egbertbouman/youtube-comment-downloader", "platform": "youtube", "purpose": "评论下载", "status": "ok"},
    {"name": "yt-dlp", "repo": "yt-dlp/yt-dlp", "platform": "youtube", "purpose": "视频/元数据", "status": "ok"},
    {"name": "PRAW", "repo": "praw-dev/praw", "platform": "reddit", "purpose": "官方 API", "status": "ok"},
    {"name": "BERTopic", "repo": "MaartenGr/BERTopic", "platform": "*", "purpose": "语义聚类", "status": "ok"},
    {"name": "Sentence Transformers", "repo": "UKPLab/sentence-transformers", "platform": "*", "purpose": "文本向量化", "status": "ok"},
    {"name": "jieba", "repo": "fxsjy/jieba", "platform": "*", "purpose": "中文分词", "status": "ok"}
  ]
}
'''

# ============================================================
# references/lessons-learned.md（初始占位）
# ============================================================
FILES["references/lessons-learned.md"] = r'''# 经验总结

> 本文件由 `scripts/self_improve/update_knowledge.py` 自动维护。
> 每次执行任务后运行更新，会追加工具使用频率、失败记录、Bug 统计。

（等待首次自动生成）
'''

# ============================================================
# scripts/self_improve/__init__.py
# ============================================================
FILES["scripts/self_improve/__init__.py"] = r'''# self_improve package
'''

# ============================================================
# scripts/tool_intelligence/__init__.py
# ============================================================
FILES["scripts/tool_intelligence/__init__.py"] = r'''# tool_intelligence package
'''

# ============================================================
# scripts/pipeline/__init__.py（确保可 import）
# ============================================================
FILES["scripts/pipeline/__init__.py"] = r'''# pipeline package
'''


def generate():
    root = Path.cwd()
    print(f"📁 生成 P4 文件到：{root}\n")
    for rel_path, content in FILES.items():
        p = root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"✅ {rel_path}")

    for d in ["data/executions", "data/tool_audit"]:
        (root / d).mkdir(parents=True, exist_ok=True)

    print("\n🎉 P4 生成完成！")
    print("\n本次生成：")
    print("  - tool_intelligence/audit_toolkit.py：工具巡检（GitHub 检查+找替代）")
    print("  - tool_intelligence/sync_toolkit.py：同步到 tool-landscape.md")
    print("  - self_improve/log_execution.py：执行日志")
    print("  - self_improve/update_knowledge.py：知识库提炼（lessons-learned.md）")
    print("  - self_improve/optimizer.py：自优化建议生成")
    print("  - self_improve/audit_runner.py：每日巡检入口")
    print("  - .github/workflows/daily-audit.yml：每天 UTC 02:00 自动巡检")
    print("  - data/toolkit.json：工具库种子")
    print("\n验证：")
    print("  # 记录一次执行")
    print("  python scripts/self_improve/log_execution.py --task '独立开发者' --phases 9 --duration 300 --outcome success --tools 'MediaCrawler,BERTopic'")
    print("  # 提炼经验")
    print("  python scripts/self_improve/update_knowledge.py")
    print("  # 生成优化建议")
    print("  python scripts/self_improve/optimizer.py")
    print("  # 工具巡检（离线模式）")
    print("  python scripts/tool_intelligence/audit_toolkit.py --skip-remote")
    print("\n下一步：等待 P5（Dashboard 展示端）")


if __name__ == "__main__":
    generate()
