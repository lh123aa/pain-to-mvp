#!/usr/bin/env python3
"""
一键跑通 P2 → P3：发现 → 爬取 → 挖掘 → 评分 → MVP → 导出卡片。
用法：
  python run_all.py --keyword "独立开发者获客" --platforms bilibili --limit 20 --comments 200
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
import subprocess
import sys
import time
from pathlib import Path

from run_inputs import collect_raw_files, safe_filename
from domain_check import classify_keyword

def domain_precheck(keyword):
    """Layer 1 前置判定：搜索前判关键词域，跑偏即警告（不阻断，合规红线不封死主路径）。

    实测依据：问题域痛点率 23.6% vs 娱乐域 4.5%，域错是 5 倍杠杆。
    """
    kw_type = classify_keyword(keyword)
    if kw_type == "entertainment":
        print(f"⚠️ 域校验：关键词「{keyword}」被判为娱乐域 —— "
              "实测娱乐域痛点率仅 4.5%（问题域 23.6%），召回大概率跑偏，"
              "建议改用问题域关键词")

def run(cmd):
    print(f"\n$ {' '.join(cmd)}")
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        print(f"❌ 命令失败：{cmd}")
        raise SystemExit(f"❌ 命令失败：{' '.join(cmd)}")
    return True

def main(args):
    base = Path(__file__).parent
    run_started_at = time.time()

    # 0. 域校验前置判定（Layer 1）：娱乐域关键词跑偏即警告，不阻断
    domain_precheck(args.keyword)

    # 1. 发现（失败即中止，绝不消费旧产物）
    run([sys.executable, str(base / "discover_content.py"),
         "--keyword", args.keyword,
         "--platforms", *args.platforms,
         "--limit", str(args.limit)])

    # 找最新的 discovered 文件（本次运行产出）
    discovered_dir = Path("data/discovered")
    files = sorted(
        (f for f in discovered_dir.glob(f"{safe_filename(args.keyword)}_*.json")
         if f.stat().st_mtime >= run_started_at),
        key=lambda p: p.stat().st_mtime)
    if not files:
        print("❌ 未找到本次运行的发现结果")
        raise SystemExit("❌ 未找到本次运行的发现结果（discover 未产出新文件）")
    latest = files[-1]

    # 2. 爬评论（记录开始时刻，用于筛选本次运行产出的 raw 文件）
    crawl_started_at = time.time()
    run([sys.executable, str(base / "crawl_comments.py"),
         "--input", str(latest), "--limit", str(args.comments)])

    # 3. 合并本次爬取产出的全部 raw JSONL（多视频评论不丢）
    raw_files = collect_raw_files(Path("data/raw"), since=crawl_started_at)
    if not raw_files:
        print("❌ 未找到本次运行的爬取结果")
        raise SystemExit("❌ 未找到本次运行的爬取结果")

    # 4. 挖掘痛点（--topics 域内聚焦：OPEN_ISSUES #22 接线，未给则行为不变）
    mine_cmd = [sys.executable, str(base / "mine_pain_points.py"),
                "--inputs", *[str(p) for p in raw_files]]
    topics = getattr(args, "topics", None)  # 旧调用方无 topics 属性不崩
    if topics:
        mine_cmd += ["--topics", *topics]
    run(mine_cmd)

    # 5. 找最新 pains 文件（仅本次运行产出，旧文件一律不消费）
    pains_dir = Path("data/pains")
    pains_files = sorted(
        (f for f in pains_dir.glob("*.json") if f.stat().st_mtime >= run_started_at),
        key=lambda p: p.stat().st_mtime)
    if not pains_files:
        print("❌ 未找到本次运行的痛点结果")
        raise SystemExit("❌ 未找到本次运行的痛点结果")
    pains_latest = pains_files[-1]

    # 6. 评分
    run([sys.executable, str(base / "score_opportunity.py"),
         "--input", str(pains_latest)])

    # 7. 找最新 scored 文件（仅本次运行产出）
    scored_dir = Path("data/scored")
    scored_files = sorted(
        (f for f in scored_dir.glob("scored_*.json") if f.stat().st_mtime >= run_started_at),
        key=lambda p: p.stat().st_mtime)
    if not scored_files:
        print("❌ 未找到本次运行的评分结果")
        raise SystemExit("❌ 未找到本次运行的评分结果")
    scored_latest = scored_files[-1]

    # 8. MVP 设计
    run([sys.executable, str(base / "design_mvp.py"),
         "--input", str(scored_latest)])

    # 9. 导出卡片
    mvp_file = Path(str(scored_latest).replace(".json", "_mvp.json"))
    if mvp_file.exists():
        run([sys.executable, str(base / "export_card.py"),
             "--input", str(mvp_file), "--top", "5"])

    # EXEC_REPORT_HOOK：跑批后自动产出「执行结果 + 每步为什么」报告
    run([sys.executable, str(base / "exec_report.py"),
         "--keyword", args.keyword,
         "--discovered", str(latest),
         "--scored", str(mvp_file) if mvp_file.exists() else "",
         "--raw", *[str(p) for p in raw_files]])

    print("\n🎉 全流程完成！")
    print("查看卡片：data/cards/")
    print("查看看板数据：data/dashboard.json")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--keyword", required=True)
    p.add_argument("--platforms", nargs="+", default=["bilibili"])
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--comments", type=int, default=200)
    p.add_argument("--topics", nargs="+",
                   help="主题词列表：只保留命中任一词的评论（域内聚焦，透传 mine --topics）")
    args = p.parse_args()
    main(args)
