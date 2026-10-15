#!/usr/bin/env python3
"""
自优化入口：分析执行日志 → 生成优化建议 → 更新工具组合表。
用法：
  python optimizer.py              # 分析并输出建议
  python optimizer.py --apply      # 应用低风险优化
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
