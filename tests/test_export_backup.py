# -*- coding: utf-8 -*-
"""T9：数据主权导出（scripts/export_backup.py）测试。"""
import zipfile
from pathlib import Path

import export_backup as eb


def _seed(root: Path):
    (root / "cards").mkdir(parents=True)
    (root / "cards" / "20261016-001.md").write_text("卡内容", encoding="utf-8")
    (root / "calibration").mkdir()
    (root / "calibration" / "calibration.jsonl").write_text(
        '{"card_id": "x"}\n', encoding="utf-8")
    (root / "dashboard.json").write_text('{"ok": true}', encoding="utf-8")


def _rewrite(zip_path: Path, mutate):
    """重建 zip（同 manifest，替换/删除条目）用于模拟篡改。"""
    with zipfile.ZipFile(zip_path) as zf:
        items = {i.filename: zf.read(i.filename) for i in zf.infolist()}
    mutate(items)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in items.items():
            zf.writestr(name, data)


def test_create_and_verify_roundtrip(tmp_path):
    data = tmp_path / "data"
    _seed(data)
    out = tmp_path / "bk.zip"
    manifest = eb.create_backup(data, out)
    assert out.exists()
    assert set(manifest["files"]) == {
        "cards/20261016-001.md", "calibration/calibration.jsonl", "dashboard.json"}
    assert manifest["format"] == "pain-to-mvp-backup/1"
    result = eb.verify_backup(out)
    assert result["ok"] is True and result["checked"] == 3


def test_empty_data_refused(tmp_path):
    empty = tmp_path / "data"
    empty.mkdir()
    try:
        eb.create_backup(empty, tmp_path / "bk.zip")
        raise AssertionError("空目录应拒绝打包")
    except ValueError as exc:
        assert "没有可打包" in str(exc)


def test_verify_detects_tampering_and_missing(tmp_path):
    data = tmp_path / "data"
    _seed(data)
    out = tmp_path / "bk.zip"
    eb.create_backup(data, out)

    _rewrite(out, lambda items: items.update({"dashboard.json": b'{"ok": false}'}))
    result = eb.verify_backup(out)
    assert result["ok"] is False
    assert any("校验不符" in p for p in result["problems"])

    _rewrite(out, lambda items: items.pop("cards/20261016-001.md", None))
    result2 = eb.verify_backup(out)
    assert any("缺文件" in p for p in result2["problems"])


def test_verify_detects_extra_file_and_no_manifest(tmp_path):
    data = tmp_path / "data"
    _seed(data)
    out = tmp_path / "bk.zip"
    eb.create_backup(data, out)
    _rewrite(out, lambda items: items.update({"sneaky.txt": b"hi"}))
    assert any("清单外" in p for p in eb.verify_backup(out)["problems"])

    bare = tmp_path / "bare.zip"
    with zipfile.ZipFile(bare, "w") as zf:
        zf.writestr("a.txt", "x")
    r = eb.verify_backup(bare)
    assert r["ok"] is False and r["problems"] == ["缺 manifest.json"]


def test_restore_roundtrip_and_guards(tmp_path):
    data = tmp_path / "data"
    _seed(data)
    out = tmp_path / "bk.zip"
    eb.create_backup(data, out)

    dest = tmp_path / "restored"
    assert eb.restore_backup(out, dest) == 3
    assert (dest / "cards" / "20261016-001.md").read_text(encoding="utf-8") == "卡内容"

    try:
        eb.restore_backup(out, dest)
        raise AssertionError("非空目录应拒绝（不带 --force）")
    except ValueError as exc:
        assert "非空" in str(exc)

    assert eb.restore_backup(out, dest, force=True) == 3

    bad = tmp_path / "bad.zip"
    eb.create_backup(data, bad)
    _rewrite(bad, lambda items: items.update({"dashboard.json": b"{}"}))
    try:
        eb.restore_backup(bad, tmp_path / "dest2")
        raise AssertionError("校验失败的备份应拒绝恢复")
    except ValueError as exc:
        assert "校验失败" in str(exc)


def test_cli_create_verify_restore(tmp_path, capsys):
    data = tmp_path / "data"
    _seed(data)
    out = tmp_path / "bk.zip"
    assert eb.main(["create", "--data", str(data), "-o", str(out)]) == 0
    assert "已打包" in capsys.readouterr().out

    assert eb.main(["verify", str(out)]) == 0
    assert "校验通过" in capsys.readouterr().out

    dest = tmp_path / "rt"
    assert eb.main(["restore", str(out), "--to", str(dest)]) == 0
    assert "已恢复" in capsys.readouterr().out
    assert (dest / "dashboard.json").exists()
