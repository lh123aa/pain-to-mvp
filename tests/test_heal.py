"""自愈系统必须"诚实"：只诊断报告，不假修、不自动推送、不伪造状态。"""
import json
from pathlib import Path

import scripts.healing.heal_runner as heal_runner


def _seed_bug(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "bug_id": "bug-test-001", "timestamp": "2026-10-11T00:00:00",
        "phase": "Phase 4", "tool": "bilibili", "severity": "medium",
        "error": "timeout", "status": "open",
    }) + "\n", encoding="utf-8")


def test_heal_does_not_touch_git(tmp_path, monkeypatch):
    _seed_bug(tmp_path / "bug-log.jsonl")
    monkeypatch.setattr(heal_runner, "BUG_LOG", tmp_path / "bug-log.jsonl")
    monkeypatch.setattr(heal_runner, "BUG_INDEX", tmp_path / "bug-index.json")
    monkeypatch.setattr(heal_runner, "HEAL_REPORT", tmp_path / "heal-report.md")
    calls = []
    monkeypatch.setattr(heal_runner.subprocess, "run",
                        lambda *a, **k: calls.append(a) or None)
    heal_runner.heal()
    assert calls == [], "heal 不得调用任何外部命令（尤其是 git）"


def test_heal_does_not_fake_fixed_status(tmp_path, monkeypatch):
    log = tmp_path / "bug-log.jsonl"
    _seed_bug(log)
    monkeypatch.setattr(heal_runner, "BUG_LOG", log)
    monkeypatch.setattr(heal_runner, "BUG_INDEX", tmp_path / "bug-index.json")
    monkeypatch.setattr(heal_runner, "HEAL_REPORT", tmp_path / "heal-report.md")
    heal_runner.heal()
    # 重新读文件：open 状态必须保持 open（不被标记为 fixed）
    bugs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert all(b["status"] == "open" for b in bugs)
    assert (tmp_path / "heal-report.md").exists(), "应产出诊断报告"
