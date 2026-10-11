#!/usr/bin/env python3
"""
端到端测试：用 B站真实数据跑通全流程。
用法：
  python scripts/e2e_test.py                  # 完整跑
  python scripts/e2e_test.py --skip-crawl     # 跳过网络爬取，用已有数据
  python scripts/e2e_test.py --keyword "独立开发者" --platform bilibili
"""
# --- UTF-8 入口稳定化（fix_utf8.py 自动插入） ---
import os as _os
import sys as _sys

_here = _os.path.dirname(_os.path.abspath(__file__))
for _cand in (_here, _os.path.dirname(_here), _os.path.join(_os.path.dirname(_here), "scripts")):
    if _os.path.isdir(_os.path.join(_cand, "pipeline")) and _cand not in _sys.path:
        _sys.path.insert(0, _cand)
        break
try:
    from pipeline.encoding import ensure_utf8

    ensure_utf8()
except Exception:
    pass
# --- 结束 UTF-8 入口稳定化 ---
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from pipeline.run_inputs import collect_raw_files

ROOT = Path(__file__).parent.parent
PIPELINE = ROOT / "scripts" / "pipeline"

def run(cmd, desc):
    print(f"\n{'=' * 60}")
    print(f"▶️  {desc}")
    print(f"$ {' '.join(cmd)}")
    print("=" * 60)
    t0 = time.time()
    r = subprocess.run(cmd, text=True)
    dt = time.time() - t0
    status = "✅" if r.returncode == 0 else "❌"
    print(f"{status} 用时 {dt:.1f}s")
    return r.returncode == 0, dt

def latest(folder, pattern):
    files = sorted(Path(folder).glob(pattern), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None

def main(args):
    print("\n🧪 Pain-to-MVP 端到端测试\n")
    t_start = time.time()
    steps = []

    # Step 1: 发现内容
    ok, dt = run(
        [sys.executable, str(PIPELINE / "discover_content.py"),
         "--keyword", args.keyword,
         "--platforms", args.platform,
         "--limit", str(args.limit)],
        "Step 1/6：发现内容"
    )
    steps.append(("discover", ok, dt))
    if not ok:
        return _report(steps, time.time() - t_start)

    discovered = latest(ROOT / "data" / "discovered", f"{args.keyword}_*.json")
    if not discovered:
        print("❌ 未找到发现结果")
        return _report(steps, time.time() - t_start)

    # Step 2: 爬评论
    if args.skip_crawl:
        print("\n⏭️  跳过爬取（--skip-crawl）")
        raw_files = collect_raw_files(ROOT / "data" / "raw")
    else:
        crawl_started_at = time.time()
        ok, dt = run(
            [sys.executable, str(PIPELINE / "crawl_comments.py"),
             "--input", str(discovered),
             "--limit", str(args.comments)],
            "Step 2/6：爬取评论"
        )
        steps.append(("crawl", ok, dt))
        # 本次爬取产出的全部 raw 文件（多视频合并，不丢评论）
        raw_files = collect_raw_files(ROOT / "data" / "raw", since=crawl_started_at)

    if not raw_files:
        print("❌ 未找到评论数据")
        return _report(steps, time.time() - t_start)

    # Step 3: 挖掘痛点
    ok, dt = run(
        [sys.executable, str(PIPELINE / "mine_pain_points.py"),
         "--inputs", *[str(p) for p in raw_files],
         "--min-pain", "3",
         "--min-cluster", "2"],
        "Step 3/6：挖掘痛点"
    )
    steps.append(("mine", ok, dt))
    pains_file = latest(ROOT / "data" / "pains", "*.json")
    if not pains_file:
        print("❌ 未找到痛点结果")
        return _report(steps, time.time() - t_start)

    # Step 4: 机会评分
    ok, dt = run(
        [sys.executable, str(PIPELINE / "score_opportunity.py"),
         "--input", str(pains_file),
         "--no-llm"],  # 测试用启发式，避免依赖 API key
        "Step 4/6：机会评分"
    )
    steps.append(("score", ok, dt))
    scored_file = latest(ROOT / "data" / "scored", "scored_*.json")
    if not scored_file:
        print("❌ 未找到评分结果")
        return _report(steps, time.time() - t_start)

    # Step 5: MVP 设计
    ok, dt = run(
        [sys.executable, str(PIPELINE / "design_mvp.py"),
         "--input", str(scored_file)],
        "Step 5/6：MVP 设计"
    )
    steps.append(("mvp", ok, dt))
    mvp_file = Path(str(scored_file).replace(".json", "_mvp.json"))

    # Step 6: 导出卡片 + 重建看板
    if mvp_file.exists():
        ok, dt = run(
            [sys.executable, str(PIPELINE / "export_card.py"),
             "--input", str(mvp_file), "--top", "5"],
            "Step 6/6：导出卡片 + 更新看板"
        )
        steps.append(("export", ok, dt))

        # 重建看板（以卡片为准，避免重复）
        run(
            [sys.executable, str(ROOT / "scripts" / "dashboard" / "write_dashboard.py")],
            "收尾：重建 dashboard.json"
        )

    _report(steps, time.time() - t_start)
    print("\n🎉 端到端测试完成！")
    print(f"\n查看卡片：{ROOT / 'data' / 'cards'}")
    print(f"启动看板：python scripts/dashboard/serve.py --port 8787")
    print(f"浏览器：http://localhost:8787")

def _report(steps, total):
    print("\n" + "=" * 60)
    print("📊 测试报告")
    print("=" * 60)
    for name, ok, dt in steps:
        print(f"  {'✅' if ok else '❌'} {name:12s} {dt:6.1f}s")
    print(f"  {'⏱️':12s} 总计 {total:.1f}s")
    print("=" * 60)

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--keyword", default="独立开发者")
    p.add_argument("--platform", default="bilibili")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--comments", type=int, default=100)
    p.add_argument("--skip-crawl", action="store_true")
    args = p.parse_args()
    main(args)
