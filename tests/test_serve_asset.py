"""Dashboard 静态资源必须防路径穿越。"""
from scripts.dashboard.serve import resolve_asset


def test_traversal_rejected():
    assert resolve_asset("../MVP.md") is None
    assert resolve_asset("../../etc/passwd") is None
    assert resolve_asset("/../scripts/doctor.py") is None


def test_normal_ok():
    assert resolve_asset("app.js") is not None
    assert resolve_asset("index.html") is not None
