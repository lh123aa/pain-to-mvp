# -*- coding: utf-8 -*-
"""B站适配器传输层：优先 Scrapling（TLS 指纹伪装，降 v_voucher 风控概率），
缺依赖时回退 requests。合规逻辑（WBI 签名 / v_voucher 不绕过）两条路径共用。"""
import json
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "pipeline"))


def _adapter():
    import adapters.bilibili as bili
    return bili


def _fake_response(payload):
    resp = mock.Mock()
    resp.json.return_value = payload
    return resp


def test_prefers_scrapling_when_available():
    bili = _adapter()
    adapter = bili.BilibiliAdapter()
    adapter._img_key, adapter._sub_key = "i", "s"  # 跳过 nav
    payload = {"code": 0, "data": {"result": []}}
    with mock.patch.object(bili, "_SCRAPLING", mock.Mock(get=mock.Mock(return_value=_fake_response(payload)))) as fake:
        with mock.patch.object(adapter.session, "get") as session_get:
            adapter._get("https://example.com/api", {"a": 1})
    assert fake.get.called, "有 Scrapling 时必须走 Scrapling"
    assert not session_get.called, "有 Scrapling 时不应再走 requests"


def test_falls_back_to_requests_without_scrapling():
    bili = _adapter()
    adapter = bili.BilibiliAdapter()
    adapter._img_key, adapter._sub_key = "i", "s"
    payload = {"code": 0, "data": {}}
    with mock.patch.object(bili, "_SCRAPLING", None):
        with mock.patch.object(adapter.session, "get", return_value=_fake_response(payload)) as session_get:
            adapter._get("https://example.com/api", {"a": 1})
    assert session_get.called, "无 Scrapling 时必须回退 requests"


def test_v_voucher_still_blocks_on_scrapling_path():
    """换传输层不改变合规行为：v_voucher 依然明确报错不绕过。"""
    bili = _adapter()
    adapter = bili.BilibiliAdapter()
    adapter._img_key, adapter._sub_key = "i", "s"
    payload = {"code": 0, "data": {"v_voucher": "verify"}}
    with mock.patch.object(bili, "_SCRAPLING", mock.Mock(get=mock.Mock(return_value=_fake_response(payload)))):
        try:
            adapter._get("https://example.com/api", {})
            raised = False
        except RuntimeError as e:
            raised = True
            assert "不绕过" in str(e)
    assert raised, "v_voucher 必须抛错"


def test_module_imports_cleanly_without_scrapling():
    """scrapling 完全缺失时模块仍可导入（requests 路径兜底）。

    用 subprocess 隔离：在主进程 pop sys.modules 会替换模块对象，
    导致其他测试持有的类引用与 discover_content 缓存失效（顺序依赖假失败）。
    """
    import subprocess

    code = (
        "import sys\n"
        "sys.path.insert(0, 'scripts/pipeline')\n"
        "sys.modules['scrapling'] = None  # None → import 时抛 ImportError，等效未安装\n"
        "import adapters.bilibili as b\n"
        "assert b._SCRAPLING is None, '缺依赖时 _SCRAPLING 必须为 None'\n"
        "print('OK')\n"
    )
    r = subprocess.run([sys.executable, "-c", code],
                       capture_output=True, text=True,
                       cwd=str(Path(__file__).resolve().parents[1]), timeout=60)
    assert r.returncode == 0, r.stderr[-500:]
    assert "OK" in r.stdout
