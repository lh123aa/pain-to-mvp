"""python-dotenv 接线（OPEN_ISSUES #10 / PRD §七）：
统一 load_dotenv 入口：仓库根 .env 存在即加载，shell 环境变量优先级更高（不覆盖已有值）。
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from env_loader import load_env


def test_load_env_reads_repo_root_env(tmp_path, monkeypatch):
    """仓库根 .env 的键进入 os.environ"""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("BILI_SESSDATA=abc123\n", encoding="utf-8")
    loaded = load_env(root=tmp_path)
    assert loaded is True
    assert os.environ.get("BILI_SESSDATA") == "abc123"


def test_env_does_not_override_shell(tmp_path, monkeypatch):
    """shell 已设置的环境变量不被 .env 覆盖（12-factor：环境优先）"""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("BILI_SESSDATA", "from_shell")
    (tmp_path / ".env").write_text("BILI_SESSDATA=from_file\n", encoding="utf-8")
    load_env(root=tmp_path)
    assert os.environ["BILI_SESSDATA"] == "from_shell"


def test_missing_env_file_is_noop(tmp_path, monkeypatch):
    """无 .env 时不报错、不加载（fail-safe，凭证可继续走 shell 变量）"""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("BILI_SESSDATA", raising=False)
    loaded = load_env(root=tmp_path)
    assert loaded is False
    assert "BILI_SESSDATA" not in os.environ
