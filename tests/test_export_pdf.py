# -*- coding: utf-8 -*-
"""T8：PDF 导出脚本（scripts/export_pdf.py）测试（不实际启动浏览器）。"""
from pathlib import Path

import export_pdf

ROOT = Path(__file__).resolve().parents[1]


def test_resolve_targets_found_and_missing():
    files, missing = export_pdf.resolve_targets(["001-backend-miniprogram"])
    assert missing == []
    assert files and files[0].name == "001-backend-miniprogram.html"

    files2, missing2 = export_pdf.resolve_targets(["nope-xyz"])
    assert files2 == []
    assert missing2 == ["nope-xyz"]


def test_resolve_targets_accepts_html_filename_and_dedups():
    files, missing = export_pdf.resolve_targets(
        ["service.html", "docs/service.html", "service"]
    )
    assert missing == []
    assert len(files) == 1  # 三种写法指向同一文件


def test_dry_run_lists_backend_and_pairs(capsys):
    rc = export_pdf.main(["--all", "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "backend:" in out
    for name in ("001-backend-miniprogram.html", "first-order-deliverable.html", "service.html"):
        assert name in out


def test_dry_run_missing_target_is_reported(capsys):
    rc = export_pdf.main(["nope-xyz", "--dry-run"])
    captured = capsys.readouterr()
    assert rc == 1
    assert "nope-xyz" in captured.err
