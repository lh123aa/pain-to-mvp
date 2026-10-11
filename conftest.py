"""pytest 全局路径配置：生成的 pipeline 脚本使用"脚本直跑式"导入
（`from adapters import ...`、`from preprocess import ...`），测试中需要
把脚本目录加入 sys.path 才能 import 它们。
"""
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
for p in (str(ROOT / "scripts"), str(ROOT / "scripts" / "pipeline")):
    if p not in sys.path:
        sys.path.insert(0, p)

# 测试会写真实 data/（demo 子进程用绝对 ROOT）——session 级快照，跑完还原，
# 避免测试静默覆盖用户当天真实产出的卡片/dashboard（评审 I3）。
_DATA_DIRS = ["cards", "discovered", "pains", "scored", "raw", "bugs",
              "demo", "executions", "journeys", "tool_audit"]
_DATA_FILES = ["dashboard.json", "pain_to_mvp.db", "toolkit.json",
               "tool_discovery.jsonl", "tool_eval.json", "optimization_suggestions.json",
               "heal-report.md"]


@pytest.fixture(scope="session", autouse=True)
def _restore_data_after_tests():
    backup = Path(tempfile.mkdtemp(prefix="pain-mvp-backup-"))
    data_root = ROOT / "data"

    def _snapshot():
        for rel in _DATA_DIRS:
            src = data_root / rel
            if src.is_dir():
                dst = backup / rel
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.copytree(src, dst)
        for rel in _DATA_FILES:
            src = data_root / rel
            if src.is_file():
                dst = backup / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)

    _snapshot()
    yield
    for rel in _DATA_DIRS:
        target = data_root / rel
        if target.exists():
            shutil.rmtree(target)
        src = backup / rel
        if src.exists():
            shutil.copytree(src, target)
    for rel in _DATA_FILES:
        target = data_root / rel
        if target.exists():
            target.unlink()
        src = backup / rel
        if src.exists():
            shutil.copy2(src, target)
    shutil.rmtree(backup, ignore_errors=True)

