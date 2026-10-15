# -*- coding: utf-8 -*-
"""Workflow 处置守卫：自优化类 workflow 不得回到定时自动推送（OPEN_ISSUES #14）。

PRD §三（Q3）决策「自优化不投入」：daily-audit 原 cron + auto commit&push 与之冲突，
2026-10-15 处置为仅 workflow_dispatch + artifact 上传。本测试守住该决定。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"


def test_daily_audit_is_manual_only():
    text = (WORKFLOWS / "daily-audit.yml").read_text(encoding="utf-8")
    assert "schedule" not in text, "daily-audit 不得恢复定时触发（与自优化不投入冲突）"
    assert "workflow_dispatch" in text, "应保留手动触发能力"
    assert "git push" not in text, "审计结果不得自动推送（改 artifact 上传）"


def test_self_heal_stays_manual():
    text = (WORKFLOWS / "self-heal.yml").read_text(encoding="utf-8")
    assert "schedule" not in text, "self-heal 不得恢复定时触发"
    assert "git push" not in text, "自愈不得自动推送"
