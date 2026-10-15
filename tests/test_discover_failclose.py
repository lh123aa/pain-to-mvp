# -*- coding: utf-8 -*-
"""discover fail-close：全部平台失败必须退出非 0，不得写空文件假装成功（NFR 4.1）。

P6 重验首轮发现（2026-10-15）：B站 v_voucher 风控时 discover 捕获异常、
打印 ❌ 后仍 exit 0 并保存空 [] → e2e Step 1 判 ✅ 继续跑 → 真正的失败
被推到 crawl 步误报为"未找到评论数据"。失败必须在源头以退出码说话。
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))
sys.path.insert(0, str(ROOT / "generators"))

import apply_fixes  # noqa: E402
import discover_content  # noqa: E402

GENERATORS = ROOT / "generators"


class _BoomAdapter:
    """模拟 v_voucher 风控：discover 抛异常。"""
    def is_available(self):
        return True

    def discover(self, keyword, limit=10):
        raise RuntimeError("B站风控人机验证（v_voucher）")


class _OkAdapter:
    def is_available(self):
        return True

    def discover(self, keyword, limit=10):
        return [{"video_id": "v1", "platform": "bilibili",
                 "title": "独立开发者如何获客", "comment_count": 50,
                 "url": "https://bilibili.com/video/BV1"}]


class _UnavailableAdapter:
    def is_available(self):
        return False

    def discover(self, keyword, limit=10):
        raise AssertionError("不可用适配器不应被调用")


def _run(tmp_path, monkeypatch, adapter_factory, platforms=("bilibili",)):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(discover_content, "get_adapter", adapter_factory)
    with pytest.raises(SystemExit) as exc:
        discover_content.discover("独立开发者", list(platforms), limit=5)
    return exc.value.code


def test_all_platforms_fail_exits_nonzero(tmp_path, monkeypatch):
    """全部平台异常（如 v_voucher 风控）→ 退出非 0（OPEN_ISSUES P6 重验缺陷1）。"""
    code = _run(tmp_path, monkeypatch, lambda p: _BoomAdapter())
    assert code != 0, "全平台失败却 exit 0——空 [] 文件会被下游当成功"


def test_failclose_message_mentions_platform(tmp_path, monkeypatch, capsys):
    """报错必须点名失败平台，可行动（对齐风控处置指引）。"""
    _run(tmp_path, monkeypatch, lambda p: _BoomAdapter())
    out = capsys.readouterr().out
    assert "bilibili" in out, f"失败信息应含平台名，实际：{out}"


def test_success_not_blocked(tmp_path, monkeypatch):
    """有真实产出时正常返回，不受 fail-close 影响。"""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(discover_content, "get_adapter", lambda p: _OkAdapter())
    ranked = discover_content.discover("独立开发者", ["bilibili"], limit=5)
    assert len(ranked) == 1


def test_mixed_partial_success_not_blocked(tmp_path, monkeypatch):
    """多平台一成一败：有产出 → 不中断（只在零产出时 fail-close）。"""
    monkeypatch.chdir(tmp_path)

    def factory(p):
        return _OkAdapter() if p == "bilibili" else _BoomAdapter()

    monkeypatch.setattr(discover_content, "get_adapter", factory)
    ranked = discover_content.discover("x", ["bilibili", "reddit"], limit=5)
    assert len(ranked) == 1


def test_unavailable_adapter_not_treated_as_hard_fail(tmp_path, monkeypatch):
    """适配器不可用（依赖未装）是配置态非链路故障：全部不可用且零产出
    时也应 fail-close——否则 e2e 同样拿到空文件假成功。"""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(discover_content, "get_adapter", lambda p: _UnavailableAdapter())
    with pytest.raises(SystemExit) as exc:
        discover_content.discover("x", ["reddit"], limit=5)
    assert exc.value.code != 0


# ---------- overlay 恢复（防 extract 重新提取打回模板） ----------

def _template_discover_source() -> str:
    """从 generate_p2.py 模板提取 discover 源码段（imports → return ranked）。"""
    tpl = (GENERATORS / "generate_p2.py").read_text(encoding="utf-8")
    defpos = tpl.index("def discover(keyword, platforms, limit):")
    start = tpl.rindex("import argparse", 0, defpos)
    end = tpl.index("    return ranked", defpos) + len("    return ranked")
    return tpl[start:end]


def test_fix_discover_failclose_recovers_template(tmp_path):
    """extract 重新提取模板（无 fail-close）后，apply_fixes overlay 必须恢复到
    工作区语义，且重跑是纯操作。"""
    p = tmp_path / "discover_content.py"
    p.write_text(_template_discover_source(), encoding="utf-8")
    assert "sys.exit" not in p.read_text(encoding="utf-8"), "前提：模板态无 fail-close"

    apply_fixes.fix_discover_failclose(p)
    out = p.read_text(encoding="utf-8")
    assert "import sys\nfrom datetime import datetime" in out, "overlay 未补 import sys"
    assert "unavailable.append(p)" in out
    assert "failed.append(p)" in out
    assert "fail-close 退出非 0" in out and "sys.exit(1)" in out, "overlay 未补 fail-close 块"

    apply_fixes.fix_discover_failclose(p)  # 幂等
    assert p.read_text(encoding="utf-8") == out, "重跑 overlay 改动了已修复文件（不幂等）"


def test_workspace_discover_has_all_failclose_markers():
    """工作区 discover 必须含全部 overlay marker——防止改回模板态被静默接受。"""
    src = (ROOT / "scripts" / "pipeline" / "discover_content.py").read_text(encoding="utf-8")
    for m in ("import sys", "unavailable.append(p)", "failed.append(p)",
              "fail-close 退出非 0"):
        assert m in src, f"工作区 discover 缺少 {m!r}——疑似被生成器打回模板态"
