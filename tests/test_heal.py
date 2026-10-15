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
    # heal_runner 不得持有 subprocess：死导入已清除（OPEN_ISSUES #15），
    # 无外部命令通道即不可能调 git。
    import subprocess
    calls = []
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: calls.append(a) or None)
    heal_runner.heal()
    assert calls == [], "heal 不得调用任何外部命令（尤其是 git）"
    assert not hasattr(heal_runner, "subprocess"), "heal_runner 残留 subprocess 死导入"


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


def test_load_bugs_skips_corrupt_lines(tmp_path, monkeypatch):
    """坏行跳过：一条损坏记录不得炸掉整份诊断（OPEN_ISSUES #15）。"""
    log = tmp_path / "bug-log.jsonl"
    _seed_bug(log)
    with open(log, "a", encoding="utf-8") as f:
        f.write('{"bug_id": "truncated", "error": \n')   # 半截 JSON
        f.write("not json at all\n")                      # 纯垃圾行
        f.write("\n")                                     # 空行
        f.write(json.dumps({
            "bug_id": "bug-test-002", "timestamp": "2026-10-11T01:00:00",
            "phase": "Phase 5", "tool": "xiaohongshu", "severity": "low",
            "error": "404 not found", "status": "open",
        }) + "\n")
    monkeypatch.setattr(heal_runner, "BUG_LOG", log)
    monkeypatch.setattr(heal_runner, "BUG_INDEX", tmp_path / "bug-index.json")
    monkeypatch.setattr(heal_runner, "HEAL_REPORT", tmp_path / "heal-report.md")
    bugs = heal_runner.load_bugs()
    assert [b["bug_id"] for b in bugs] == ["bug-test-001", "bug-test-002"], (
        "坏行应被跳过、好行应保留")
    heal_runner.heal()  # 整链不得因坏行崩溃
    assert (tmp_path / "heal-report.md").exists()
