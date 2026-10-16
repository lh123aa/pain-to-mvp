"""OPEN_ISSUES #30 e2e 假成功退出码：_report 无返回值、早退路径直接 return，
任何失败（discover 崩 / 未找到评论数据 / 步骤 ❌）进程都 exit 0。

真实事故（2026-10-16 A4 稳定性第 2 轮）：crawl 后无评论数据 → fail-fast 停在
2 步，e2e 仍打印报告 EXIT=0 —— 与 #28 同类的"失败假装成功"（PRD 底线：不许骗人）。

修复：_report 返回"是否完整成功"（步数 >= expected 且全步骤 ok），
main 所有路径返回该布尔值，__main__ 传播为退出码。
"""
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

import e2e_test as e2e  # noqa: E402


def _steps(*names_ok):
    return [(n, ok, 0.1) for n, ok in names_ok]


ALL6 = ("discover", "crawl", "mine", "score", "mvp", "export")


def test_report_returns_true_only_when_all_six_steps_ok():
    ok = e2e._report(_steps(*[(n, True) for n in ALL6]), 0.6)
    assert ok is True, "6 步全成功 → _report 应返回 True"


def test_report_returns_false_on_failed_step():
    steps = [(n, n != "crawl", 0.1) for n in ALL6]
    assert e2e._report(steps, 0.6) is False, "任一步骤失败 → 必须 False"


def test_report_returns_false_when_steps_incomplete():
    """早退路径（如"未找到评论数据"）步数不足 → False → exit 1。"""
    assert e2e._report(_steps(("discover", True)), 0.1) is False
    assert e2e._report(_steps(("discover", True), ("crawl", True)), 0.2) is False


def test_report_skip_crawl_five_steps_ok():
    five = ("discover", "mine", "score", "mvp", "export")
    assert e2e._report(_steps(*[(n, True) for n in five]), 0.5,
                       expected=5) is True


def test_main_discover_failure_returns_false(monkeypatch):
    """discover 步骤失败 → main 返回 False（__main__ 转 exit 1）。"""
    monkeypatch.setattr(e2e, "run", lambda cmd, desc: (False, 0.0))
    args = SimpleNamespace(keyword="x", platform="bilibili", limit=1,
                           comments=1, skip_crawl=False)
    assert e2e.main(args) is False


def test_main_missing_discovered_returns_false(monkeypatch, tmp_path):
    """discover 退出码 0 但没产出文件 → 早退 → False（步数不足）。"""
    monkeypatch.setattr(e2e, "run", lambda cmd, desc: (True, 0.1))
    monkeypatch.setattr(e2e, "ROOT", tmp_path)  # 空 discovered 目录
    args = SimpleNamespace(keyword="x", platform="bilibili", limit=1,
                           comments=1, skip_crawl=False)
    assert e2e.main(args) is False


def test_exit_code_wired_in_main_guard():
    """__main__ 必须把 main() 的布尔结果传播为进程退出码。"""
    src = (ROOT / "scripts" / "e2e_test.py").read_text(encoding="utf-8")
    assert "raise SystemExit(0 if main(args) else 1)" in src, \
        "__main__ 未传播退出码——失败仍在假装成功（#30）"
