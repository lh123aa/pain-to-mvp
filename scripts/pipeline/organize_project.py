#!/usr/bin/env python3
"""按项目（关键词）归档运行产物 → data/projects/{关键词}/{kind}/（用户需求 2026-10-17）。

两个模式：
- --migrate：历史全量归位。关键词权威 = discovered 文件名
  （safe_filename(keyword)_YYYYMMDD_HHMM.json）；pains/scored/cards 无关键词
  标记 → 按 mtime 就近归属「发现时间 <= 文件时间 且间隔 <= MAX_GAP 的最近一轮」；
  无归属 → projects/_待认领/{kind}/（不硬安给某个项目，诚实待认领）。
  raw **只复制不移动**：raw 同时服务跨轮去重（#20）与本轮清单（#31），
  jsonl_path_for 是写入单一权威——移走会导致同关键词重跑全量重爬，
  加重 v_voucher 风控（2026-10-17 两次拦截的现实约束）。
- --run --keyword K --run-start T：e2e 收尾归档本轮产出——mtime >= T 的
  discovered/pains/scored/cards 归入 K；raw 按本轮 crawl 清单复制
  （清单缺失回退 mtime 过滤）。

归档后刷新各项目 README 索引并重建看板（看板 glob = data/cards +
data/projects/*/cards）。重复执行幂等：源已不在/目标已存在一律跳过不覆盖。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

try:  # pytest 以 scripts.pipeline 包导入；直接执行时 flat 导入
    from scripts.pipeline.run_inputs import CRAWL_MANIFEST, safe_filename
except ImportError:  # pragma: no cover
    from run_inputs import CRAWL_MANIFEST, safe_filename

# 发现 → 产出文件的归属窗口：单轮 e2e 约 90 秒，30 分钟外视为无归属
MAX_GAP = 1800.0
PENDING = "_待认领"
KINDS = ("discovered", "pains", "scored", "cards", "raw")
_DISC_RE = re.compile(r"^(?P<kw>.+)_(\d{8})_(\d{4})$")


def project_dir(root, keyword) -> Path:
    """项目归档目录：data/projects/{safe_filename(keyword)}。"""
    return Path(root) / "projects" / safe_filename(keyword)


def _read_discovered(path: Path) -> list:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return []
    return data if isinstance(data, list) else []


def _discover_runs(root: Path) -> list:
    """[(folder_stem, start_mtime, source_ids, src_path)]，按文件名解析关键词。"""
    runs = []
    d = Path(root) / "discovered"
    if not d.exists():
        return runs
    for f in sorted(d.glob("*.json")):
        m = _DISC_RE.match(f.stem)
        if not m:
            continue
        ids = {
            str(x.get("source_id"))
            for x in _read_discovered(f)
            if isinstance(x, dict) and x.get("source_id") is not None
        }
        runs.append({
            "folder": m.group("kw"),
            "start": f.stat().st_mtime,
            "ids": ids,
            "src": f,
        })
    return runs


def _attribute(root: Path, runs: list, path: Path, kind: str):
    """按 mtime 就近归属；无候选 → None（调用方转入 _待认领）。"""
    mt = path.stat().st_mtime
    cands = [r for r in runs if r["start"] <= mt and (mt - r["start"]) <= MAX_GAP]
    if not cands:
        return None
    best = min(cands, key=lambda r: mt - r["start"])
    return Path(root) / "projects" / best["folder"] / kind / path.name


def plan_migrate(root: Path):
    """历史全量归位计划：(moves, copies, unattributed)。"""
    root = Path(root)
    runs = _discover_runs(root)
    moves, copies, unattr = [], [], []

    for r in runs:  # discovered 自身：文件名即关键词权威
        moves.append((r["src"],
                      Path(root) / "projects" / r["folder"] / "discovered" / r["src"].name))

    for sub in ("pains", "scored", "cards"):
        d = root / sub
        if not d.exists():
            continue
        for f in sorted(d.glob("*")):
            if not f.is_file():
                continue
            dst = _attribute(root, runs, f, sub)
            if dst is None:
                dst = Path(root) / "projects" / PENDING / sub / f.name
                unattr.append(f)
            if dst != f:
                moves.append((f, dst))

    raw_dir = root / "raw"
    if raw_dir.exists():  # raw：只复制，原件留引擎室（去重/清单依赖）
        for f in sorted(raw_dir.glob("*.jsonl")):
            sid = f.stem.split("_", 1)[1] if "_" in f.stem else ""
            if not sid:
                continue
            for r in runs:
                if sid in r["ids"]:
                    copies.append((f, Path(root) / "projects" / r["folder"] / "raw" / f.name))
    return moves, copies, unattr


def plan_run(root: Path, keyword, run_start: float):
    """本轮归档计划（e2e 收尾）：mtime >= run_start 的产出 + 本轮清单 raw。"""
    root = Path(root)
    run_start = float(run_start)
    folder = project_dir(root, keyword)
    safe = folder.name
    moves, copies, unattr = [], [], []

    d = root / "discovered"
    if d.exists():
        for f in sorted(d.glob("*.json")):
            m = _DISC_RE.match(f.stem)
            if m and m.group("kw") == safe and f.stat().st_mtime >= run_start:
                moves.append((f, folder / "discovered" / f.name))

    for sub in ("pains", "scored", "cards"):
        dd = root / sub
        if not dd.exists():
            continue
        for f in sorted(dd.glob("*")):
            if f.is_file() and f.stat().st_mtime >= run_start:
                moves.append((f, folder / sub / f.name))

    raw_dir = root / "raw"
    if raw_dir.exists():
        listed = []
        manifest = raw_dir / CRAWL_MANIFEST
        if manifest.exists() and manifest.stat().st_mtime >= run_start:
            try:
                listed = [Path(x) for x in
                          json.loads(manifest.read_text(encoding="utf-8")).get("files") or []]
            except (json.JSONDecodeError, OSError, UnicodeDecodeError, AttributeError):
                listed = []
        if not listed:  # 清单缺失/陈旧 → 本轮新写入的 raw（清单优先语义同 collect）
            listed = [f for f in raw_dir.glob("*.jsonl")
                      if f.stat().st_mtime >= run_start]
        for f in listed:
            if f.exists():
                copies.append((f, folder / "raw" / f.name))
    return moves, copies, unattr


def apply_plan(moves, copies) -> dict:
    """执行归档。幂等：源缺失/目标已存在一律跳过，绝不覆盖。"""
    counts = {"moved": 0, "copied": 0, "skipped": 0}
    for src, dst in moves:
        src, dst = Path(src), Path(dst)
        if not src.exists() or dst.exists() or src == dst:
            counts["skipped"] += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        counts["moved"] += 1
    for src, dst in copies:
        src, dst = Path(src), Path(dst)
        if not src.exists() or dst.exists():
            counts["skipped"] += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(src), str(dst))
        counts["copied"] += 1
    return counts


def write_readme(proj: Path) -> Path:
    """项目夹索引：分组列出归档文件（纯文本，无 emoji）。"""
    proj = Path(proj)
    lines = [
        f"# 项目归档：{proj.name}",
        "",
        f"生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "由 organize_project 归档。raw/ 为复制件（原件在 data/raw/，服务跨轮去重）。",
        "",
    ]
    if proj.is_dir():
        for sub in sorted(p for p in proj.iterdir() if p.is_dir()):
            files = sorted(x for x in sub.iterdir() if x.is_file())
            lines.append(f"## {sub.name}/ （{len(files)} 个文件）")
            lines.extend(f"- {x.name}" for x in files)
            lines.append("")
    readme = proj / "README.md"
    readme.parent.mkdir(parents=True, exist_ok=True)
    readme.write_text("\n".join(lines), encoding="utf-8")
    return readme


def _project_of(dst: Path) -> Path:
    """dst = projects/{项目}/{kind}/{文件} → projects/{项目}。"""
    return Path(dst).parent.parent


def _rebuild_dashboard() -> None:
    repo = Path(__file__).resolve().parents[2]
    script = repo / "scripts" / "dashboard" / "write_dashboard.py"
    if script.exists():
        subprocess.run([sys.executable, str(script)], cwd=str(repo))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="按项目归档运行产物")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--migrate", action="store_true", help="历史全量归位")
    g.add_argument("--run", action="store_true", help="归档本轮产出（e2e 收尾）")
    ap.add_argument("--keyword", help="--run 模式：本轮关键词")
    ap.add_argument("--run-start", type=float, default=None,
                    help="--run 模式：本轮起点（epoch 秒）")
    ap.add_argument("--root", default="data", help="data 根目录（默认 data）")
    ap.add_argument("--no-dashboard", action="store_true", help="跳过看板重建")
    args = ap.parse_args(argv)

    root = Path(args.root)
    if args.run:
        if not args.keyword or args.run_start is None:
            ap.error("--run 需要 --keyword 与 --run-start")
        moves, copies, unattr = plan_run(root, args.keyword, args.run_start)
        label = f"本轮（{args.keyword}）"
    else:
        moves, copies, unattr = plan_migrate(root)
        label = "历史全量"

    counts = apply_plan(moves, copies)
    projs = sorted({_project_of(dst) for _, dst in moves + copies})
    for p in projs:
        write_readme(p)

    print(f"📦 归档完成 [{label}]：移动 {counts['moved']}、复制 {counts['copied']}、"
          f"跳过 {counts['skipped']}、无归属 {len(unattr)}（已入 {PENDING}/）")
    for p in projs:
        print(f"   {p}")
    if unattr:
        print(f"   待认领：{', '.join(x.name for x in unattr)}")

    if not args.no_dashboard:
        _rebuild_dashboard()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
