"""Dashboard 静态资源必须防路径穿越 + %xx 解码（OPEN_ISSUES #13）。"""
from urllib.parse import quote

import scripts.dashboard.serve as serve
from scripts.dashboard.serve import resolve_asset


def test_traversal_rejected():
    assert resolve_asset("../MVP.md") is None
    assert resolve_asset("../../etc/passwd") is None
    assert resolve_asset("/../scripts/doctor.py") is None


def test_normal_ok():
    assert resolve_asset("app.js") is not None
    assert resolve_asset("index.html") is not None


def test_percent_encoded_chinese_name_resolves(tmp_path, monkeypatch):
    """中文资源名以 %xx 到达必须解码后命中文件（OPEN_ISSUES #13）。"""
    target = tmp_path / "测试样式.css"
    target.write_text("body{}", encoding="utf-8")
    monkeypatch.setattr(serve, "ASSETS", tmp_path)
    assert resolve_asset(quote("测试样式.css")) == target.resolve()


def test_percent_encoded_traversal_rejected():
    """解码必须先于边界检查：%2e%2e%2f 同样不得越界。"""
    assert resolve_asset("%2e%2e/MVP.md") is None
    assert resolve_asset("..%2fMVP.md") is None
    assert resolve_asset(quote("../MVP.md")) is None
