"""离线全流程验证：demo.py 必须无网络跑通并产出卡片。"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_demo_offline_pipeline_exit_zero_and_cards():
    r = subprocess.run(
        [sys.executable, "scripts/demo.py"],
        cwd=ROOT, capture_output=True, text=True, timeout=600,
    )
    assert r.returncode == 0, (r.stdout[-800:] + "\n" + r.stderr[-800:])
    cards = list((ROOT / "data" / "cards").glob("*.md"))
    assert cards, "demo 未产出机会卡片"
