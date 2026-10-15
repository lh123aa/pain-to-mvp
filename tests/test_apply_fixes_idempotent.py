"""apply_fixes 幂等冒烟：在已修复的树上重跑必须是纯操作。

历史上三次补丁标记写错（`inputs=None):` 误命中、`collect_raw_files` 撞 import、
f-string `}` 遗漏）都是"重跑才炸/静默回退"。本测试把这类回归拉到台面上：
跑完 apply_fixes，所有受管文件 hash 必须不变。

OPEN_ISSUES #27 长期解：在工作区副本（workspace_clone fixture）上跑，
不再碰真实工作区——apply_fixes 末尾 copy_canonical_modules() 会用
generators/fixes/ 覆盖 canonical 4 文件，在真实树上跑测试曾静默回退未同步的改动。
"""
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MANAGED = [
    "scripts/pipeline/discover_content.py", "scripts/pipeline/run_all.py",
    "scripts/e2e_test.py", "scripts/pipeline/mine_pain_points.py",
    "scripts/pipeline/cluster.py", "scripts/pipeline/score_opportunity.py",
    "scripts/pipeline/export_card.py", "scripts/dashboard/serve.py",
    "scripts/pipeline/storage.py", "scripts/pipeline/adapters/bilibili.py",
    "scripts/demo.py", "scripts/healing/heal_runner.py",
    "scripts/pipeline/encoding.py", "scripts/pipeline/run_inputs.py",
    "scripts/pipeline/wbi.py", ".github/workflows/self-heal.yml",
    "scripts/pipeline/design_mvp.py", "scripts/pipeline/exec_report.py",
]


def _snapshot(base: Path) -> dict:
    snap = {}
    for rel in MANAGED:
        p = base / rel
        if p.exists():
            snap[rel] = hashlib.md5(p.read_bytes()).hexdigest()
    return snap


def test_apply_fixes_pure_rerun_on_fixed_tree(workspace_clone):
    # 子进程跑副本内的 apply_fixes.py：其 ROOT = 副本根，真实工作区不受影响
    before = _snapshot(workspace_clone)
    r = subprocess.run(
        [sys.executable, str(workspace_clone / "generators" / "apply_fixes.py")],
        capture_output=True, text=True, cwd=str(workspace_clone), timeout=300)
    assert r.returncode == 0, r.stderr[-500:]
    after = _snapshot(workspace_clone)

    changed = {k for k in before if before[k] != after.get(k)}
    assert not changed, f"重跑 apply_fixes 改动了已修复文件：{changed}"


def test_canonical_four_match_fixes_overlays():
    """canonical 4 文件必须与 generators/fixes/ 权威副本字节一致。

    这是 RK-0001 回退陷阱的响亮护栏：与其在真实树上跑 apply_fixes 静默
    覆盖，不如直接断言"没忘同步"——忘了同步在这里红，而不是丢工作。
    """
    for name in ("cluster.py", "mine_pain_points.py",
                 "score_opportunity.py", "export_card.py"):
        ws = (ROOT / "scripts" / "pipeline" / name).read_bytes()
        fx = (ROOT / "generators" / "fixes" / name).read_bytes()
        assert ws == fx, (
            f"{name} 与 generators/fixes/ 不一致——改 canonical 后忘了同步权威副本"
            "（RK-0001：先同步 fixes/ 再提交）")
