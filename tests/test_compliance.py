"""合规检查：robots fail-close（PRD §4.1 / OPEN_ISSUES #1）。"""
from urllib.robotparser import RobotFileParser

import pytest

from scripts.pipeline import compliance


def test_robots_unreachable_denies(monkeypatch):
    """robots.txt 读取失败必须拒绝抓取（fail-close；当前 RED: allow_all=True 放行）"""
    compliance._cache.clear()
    monkeypatch.setattr(RobotFileParser, "read",
                        lambda self: (_ for _ in ()).throw(OSError("network down")))
    assert compliance.check_robots("https://failclose-test.example.com/x") is False


def test_robots_cached_result_used(monkeypatch):
    """读取失败的结果同样进缓存：二次检查不再发起读取且维持拒绝"""
    compliance._cache.clear()
    calls = {"n": 0}

    def boom(self):
        calls["n"] += 1
        raise OSError("network down")

    monkeypatch.setattr(RobotFileParser, "read", boom)
    url = "https://failclose-cache.example.com/y"
    assert compliance.check_robots(url) is False
    assert compliance.check_robots(url) is False
    assert calls["n"] == 1


def test_robots_allowed_site_still_passes(monkeypatch):
    """正常可达且允许的站点不受 fail-close 影响"""
    compliance._cache.clear()

    def fake_read(self):
        self.parse(["User-agent: *", "Allow: /"])

    monkeypatch.setattr(RobotFileParser, "read", fake_read)
    assert compliance.check_robots("https://ok-site.example.com/page") is True
