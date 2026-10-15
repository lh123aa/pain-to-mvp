"""apply_fixes 幂等冒烟：在已修复的树上重跑必须是纯操作。

历史上三次补丁标记写错（`inputs=None):` 误命中、`collect_raw_files` 撞 import、
f-string `}` 遗漏）都是"重跑才炸/静默回退"。本测试把这类回归拉到台面上：
跑完 apply_fixes，所有受管文件 hash 必须不变。
"""
import hashlib
import importlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _snapshot() -> dict:
    snap = {}
    for rel in [
        "scripts/pipeline/discover_content.py", "scripts/pipeline/run_all.py",
        "scripts/e2e_test.py", "scripts/pipeline/mine_pain_points.py",
        "scripts/pipeline/cluster.py", "scripts/pipeline/score_opportunity.py",
        "scripts/pipeline/export_card.py", "scripts/dashboard/serve.py",
        "scripts/pipeline/storage.py", "scripts/pipeline/adapters/bilibili.py",
        "scripts/demo.py", "scripts/healing/heal_runner.py",
        "scripts/pipeline/encoding.py", "scripts/pipeline/run_inputs.py",
        "scripts/pipeline/wbi.py", ".github/workflows/self-heal.yml",
    ]:
        p = ROOT / rel
        if p.exists():
            snap[rel] = hashlib.md5(p.read_bytes()).hexdigest()
    return snap


def test_apply_fixes_pure_rerun_on_fixed_tree():
    import sys
    sys.path.insert(0, str(ROOT / "generators"))
    apply_fixes = importlib.import_module("apply_fixes")

    before = _snapshot()
    apply_fixes.main()  # 不得抛 SystemExit（marker 未命中会在这里炸）
    after = _snapshot()

    changed = {k for k in before if before[k] != after.get(k)}
    assert not changed, f"重跑 apply_fixes 改动了已修复文件：{changed}"
