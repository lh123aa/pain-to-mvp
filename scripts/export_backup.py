#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据主权导出：一键打包 / 校验 / 恢复项目数据（T9）。

定位：数据可迁移、可校验、可恢复——不锁死在工具里（「数据主权」承诺的落地工具）。
打包内容：data/ 全量（卡片 / 校准 / dashboard / 数据库 / 原始产物），
附 manifest.json（逐文件 sha256 + 大小 + 格式版本）；恢复前强制先校验。

用法：
  python scripts/export_backup.py create [-o 文件名.zip] [--data data]
  python scripts/export_backup.py verify 备份.zip
  python scripts/export_backup.py restore 备份.zip [--to 目标目录] [--force]

零依赖（zipfile / hashlib / json，纯标准库）；自动跳过 __pycache__。
"""
import argparse
import hashlib
import json
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORMAT = "pain-to-mvp-backup/1"
SKIP_PARTS = {"__pycache__"}


def _iter_files(root: Path):
    for p in sorted(root.rglob("*")):
        if p.is_file() and not any(part in SKIP_PARTS for part in p.parts):
            yield p


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def create_backup(data_root: Path, out_zip: Path) -> dict:
    """把 data_root 全量打包到 out_zip；返回 manifest。空目录拒绝打包。"""
    data_root, out_zip = Path(data_root), Path(out_zip)
    files = list(_iter_files(data_root)) if data_root.is_dir() else []
    if not files:
        raise ValueError(f"没有可打包的文件：{data_root} 不存在或为空")
    manifest = {
        "format": FORMAT,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "files": {},
    }
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in files:
            rel = p.relative_to(data_root).as_posix()
            zf.write(p, arcname=rel)
            manifest["files"][rel] = {"sha256": _sha256_file(p), "size": p.stat().st_size}
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return manifest


def verify_backup(zip_path: Path) -> dict:
    """逐文件校验 sha256；返回 {ok, checked, problems}。"""
    problems = []
    checked = 0
    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        if "manifest.json" not in names:
            return {"ok": False, "checked": 0, "problems": ["缺 manifest.json"]}
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        expected = manifest.get("files", {})
        for rel, meta in expected.items():
            if rel not in names:
                problems.append(f"缺文件：{rel}")
                continue
            if _sha256_bytes(zf.read(rel)) != meta.get("sha256"):
                problems.append(f"校验不符：{rel}")
            else:
                checked += 1
        for rel in sorted(names - set(expected) - {"manifest.json"}):
            problems.append(f"清单外文件：{rel}")
    return {"ok": not problems, "checked": checked, "problems": problems}


def restore_backup(zip_path: Path, dest: Path, force: bool = False) -> int:
    """校验通过后恢复到 dest；目标非空默认拒绝（force=true 覆盖）。返回恢复文件数。"""
    result = verify_backup(zip_path)
    if not result["ok"]:
        raise ValueError("备份校验失败，拒绝恢复：" + "；".join(result["problems"][:5]))
    dest = Path(dest)
    if dest.exists() and any(dest.iterdir()) and not force:
        raise ValueError(f"目标目录非空：{dest}（需要 --force 才覆盖）")
    count = 0
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            if info.filename == "manifest.json":
                continue
            parts = Path(info.filename).parts
            if Path(info.filename).is_absolute() or ".." in parts:
                raise ValueError(f"非法路径已拦截：{info.filename}")
            zf.extract(info, dest)
            count += 1
    return count


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="数据主权导出：打包 / 校验 / 恢复（零依赖）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    pc = sub.add_parser("create", help="打包 data/ 为 zip（附 manifest sha256 清单）")
    pc.add_argument("-o", "--output",
                    help="输出 zip 路径（默认 pain-to-mvp-backup-<时间戳>.zip）")
    pc.add_argument("--data", default=str(ROOT / "data"), help="数据目录（默认仓库 data/）")

    pv = sub.add_parser("verify", help="校验备份完整性（逐文件 sha256）")
    pv.add_argument("zip", help="备份 zip 路径")

    pr = sub.add_parser("restore", help="校验通过后恢复备份")
    pr.add_argument("zip", help="备份 zip 路径")
    pr.add_argument("--to", default="restored-data", help="恢复目标目录（默认 ./restored-data）")
    pr.add_argument("--force", action="store_true", help="目标目录非空时允许覆盖")

    args = ap.parse_args(argv)
    if args.cmd == "create":
        out = Path(args.output) if args.output else Path(
            f"pain-to-mvp-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip")
        try:
            manifest = create_backup(Path(args.data), out)
        except ValueError as exc:
            print(f"❌ {exc}", file=sys.stderr)
            return 1
        total = sum(m["size"] for m in manifest["files"].values())
        print(f"✅ 已打包 {len(manifest['files'])} 个文件（{total} bytes）→ {out}")
        print(f"   校验：python scripts/export_backup.py verify {out}")
        return 0
    if args.cmd == "verify":
        result = verify_backup(Path(args.zip))
        if result["ok"]:
            print(f"✅ 校验通过：{result['checked']} 个文件，sha256 全部一致")
            return 0
        print(f"❌ 校验失败：{len(result['problems'])} 处问题", file=sys.stderr)
        for p in result["problems"][:10]:
            print(f"   - {p}", file=sys.stderr)
        return 1
    if args.cmd == "restore":
        try:
            n = restore_backup(Path(args.zip), Path(args.to), force=args.force)
        except ValueError as exc:
            print(f"❌ {exc}", file=sys.stderr)
            return 1
        print(f"✅ 已恢复 {n} 个文件 → {args.to}")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
