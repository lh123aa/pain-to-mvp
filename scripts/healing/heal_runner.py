#!/usr/bin/env python3
"""
自愈系统入口——只读诊断模式。

历史教训：本模块曾实现"自动修复"：generate_fix 只输出一句中文描述、
run_tests 恒 True、随后 git commit && git push 并把 bug 标记为 fixed。
实际不改一行代码，却每天两次自动推送仓库、对外营造"系统在自愈"的假象。
现改为诚实的诊断报告：分类 Bug、生成建议、不动代码、不碰 git、不改状态。
真正的修复由人或后续流程执行。
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
from datetime import datetime
from pathlib import Path

BUG_LOG = Path("data/bugs/bug-log.jsonl")
BUG_INDEX = Path("data/bugs/bug-index.json")
HEAL_REPORT = Path("data/bugs/heal-report.md")
MAX_REPORTED = 30


def load_bugs():
    """读 Bug 日志；坏行（截断/非 JSON）跳过不阻断整份诊断（OPEN_ISSUES #15）。"""
    if not BUG_LOG.exists():
        return []
    bugs = []
    with open(BUG_LOG, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                bugs.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # 坏行跳过：一条损坏记录不得炸掉全部诊断
    return bugs


def classify_bug(bug):
    error = bug.get("error", "").lower()
    if any(k in error for k in ["timeout", "connection", "network"]):
        return "network"
    if any(k in error for k in ["login", "cookie", "auth", "401", "403", "风控"]):
        return "auth"
    if any(k in error for k in ["rate limit", "429", "too many", "限流"]):
        return "rate_limit"
    if any(k in error for k in ["not found", "404", "no such"]):
        return "tool_missing"
    if any(k in error for k in ["parse", "decode", "json"]):
        return "parse"
    return "unknown"


def generate_fix(bug, category):
    fixes = {
        "network": "增加重试机制 + 切换代理",
        "auth": "刷新 Cookie / 重新登录（B站注意 WBI 签名与风控码）",
        "rate_limit": "降低请求频率 + 增加延迟",
        "tool_missing": "查找替代工具",
        "parse": "更新解析规则 / 字段映射",
        "unknown": "需人工介入"
    }
    return fixes.get(category, "需人工介入")


def commit_and_push(fix_id):
    """已禁用：自愈系统不再自动提交。保留签名兼容旧调用方。"""
    print(f"🚫 自动推送已禁用（{fix_id}）：请人工 review 后自行提交")
    return False


def heal():
    """诊断模式：读 Bug 日志 → 分类 → 生成修复建议报告。不修改任何代码与状态。"""
    bugs = load_bugs()
    open_bugs = [b for b in bugs if b.get("status") == "open"]
    print(f"🔍 发现 {len(open_bugs)} 个开放 Bug（共 {len(bugs)} 条记录）")

    lines = [
        f"# 自愈诊断报告（{datetime.now().isoformat()}）",
        "",
        f"开放 Bug：**{len(open_bugs)}** / 总记录 {len(bugs)}",
        "",
        "> 本报告只读生成：不自动改代码、不自动提交、不修改 Bug 状态。",
        "",
        "| Bug ID | 阶段 | 工具 | 分类 | 修复建议 |",
        "|---|---|---|---|---|",
    ]
    for bug in open_bugs[:MAX_REPORTED]:
        category = classify_bug(bug)
        lines.append(
            f"| {bug.get('bug_id')} | {bug.get('phase', '-')} | {bug.get('tool', '-')} "
            f"| {category} | {generate_fix(bug, category)} |"
        )

    HEAL_REPORT.parent.mkdir(parents=True, exist_ok=True)
    HEAL_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"📄 诊断报告 → {HEAL_REPORT}")

    # 分类统计（供人快速判断系统健康度）
    from collections import Counter
    stats = Counter(classify_bug(b) for b in open_bugs)
    if stats:
        print("📊 分类统计：" + "，".join(f"{k}={v}" for k, v in stats.most_common()))


if __name__ == "__main__":
    heal()
