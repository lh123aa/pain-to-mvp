#!/usr/bin/env python3
"""
MVP 设计：根据高分痛点生成最小商业闭环。
参考 references/mvp-patterns.md。
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
from pathlib import Path

# 痛点信号 → MVP 类型推荐
SIGNAL_TO_MVP = {
    "求助": ("模板/提示词库", "把常见问题整理成模板或提示词"),
    "抱怨": ("小工具/自动化", "用工具消除繁琐步骤"),
    "对比": ("导航站/评测报告", "帮用户做选择"),
    "失望": ("替代方案/教程", "提供更好的替代品"),
    "期望": ("新产品原型", "直接满足未满足的期望"),
    "付费意愿": ("付费产品/咨询", "直接商业化"),
    "困惑": ("教程/知识库", "把知识结构化"),
}

def design_mvp(pain: dict) -> dict:
    # 按频次降序取主导信号（OPEN_ISSUES #24）：dict 插入顺序不等于主导，
    # 首推与 deliverable_hint 都应跟随票数最高的信号。
    sigs = [k for k, _ in sorted(
        (pain.get("signal_distribution") or {}).items(),
        key=lambda kv: kv[1], reverse=True)]
    quotes = pain.get("representative_quotes", [])

    # 推荐 MVP 类型
    recommended = []
    for s in sigs:
        if s in SIGNAL_TO_MVP:
            recommended.append({"signal": s, "type": SIGNAL_TO_MVP[s][0], "rationale": SIGNAL_TO_MVP[s][1]})
    if not recommended:
        recommended.append({"signal": "generic", "type": "咨询/模板", "rationale": "默认推荐轻交付"})

    return {
        "recommended_mvp": recommended[:3],
        "deliverable_hint": recommended[0]["type"],
        "validation_plan": [
            "Day 1: 找 10 个目标用户",
            "Day 2: 访谈 3 个，确认痛点",
            "Day 3: 做出最小交付物",
            "Day 4: 尝试收 100 元",
            "Day 5: 交付 + 收集反馈",
            "Day 6-7: 复盘，决定继续/放弃",
        ],
        "revenue_layers": ["咨询/代做（现金流）", "模板/工具（可复用）", "社群/订阅（复利）"],
        "tech_stack": ["GitHub Pages", "单文件 HTML", "Stripe/爱发电", "Tally/金数据"],
        "estimated_cost": "¥0-500",
        "estimated_days": 7,
        "raw_quotes": quotes,
    }

def enrich(input_file, output_file=None):
    scored = json.loads(Path(input_file).read_text(encoding="utf-8"))
    for p in scored:
        p["mvp"] = design_mvp(p)
    out = output_file or input_file.replace(".json", "_mvp.json")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(scored, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 已保存 → {out}")
    return scored

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output")
    args = p.parse_args()
    enrich(args.input, args.output)
