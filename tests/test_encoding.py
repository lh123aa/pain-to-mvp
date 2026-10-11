"""入口脚本必须能在非 UTF-8（cp936）Windows 控制台下运行，不因 emoji 崩溃。"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_ensure_utf8_reconfigures():
    from scripts.pipeline.encoding import ensure_utf8
    ensure_utf8()
    assert sys.stdout.encoding.lower().replace("-", "") == "utf8"


def test_entry_survives_cp936():
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "cp936"
    r = subprocess.run(
        [sys.executable, "scripts/doctor.py"],
        env=env, capture_output=True, cwd=ROOT,
    )
    assert r.returncode == 0, r.stderr.decode("utf8", "ignore")[:300]
