"""护栏：apply_fixes 的 overlay 源必须包含关键修复标记。

背景（C1）：extract_generators.py 以仓库外的 MVP.md 为准重新提取
generate_p*.py，会把改在模板里的修复（bilibili WBI、demo.py）打回原形。
因此这两个文件的修复必须走 apply_fixes overlay（extract 无关性）。
本测试守住这条链：overlay 源存在且含关键标记。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXES = ROOT / "generators" / "fixes"


def test_bilibili_overlay_source_has_wbi_fix():
    src = (FIXES / "bilibili.py").read_text(encoding="utf-8")
    assert "wbi/search/type" in src, "overlay 源缺少 WBI 搜索端点"
    assert "v_voucher" in src, "overlay 源缺少风控识别"
    assert "cursor" in src, "overlay 源缺少游标分页"
    assert "from ..compliance" not in src, "overlay 源仍是会崩的旧导入风格"


def test_demo_overlay_source_has_eager_glob_fix():
    src = (FIXES / "demo.py").read_text(encoding="utf-8")
    assert "sorted((" not in src or "latest(" in src, "overlay 源疑似回退到 eager glob"
    assert "def latest(" in src, "overlay 源缺少顺序执行修复"


def test_apply_fixes_copies_both_overlays():
    src = (ROOT / "generators" / "apply_fixes.py").read_text(encoding="utf-8")
    assert "fix_bilibili" in src, "apply_fixes 未接线 bilibili overlay"
    assert "fix_demo" in src, "apply_fixes 未接线 demo overlay"
    assert "wbi/search/type" in src, "apply_fixes 缺少生成后断言"


def test_extract_warns_on_template_fix_overwrite():
    """extract 必须警告模板修复将被覆盖（MVP.md 在仓库外，冷启动后必踩）。"""
    src = (ROOT / "generators" / "extract_generators.py").read_text(encoding="utf-8")
    assert "覆盖" in src or "警告" in src or "warn" in src.lower(), \
        "extract_generators.py 缺少模板修复覆盖警告"
