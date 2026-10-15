#!/usr/bin/env python3
"""
知识库更新：从执行日志和 Bug 日志中提炼经验，更新 references。
用法：python update_knowledge.py
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
