#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
后处理修复器：在 P0-P6 生成器运行后执行，恢复全部修复。

用法：python generators/apply_fixes.py
幂等：每项修复前检查标记，已修复则跳过。

修复清单（对应评估发现的 P0/P1 问题）：
  1. UTF-8 入口稳定化（委托 fix_utf8.py）
  2. 新模块落盘：scripts/pipeline/{encoding,wbi,run_inputs}.py
  3. adapters 导入风格统一：`from ..compliance import` → `from compliance import`
  4. cluster.py 空输入守卫（空评论不产出伪簇）
  5. mine_pain_points.py 支持 --inputs 多文件全量合并
  6. run_all.py / e2e_test.py 用 collect_raw_files 合并本次全部 raw（不丢评论）
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXES_SRC = Path(__file__).resolve().parent / "fixes"

report = []


def patch_text(path: Path, old: str, new: str, marker: str, desc: str) -> None:
    """幂等文本替换：已含 marker 跳过；找不到 old 报错。"""
    text = path.read_text(encoding="utf-8")
    if marker in text:
        report.append(f"⏭️  {desc}（已修复）")
        return
    if old not in text:
        raise SystemExit(f"❌ {desc}：在 {path} 中未找到锚点，请人工检查")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    report.append(f"🔧 {desc}")


def copy_new_modules() -> None:
    # 仅 scripts/pipeline/ 下的新模块；heal_runner.py 由 fix_heal 放到 scripts/healing/
    for name in ("encoding.py", "wbi.py", "run_inputs.py"):
        src = FIXES_SRC / name
        dst = ROOT / "scripts" / "pipeline" / name
        shutil.copyfile(src, dst)
        report.append(f"📄 新模块 {dst.relative_to(ROOT)}")


def fix_adapter_imports() -> None:
    for p in sorted((ROOT / "scripts" / "pipeline" / "adapters").glob("*.py")):
        text = p.read_text(encoding="utf-8")
        if "from ..compliance import" not in text:
            continue
        p.write_text(text.replace("from ..compliance import", "from compliance import"), encoding="utf-8")
        report.append(f"🔧 适配器导入统一：{p.name}")


def fix_cluster() -> None:
    p = ROOT / "scripts" / "pipeline" / "cluster.py"
    patch_text(
        p,
        old='''    输出聚类列表，每个聚类含 representative 文本 + 成员
    """
    texts = [c.get("clean_content") or c.get("content") or "" for c in comments]''',
        new='''    输出聚类列表，每个聚类含 representative 文本 + 成员
    """
    if not comments:
        return []
    texts = [c.get("clean_content") or c.get("content") or "" for c in comments]''',
        marker="if not comments:",
        desc="cluster.py 空输入守卫",
    )


def fix_mine() -> None:
    p = ROOT / "scripts" / "pipeline" / "mine_pain_points.py"
    if "from run_inputs import merge_jsonl_records" not in p.read_text(encoding="utf-8"):
        patch_text(
            p,
            old='''from preprocess import preprocess_comments
from pain_rules import filter_painful
from cluster import cluster_comments
from storage import query_comments''',
            new='''from preprocess import preprocess_comments
from pain_rules import filter_painful
from cluster import cluster_comments
from run_inputs import merge_jsonl_records
from storage import query_comments''',
            marker="from run_inputs import merge_jsonl_records",
            desc="mine: imports",
        )
    patch_text(
        p,
        old='''def _load_input(input_file=None, platform=None, limit=1000):''',
        new='''def _load_input(input_file=None, platform=None, limit=1000, inputs=None):
    if inputs:
        # 多文件全量合并去重（多视频/多来源评论不丢）
        return merge_jsonl_records([Path(p) for p in inputs])''',
        marker="多文件全量合并去重",
        desc="mine: _load_input 多文件",
    )
    patch_text(
        p,
        old='''def mine(input_file=None, platform=None, limit=1000, min_pain=3, min_cluster=3):
    raw = _load_input(input_file, platform, limit)''',
        new='''def mine(input_file=None, platform=None, limit=1000, min_pain=3, min_cluster=3, inputs=None):
    raw = _load_input(input_file, platform, limit, inputs)''',
        marker="min_cluster=3, inputs=None",
        desc="mine: 签名加 inputs",
    )
    patch_text(
        p,
        old='''    p.add_argument("--input", help="评论 JSONL 文件")''',
        new='''    p.add_argument("--input", help="评论 JSONL 文件（单个）")
    p.add_argument("--inputs", nargs="+", help="多个评论 JSONL 文件（全量合并，优先于 --input）")''',
        marker="--inputs",
        desc="mine: CLI --inputs",
    )
    patch_text(
        p,
        old='''    mine(args.input, args.platform, args.limit, args.min_pain, args.min_cluster)''',
        new='''    mine(args.input, args.platform, args.limit, args.min_pain, args.min_cluster, inputs=args.inputs)''',
        marker="inputs=args.inputs",
        desc="mine: CLI 传 inputs",
    )


def fix_run_all() -> None:
    p = ROOT / "scripts" / "pipeline" / "run_all.py"
    patch_text(
        p,
        old='''import argparse
import subprocess
import sys
from pathlib import Path''',
        new='''import argparse
import subprocess
import sys
import time
from pathlib import Path''',
        marker="crawl_started_at",
        desc="run_all: import time（marker 用新代码独有文本，#16）",
    )
    patch_text(
        p,
        old='''    # 2. 爬评论
    run([sys.executable, str(base / "crawl_comments.py"),
         "--input", str(latest), "--limit", str(args.comments)])

    # 3. 找最新的 raw JSONL（爬取结果）
    raw_dir = Path("data/raw")
    raw_files = sorted(raw_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    if not raw_files:
        print("❌ 未找到爬取结果"); return
    raw_latest = raw_files[-1]

    # 4. 挖掘痛点
    run([sys.executable, str(base / "mine_pain_points.py"),
         "--input", str(raw_latest)])''',
        new='''    # 2. 爬评论（记录开始时刻，用于筛选本次运行产出的 raw 文件）
    crawl_started_at = time.time()
    run([sys.executable, str(base / "crawl_comments.py"),
         "--input", str(latest), "--limit", str(args.comments)])

    # 3. 合并本次爬取产出的全部 raw JSONL（多视频评论不丢）
    from run_inputs import collect_raw_files
    raw_files = collect_raw_files(Path("data/raw"), since=crawl_started_at)
    if not raw_files:
        print("❌ 未找到爬取结果"); return

    # 4. 挖掘痛点
    run([sys.executable, str(base / "mine_pain_points.py"),
         "--inputs", *[str(p) for p in raw_files]])''',
        marker="collect_raw_files",
        desc="run_all: 全量 raw 合并",
    )


def fix_score_dims() -> None:
    """Iteration-1 Task 4：WEIGHTS 死代码清理为 DIMS 元组（OPEN_ISSUES #4）。
    必须在 fix_scoring 之后执行。"""
    p = ROOT / "scripts" / "pipeline" / "score_opportunity.py"
    patch_text(
        p,
        old='''WEIGHTS = {
    "demand": 0.30,
    "competition": 0.20,
    "feasibility": 0.20,
    "reach": 0.15,
    "ai_leverage": 0.15,
}''',
        new='''# 评分维度（有序）。历史 WEIGHTS 的权重值在启发式路径从未生效（compose 用有效维度均值），
# 属死代码，已清理为维度元组（OPEN_ISSUES #4）。
DIMS = ("demand", "competition", "feasibility", "reach", "ai_leverage")''',
        marker="DIMS = (",
        desc="score: WEIGHTS → DIMS",
    )
    patch_text(
        p,
        old='''        for k in WEIGHTS:
            scores[k] = max(1, min(5, int(scores.get(k, 3))))''',
        new='''        for k in DIMS:
            scores[k] = max(1, min(5, int(scores.get(k, 3))))''',
        marker="for k in DIMS:",
        desc="score: LLM clamp 用 DIMS",
    )
    patch_text(
        p,
        old='''    valid = [scores[k] for k in WEIGHTS if scores.get(k) is not None]''',
        new='''    valid = [scores[k] for k in DIMS if scores.get(k) is not None]''',
        marker="for k in DIMS if scores.get(k) is not None",
        desc="score: compose 用 DIMS",
    )
    patch_text(
        p,
        old='''        p["scores"] = {k: s[k] for k in WEIGHTS}''',
        new='''        p["scores"] = {k: s[k] for k in DIMS}''',
        marker='for k in DIMS}',
        desc="score: 输出 scores 用 DIMS",
    )


def fix_export_scores_compat() -> None:
    """Iteration-1 Task 4：export 对缺失/部分 scores 容错（OPEN_ISSUES #4）。
    必须在 fix_export_card 之后执行。"""
    p = ROOT / "scripts" / "pipeline" / "export_card.py"
    patch_text(
        p,
        old='''        content = CARD_TMPL.format(
            id=card_id,
            title=title,
            status="discovered",
            score=p.get("total_score"),
            tier=p.get("tier", "?"),
            discovered_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
            size=p.get("size", 0),
            description=title,
            signals=json.dumps(p.get("signal_distribution", {}), ensure_ascii=False),
            quotes=_format_quotes(p.get("representative_quotes")),
            demand=format_dim(p["scores"].get("demand")),
            competition=format_dim(p["scores"].get("competition")),
            feasibility=format_dim(p["scores"].get("feasibility")),
            reach=format_dim(p["scores"].get("reach")),
            ai_leverage=format_dim(p["scores"].get("ai_leverage")),''',
        new='''        scores = p.get("scores") or {}  # 旧格式容错：缺键不崩，维度渲染 —（OPEN_ISSUES #4）
        content = CARD_TMPL.format(
            id=card_id,
            title=title,
            status="discovered",
            score=p.get("total_score"),
            tier=p.get("tier", "?"),
            discovered_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
            size=p.get("size", 0),
            description=title,
            signals=json.dumps(p.get("signal_distribution", {}), ensure_ascii=False),
            quotes=_format_quotes(p.get("representative_quotes")),
            demand=format_dim(scores.get("demand")),
            competition=format_dim(scores.get("competition")),
            feasibility=format_dim(scores.get("feasibility")),
            reach=format_dim(scores.get("reach")),
            ai_leverage=format_dim(scores.get("ai_leverage")),''',
        marker="旧格式容错：缺键不崩",
        desc="export: scores 容错（卡片体）",
    )
    patch_text(
        p,
        old='''            "representative_quotes": p.get("representative_quotes", [])[:3],
            "scores": p["scores"],''',
        new='''            "representative_quotes": p.get("representative_quotes", [])[:3],
            "scores": scores,''',
        marker='"scores": scores,',
        desc="export: scores 容错（看板条目）",
    )


def fix_mine_badlines() -> None:
    """Iteration-1 Task 3：mine 单文件分支坏行跳过（OPEN_ISSUES #2）。"""
    p = ROOT / "scripts" / "pipeline" / "mine_pain_points.py"
    patch_text(
        p,
        old='''    if input_file:
        comments = []
        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    comments.append(json.loads(line))
        return comments''',
        new='''    if input_file:
        comments = []
        skipped = 0
        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    comments.append(json.loads(line))
                except json.JSONDecodeError:
                    skipped += 1  # 坏行跳过不崩溃（OPEN_ISSUES #2）
        if skipped:
            print(f"⚠️ 跳过坏行 {skipped} 条（{input_file}）")
        return comments''',
        marker="跳过坏行 {skipped} 条",
        desc="mine: 单文件坏行保护",
    )


def fix_compliance_failclose() -> None:
    """Iteration-1 Task 2：robots 读取失败 fail-close（PRD §4.1 / OPEN_ISSUES #1）。"""
    p = ROOT / "scripts" / "pipeline" / "compliance.py"
    patch_text(
        p,
        old='''    try:
        rp.read()
    except Exception:
        # 读不到 robots.txt，默认允许（保守起见可改为 False）
        rp.allow_all = True''',
        new='''    try:
        rp.read()
    except Exception:
        # PRD §4.1：fail-close——读不到 robots.txt 一律拒绝抓取
        rp.disallow_all = True''',
        marker="fail-close——读不到 robots.txt 一律拒绝抓取",
        desc="compliance: robots fail-close",
    )


def fix_run_all_failfast() -> None:
    """Iteration-1 Task 1：run_all 一键入口修复（#21 UnboundLocalError）+
    fail-fast（任何步骤失败/产物缺失即 SystemExit）+ 旧产物防护（mtime 过滤）。
    必须在 fix_run_all 与 fix_safe_filename_wiring 之后执行。"""
    p = ROOT / "scripts" / "pipeline" / "run_all.py"
    patch_text(
        p,
        old='''import argparse
import subprocess
import sys
import time
from pathlib import Path

def run(cmd):
    print(f"\\n$ {' '.join(cmd)}")
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        print(f"⚠️ 命令失败：{cmd}")
    return r.returncode == 0

def main(args):
    base = Path(__file__).parent

    # 1. 发现''',
        new='''import argparse
import subprocess
import sys
import time
from pathlib import Path

from run_inputs import collect_raw_files, safe_filename

def run(cmd):
    print(f"\\n$ {' '.join(cmd)}")
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        print(f"❌ 命令失败：{cmd}")
        raise SystemExit(f"❌ 命令失败：{' '.join(cmd)}")
    return True

def main(args):
    base = Path(__file__).parent
    run_started_at = time.time()

    # 1. 发现（失败即中止，绝不消费旧产物）''',
        marker='raise SystemExit(f"❌ 命令失败：',
        desc="run_all: fail-fast run() + 模块级 import",
    )
    patch_text(
        p,
        old='''    # 找最新的 discovered 文件
    discovered_dir = Path("data/discovered")
    files = sorted(discovered_dir.glob(f"{safe_filename(args.keyword)}_*.json"), key=lambda p: p.stat().st_mtime)
    if not files:
        print("❌ 未找到发现结果"); return
    latest = files[-1]''',
        new='''    # 找最新的 discovered 文件（本次运行产出）
    discovered_dir = Path("data/discovered")
    files = sorted(
        (f for f in discovered_dir.glob(f"{safe_filename(args.keyword)}_*.json")
         if f.stat().st_mtime >= run_started_at),
        key=lambda p: p.stat().st_mtime)
    if not files:
        print("❌ 未找到本次运行的发现结果")
        raise SystemExit("❌ 未找到本次运行的发现结果（discover 未产出新文件）")
    latest = files[-1]''',
        marker="未找到本次运行的发现结果",
        desc="run_all: discovered 本次产出过滤",
    )
    patch_text(
        p,
        old='''    # 3. 合并本次爬取产出的全部 raw JSONL（多视频评论不丢）
    from run_inputs import collect_raw_files, safe_filename
    raw_files = collect_raw_files(Path("data/raw"), since=crawl_started_at)
    if not raw_files:
        print("❌ 未找到爬取结果"); return''',
        new='''    # 3. 合并本次爬取产出的全部 raw JSONL（多视频评论不丢）
    raw_files = collect_raw_files(Path("data/raw"), since=crawl_started_at)
    if not raw_files:
        print("❌ 未找到本次运行的爬取结果")
        raise SystemExit("❌ 未找到本次运行的爬取结果")''',
        marker="未找到本次运行的爬取结果",
        desc="run_all: raw 检查改 SystemExit（import 移模块级）",
    )
    patch_text(
        p,
        old='''    # 5. 找最新 pains 文件
    pains_dir = Path("data/pains")
    pains_files = sorted(pains_dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
    if not pains_files:
        print("❌ 未找到痛点结果"); return
    pains_latest = pains_files[-1]''',
        new='''    # 5. 找最新 pains 文件（仅本次运行产出，旧文件一律不消费）
    pains_dir = Path("data/pains")
    pains_files = sorted(
        (f for f in pains_dir.glob("*.json") if f.stat().st_mtime >= run_started_at),
        key=lambda p: p.stat().st_mtime)
    if not pains_files:
        print("❌ 未找到本次运行的痛点结果")
        raise SystemExit("❌ 未找到本次运行的痛点结果")
    pains_latest = pains_files[-1]''',
        marker="未找到本次运行的痛点结果",
        desc="run_all: pains 本次产出过滤",
    )
    patch_text(
        p,
        old='''    # 7. 找最新 scored 文件
    scored_dir = Path("data/scored")
    scored_files = sorted(scored_dir.glob("scored_*.json"), key=lambda p: p.stat().st_mtime)
    if not scored_files:
        print("❌ 未找到评分结果"); return
    scored_latest = scored_files[-1]''',
        new='''    # 7. 找最新 scored 文件（仅本次运行产出）
    scored_dir = Path("data/scored")
    scored_files = sorted(
        (f for f in scored_dir.glob("scored_*.json") if f.stat().st_mtime >= run_started_at),
        key=lambda p: p.stat().st_mtime)
    if not scored_files:
        print("❌ 未找到本次运行的评分结果")
        raise SystemExit("❌ 未找到本次运行的评分结果")
    scored_latest = scored_files[-1]''',
        marker="未找到本次运行的评分结果",
        desc="run_all: scored 本次产出过滤",
    )


def fix_e2e() -> None:
    p = ROOT / "scripts" / "e2e_test.py"
    patch_text(
        p,
        old='''import time
from pathlib import Path''',
        new='''import time
from pathlib import Path

from pipeline.run_inputs import collect_raw_files''',
        marker="from pipeline.run_inputs import",
        desc="e2e: import collect_raw_files",
    )
    patch_text(
        p,
        old='''    # Step 2: 爬评论
    if args.skip_crawl:
        print("\\n⏭️  跳过爬取（--skip-crawl）")
        raw_file = latest(ROOT / "data" / "raw", "*.jsonl")
    else:
        ok, dt = run(
            [sys.executable, str(PIPELINE / "crawl_comments.py"),
             "--input", str(discovered),
             "--limit", str(args.comments)],
            "Step 2/6：爬取评论"
        )
        steps.append(("crawl", ok, dt))
        raw_file = latest(ROOT / "data" / "raw", "*.jsonl")

    if not raw_file:
        print("❌ 未找到评论数据")
        return _report(steps, time.time() - t_start)

    # Step 3: 挖掘痛点
    ok, dt = run(
        [sys.executable, str(PIPELINE / "mine_pain_points.py"),
         "--input", str(raw_file),
         "--min-pain", "3",
         "--min-cluster", "2"],
        "Step 3/6：挖掘痛点"
    )''',
        new='''    # Step 2: 爬评论
    if args.skip_crawl:
        print("\\n⏭️  跳过爬取（--skip-crawl）")
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
    )''',
        marker='"--inputs"',
        desc="e2e: 全量 raw 合并",
    )


def fix_crawl_manifest() -> None:
    """OPEN_ISSUES #31：跨轮去重断链 —— crawl 落"本轮成功清单"。

    同关键词重跑全部命中已知评论（#20 去重）→ 写入 0 新 → mtime 不变 →
    collect_raw_files(since=) 为空 → e2e/run_all 误判"未找到评论数据"断链。
    """
    p = ROOT / "scripts" / "pipeline" / "crawl_comments.py"
    patch_text(
        p,
        old='''from adapters import get_adapter
from compliance import preflight, RateLimiter
from storage import save_records''',
        new='''from adapters import get_adapter
from compliance import preflight, RateLimiter
from run_inputs import write_crawl_manifest
from storage import jsonl_path_for, save_records''',
        marker="write_crawl_manifest",
        desc="crawl: 导入清单与路径工具（#31）",
    )
    patch_text(
        p,
        old='''def crawl_one(platform, source_id, url, limit):
    if not preflight(url, platform):
        print(f"⛔ robots.txt 禁止：{url}")
        return []''',
        new='''def crawl_one(platform, source_id, url, limit):
    """返回评论列表；robots 禁止/异常 → None（失败不进 crawl 清单，#31）。"""
    if not preflight(url, platform):
        print(f"⛔ robots.txt 禁止：{url}")
        return None  # 未抓取成功：不进清单（#31）''',
        marker="失败不进 crawl 清单",
        desc="crawl_one: robots 禁止返回 None（#31）",
    )
    patch_text(
        p,
        old='''        except Exception:
            pass
        return []

def crawl_from_file(input_file, limit):
    data = json.loads(Path(input_file).read_text(encoding="utf-8"))
    total = 0
    for item in data:
        platform = item.get("platform")
        source_id = item.get("source_id")
        url = item.get("url", "")
        if not platform or not source_id:
            continue
        print(f"\\n🕷️ [{platform}] {item.get('title', '')[:50]}")
        comments = crawl_one(platform, source_id, url, limit)
        total += len(comments)
        # 礼貌延迟
        time.sleep(1.0)
    print(f"\\n✅ 共爬取 {total} 条评论")''',
        new='''        except Exception:
            pass
        return None  # 抓取异常：不进清单（#31）

def crawl_from_file(input_file, limit):
    data = json.loads(Path(input_file).read_text(encoding="utf-8"))
    total = 0
    crawled_paths = []  # 本轮成功抓取的 raw 文件（清单只记成功视频，#31）
    for item in data:
        platform = item.get("platform")
        source_id = item.get("source_id")
        url = item.get("url", "")
        if not platform or not source_id:
            continue
        print(f"\\n🕷️ [{platform}] {item.get('title', '')[:50]}")
        comments = crawl_one(platform, source_id, url, limit)
        if comments is not None:
            total += len(comments)
            crawled_paths.append(jsonl_path_for(platform, source_id))
        # 礼貌延迟
        time.sleep(1.0)
    if crawled_paths:
        # 跨轮全去重（写入 0 新）时 mtime 不变，下游靠本清单识别"本轮范围"（#31）
        write_crawl_manifest(crawled_paths[0].parent, crawled_paths)
    print(f"\\n✅ 共爬取 {total} 条评论")''',
        marker="crawled_paths",
        desc="crawl_from_file: 落盘本轮成功清单（#31）",
    )


def fix_e2e_exitcode() -> None:
    """OPEN_ISSUES #30：e2e 失败假装成功 —— _report 无返回值、早退 exit 0。

    _report 返回"是否完整成功"（步数 >= expected 且全步骤 ok），main 所有
    路径返回布尔，__main__ 传播为进程退出码（与 #28 同类的 fail-close）。
    """
    p = ROOT / "scripts" / "e2e_test.py"
    patch_text(
        p,
        old='''    _report(steps, time.time() - t_start)
    print("\\n🎉 端到端测试完成！")
    print(f"\\n查看卡片：{ROOT / 'data' / 'cards'}")
    print(f"启动看板：python scripts/dashboard/serve.py --port 8787")
    print(f"浏览器：http://localhost:8787")

def _report(steps, total):
    print("\\n" + "=" * 60)
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
    main(args)''',
        new='''    # 完整跑 6 步；--skip-crawl 少爬一步 = 5。步数不足 = 中途早退（#30）
    ok = _report(steps, time.time() - t_start,
                 expected=5 if args.skip_crawl else 6)
    if ok:
        print("\\n🎉 端到端测试完成！")
        print(f"\\n查看卡片：{ROOT / 'data' / 'cards'}")
        print(f"启动看板：python scripts/dashboard/serve.py --port 8787")
        print(f"浏览器：http://localhost:8787")
    return ok

def _report(steps, total, expected=6):
    """打印报告并返回"是否完整成功"。早退路径步数不足 expected → False；
    任一步骤失败 → False。退出码在 __main__ 传播，失败不再假装成功（#30）。"""
    print("\\n" + "=" * 60)
    print("📊 测试报告")
    print("=" * 60)
    for name, ok, dt in steps:
        print(f"  {'✅' if ok else '❌'} {name:12s} {dt:6.1f}s")
    print(f"  {'⏱️':12s} 总计 {total:.1f}s")
    print("=" * 60)
    return len(steps) >= expected and all(flag for _, flag, _ in steps)

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--keyword", default="独立开发者")
    p.add_argument("--platform", default="bilibili")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--comments", type=int, default=100)
    p.add_argument("--skip-crawl", action="store_true")
    args = p.parse_args()
    raise SystemExit(0 if main(args) else 1)''',
        marker="raise SystemExit(0 if main(args)",
        desc="e2e: 退出码传播（#30）",
    )


def fix_e2e_organize() -> None:
    """用户要求（2026-10-17）：每个项目（关键词）的产出归档到
    data/projects/{关键词}/ 子文件夹。e2e 收尾（看板重建后）调用
    organize_project.py --run，归档失败即整体失败（steps.append，#30 同纪律）。
    锚点 = fix_e2e_exitcode 产出后的"收尾：重建 dashboard.json"块。
    """
    p = ROOT / "scripts" / "e2e_test.py"
    patch_text(
        p,
        old='''        # 重建看板（以卡片为准，避免重复）
        run(
            [sys.executable, str(ROOT / "scripts" / "dashboard" / "write_dashboard.py")],
            "收尾：重建 dashboard.json"
        )
''',
        new='''        # 重建看板（以卡片为准，避免重复）
        run(
            [sys.executable, str(ROOT / "scripts" / "dashboard" / "write_dashboard.py")],
            "收尾：重建 dashboard.json"
        )

        # 归档本项目产出到 data/projects/{关键词}/（每项目一个子文件夹）
        ok_org, dt_org = run(
            [sys.executable, str(PIPELINE / "organize_project.py"),
             "--run", "--keyword", args.keyword,
             "--run-start", str(t_start), "--no-dashboard"],
            "收尾：归档本轮产出"
        )
        steps.append(("organize", ok_org, dt_org))
''',
        marker="organize_project.py",
        desc="e2e: 收尾归档到 data/projects/{关键词}/（用户归档需求）",
    )


def fix_scoring() -> None:
    """评分去伪：无数据来源的维度不伪造恒定分。"""
    p = ROOT / "scripts" / "pipeline" / "score_opportunity.py"
    patch_text(
        p,
        old='''    # 需求强度：平均痛点 + 付费信号
    demand = min(5, max(1, round(avg_pain / 2 + (1 if "付费意愿" in sigs else 0))))
    # 竞争空缺：暂默认中等（无外部数据时保守）
    competition = 3
    # 个人可行性：聚类规模小通常更聚焦
    feasibility = 5 if size < 50 else (4 if size < 200 else 3)
    # 触达难度：有明确渠道（聚类本身就来自渠道）
    reach = 4
    # AI杠杆：默认较高（文本类任务）
    ai_leverage = 4
    return {
        "demand": demand, "competition": competition,
        "feasibility": feasibility, "reach": reach, "ai_leverage": ai_leverage
    }''',
        new='''    # 需求强度：平均痛点 + 付费信号
    demand = min(5, max(1, round(avg_pain / 2 + (1 if "付费意愿" in sigs else 0))))
    # 个人可行性：聚类规模小通常更聚焦
    feasibility = 5 if size < 50 else (4 if size < 200 else 3)
    return {
        "demand": demand, "competition": None,
        "feasibility": feasibility, "reach": None, "ai_leverage": None
    }''',
        marker='"reach": None',
        desc="score: 启发式只输出有数据维度",
    )
    patch_text(
        p,
        old='''def _compose_total(scores: dict) -> float:
    total = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)  # 1-5 加权
    return round(total / 5 * 100, 1)  # 归一到 100''',
        new='''def _compose_total(scores: dict) -> float:
    """仅对有值的维度求简单均值，归一到 100；无有效维度返回 0。"""
    valid = [scores[k] for k in WEIGHTS if scores.get(k) is not None]
    if not valid:
        return 0.0
    return round(sum(valid) / len(valid) * 20, 1)''',
        marker="无有效维度返回 0",
        desc="score: 总分只用有效维度",
    )


def fix_export_card() -> None:
    """卡片可读性：标题格式化；None 维度渲染 —。"""
    p = ROOT / "scripts" / "pipeline" / "export_card.py"
    patch_text(
        p,
        old='''def _format_list(items):
    if not items:
        return "- （暂无）"
    return "\\n".join(f"- {i}" for i in items)

def export(input_file, top=5):''',
        new='''def _format_list(items):
    if not items:
        return "- （暂无）"
    return "\\n".join(f"- {i}" for i in items)


def format_title(quotes, max_len: int = 30) -> str:
    """卡片标题：首条非空代表原话，去首尾标点，超长截断加省略号。"""
    text = next((q for q in (quotes or []) if q), "").strip() if quotes else ""
    text = text.strip("，。！？、；：,.!?;: ")
    if not text:
        return "未命名痛点"
    return text[:max_len] + "…" if len(text) > max_len else text


def format_dim(value):
    """评分渲染：None（无数据来源）显示 —，而不是伪造分。"""
    return f"{value}/5" if value is not None else "—"


def export(input_file, top=5):''',
        marker="def format_dim",
        desc="export: format_title/format_dim",
    )
    patch_text(
        p,
        old='''        title = (p.get("representative_quotes") or ["未命名痛点"])[0][:40]''',
        new='''        title = format_title(p.get("representative_quotes"))''',
        marker="title = format_title(",
        desc="export: 标题格式化",
    )
    patch_text(
        p,
        old='''            demand=p["scores"]["demand"],
            competition=p["scores"]["competition"],
            feasibility=p["scores"]["feasibility"],
            reach=p["scores"]["reach"],
            ai_leverage=p["scores"]["ai_leverage"],''',
        new='''            demand=format_dim(p["scores"].get("demand")),
            competition=format_dim(p["scores"].get("competition")),
            feasibility=format_dim(p["scores"].get("feasibility")),
            reach=format_dim(p["scores"].get("reach")),
            ai_leverage=format_dim(p["scores"].get("ai_leverage")),''',
        marker="demand=format_dim(",
        desc="export: 维度 None 渲染 —",
    )
    for dim in ("demand", "competition", "feasibility", "reach", "ai_leverage"):
        patch_text(
            p,
            old="| {%s}/5 |" % dim,
            new="| {%s} |" % dim,
            marker="| {%s} |" % dim,
            desc="export: 模板行 %s" % dim,
        )


def fix_serve() -> None:
    """Dashboard 静态资源防路径穿越。"""
    p = ROOT / "scripts" / "dashboard" / "serve.py"
    patch_text(
        p,
        old='''from urllib.parse import urlparse''',
        new='''from urllib.parse import unquote, urlparse''',
        marker="import unquote",
        desc="serve: import unquote（%xx 解码，OPEN_ISSUES #13）",
    )
    patch_text(
        p,
        old='''ASSETS = ROOT / "assets" / "dashboard"

class Handler(BaseHTTPRequestHandler):''',
        new='''ASSETS = ROOT / "assets" / "dashboard"


def resolve_asset(rel: str):
    """把 URL 相对路径解析为 ASSETS 内的文件；越界返回 None（防路径穿越）。

    先 %xx 解码再做边界检查（OPEN_ISSUES #13）：浏览器对中文名发的是
    percent-encoded 路径，不解码永远 403；解码若晚于检查，%2e%2e%2f 可绕过穿越防线。
    """
    rel = unquote(rel)
    try:
        candidate = (ASSETS / rel).resolve()
        candidate.relative_to(ASSETS.resolve())
    except (ValueError, OSError):
        return None
    return candidate if candidate.is_file() else None


class Handler(BaseHTTPRequestHandler):''',
        marker="def resolve_asset",
        desc="serve: resolve_asset",
    )
    patch_text(
        p,
        old='''        else:
            # 静态资源（style.css / app.js）
            rel = path.lstrip("/")
            self._send_file(ASSETS / rel)''',
        new='''        else:
            # 静态资源（style.css / app.js）——必须防路径穿越
            rel = urlparse(self.path).path.lstrip("/")
            asset = resolve_asset(rel)
            if asset is None:
                self.send_error(403)
                return
            self._send_file(asset)''',
        marker="resolve_asset(rel)",
        desc="serve: do_GET 接线",
    )


def fix_safe_filename_wiring() -> None:
    """Review Focus #3：关键词含路径非法字符时输出文件名必须净化（三处接线）。"""
    p = ROOT / "scripts" / "pipeline" / "discover_content.py"
    patch_text(
        p,
        old='''OUTPUT_DIR = Path("data/discovered")''',
        new='''from run_inputs import safe_filename

OUTPUT_DIR = Path("data/discovered")''',
        marker="from run_inputs import safe_filename",
        desc="discover: import safe_filename",
    )
    patch_text(
        p,
        old='''    out_file = OUTPUT_DIR / f"{keyword}_{datetime.now().strftime('%Y%m%d_%H%M')}.json"''',
        new='''    out_file = OUTPUT_DIR / f"{safe_filename(keyword)}_{datetime.now().strftime('%Y%m%d_%H%M')}.json"''',
        marker="safe_filename(keyword)}_",
        desc="discover: 输出文件名净化",
    )
    p = ROOT / "scripts" / "pipeline" / "run_all.py"
    patch_text(
        p,
        old='''    from run_inputs import collect_raw_files''',
        new='''    from run_inputs import collect_raw_files, safe_filename''',
        marker="collect_raw_files, safe_filename",
        desc="run_all: import safe_filename",
    )
    patch_text(
        p,
        old='''    files = sorted(discovered_dir.glob(f"{args.keyword}_*.json"), key=lambda p: p.stat().st_mtime)''',
        new='''    files = sorted(discovered_dir.glob(f"{safe_filename(args.keyword)}_*.json"), key=lambda p: p.stat().st_mtime)''',
        marker='safe_filename(args.keyword)}_*.json',
        desc="run_all: discovered glob 前缀净化",
    )
    p = ROOT / "scripts" / "e2e_test.py"
    patch_text(
        p,
        old='''from pipeline.run_inputs import collect_raw_files''',
        new='''from pipeline.run_inputs import collect_raw_files, safe_filename''',
        marker="collect_raw_files, safe_filename",
        desc="e2e: import safe_filename",
    )
    patch_text(
        p,
        old='''    discovered = latest(ROOT / "data" / "discovered", f"{args.keyword}_*.json")''',
        new='''    discovered = latest(ROOT / "data" / "discovered", f"{safe_filename(args.keyword)}_*.json")''',
        marker='safe_filename(args.keyword)}_*.json',
        desc="e2e: discovered glob 前缀净化",
    )


def fix_discover_failclose(p: Path = None) -> None:
    """discover fail-close（P6 重验 2026-10-15 发现）：全部平台失败时模板态
    仍 exit 0 + 写空 [] 文件，e2e Step 1 据 returncode 判 ✅ 假成功，真正失败
    被推到 crawl 步误报。改为零发现即在源头退出非 0 并点名失败平台（NFR 4.1）。"""
    p = p or (ROOT / "scripts" / "pipeline" / "discover_content.py")
    patch_text(
        p,
        old='''import argparse
import json
from datetime import datetime''',
        new='''import argparse
import json
import sys
from datetime import datetime''',
        marker="import sys\nfrom datetime import datetime",
        desc="discover: import sys",
    )
    patch_text(
        p,
        old='''def discover(keyword, platforms, limit):
    all_results = []
    for p in platforms:''',
        new='''def discover(keyword, platforms, limit):
    all_results = []
    failed = []       # 异常失败平台（风控/网络）
    unavailable = []  # 依赖未装或未配置
    for p in platforms:''',
        marker="failed = []       # 异常失败平台",
        desc="discover: 失败/不可用平台记账",
    )
    patch_text(
        p,
        old='''                print(f"⚠️ {p} 适配器不可用（依赖未装或未配置）")
                continue''',
        new='''                print(f"⚠️ {p} 适配器不可用（依赖未装或未配置）")
                unavailable.append(p)
                continue''',
        marker="unavailable.append(p)",
        desc="discover: 记录不可用平台",
    )
    patch_text(
        p,
        old='''        except Exception as e:
            print(f"❌ {p} 失败：{e}")''',
        new='''        except Exception as e:
            print(f"❌ {p} 失败：{e}")
            failed.append(p)''',
        marker="failed.append(p)",
        desc="discover: 记录异常失败平台",
    )
    patch_text(
        p,
        old='''    out_file.write_text(json.dumps(ranked, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\\n💾 已保存 {len(ranked)} 条 → {out_file}")

    print("\\n📊 Top 5 值得爬取：")''',
        new='''    # 零产出也照写（占位空文件），防止下游 latest() 复用上一轮旧产物（NFR 4.1）
    out_file.write_text(json.dumps(ranked, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\\n💾 已保存 {len(ranked)} 条 → {out_file}")

    if not ranked:
        # fail-close：零发现必须在源头以退出码说话，不许 exit 0 + 空文件
        # 假装成功把失败推给下游误报（P6 重验 2026-10-15 发现的 v_voucher 路径）
        causes = []
        if failed:
            causes.append(f"失败平台：{', '.join(failed)}")
        if unavailable:
            causes.append(f"适配器不可用：{', '.join(unavailable)}")
        if not causes:
            causes.append("全部平台返回 0 条候选")
        print(f"❌ 零发现，fail-close 退出非 0（{'；'.join(causes)}）")
        sys.exit(1)

    print("\\n📊 Top 5 值得爬取：")''',
        marker="fail-close 退出非 0",
        desc="discover: 零发现 fail-close 退出非 0",
    )


def fix_storage(p: Path = None) -> None:
    """storage 两段修复（overlay 为权威，extract 覆盖模板不影响）：
    1. 入库计数诚实化：conn.total_changes 是连接级累计值，会把 IGNORE 的重复
       误计为新增；改用 cursor.rowcount（新插=1，IGNORE=0）。
    2. JSONL 跨 run 去重（OPEN_ISSUES #20）：模板无条件追加导致重复
       comment_id 跨 run 累积、漏斗 loaded 虚高；改为写前读入已有 id，
       批内边写边加。"""
    p = p or (ROOT / "scripts" / "pipeline" / "storage.py")
    patch_text(
        p,
        old='''            try:
                conn.execute(
                    """INSERT OR IGNORE INTO comments
                       (id, platform, source_id, source_title, content, author,
                        likes, replies, timestamp, url, extra)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        norm["id"], norm["platform"], norm.get("source_id") or source_id,
                        norm.get("source_title"), norm.get("content"), norm.get("author"),
                        norm.get("likes") or 0, norm.get("replies") or 0,
                        norm.get("timestamp"), norm.get("url"),
                        json.dumps(norm.get("extra") or {}, ensure_ascii=False)
                    )
                )
                if conn.total_changes:
                    inserted += 1
                f.write(json.dumps(norm, ensure_ascii=False) + "\\n")
            except sqlite3.Error:
                skipped += 1''',
        new='''            try:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO comments
                       (id, platform, source_id, source_title, content, author,
                        likes, replies, timestamp, url, extra)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        norm["id"], norm["platform"], norm.get("source_id") or source_id,
                        norm.get("source_title"), norm.get("content"), norm.get("author"),
                        norm.get("likes") or 0, norm.get("replies") or 0,
                        norm.get("timestamp"), norm.get("url"),
                        json.dumps(norm.get("extra") or {}, ensure_ascii=False)
                    )
                )
                if cur.rowcount:
                    inserted += 1
                f.write(json.dumps(norm, ensure_ascii=False) + "\\n")
            except sqlite3.Error:
                skipped += 1''',
        marker="cur.rowcount",
        desc="storage: 计数改 cursor.rowcount",
    )
    patch_text(
        p,
        old='''def save_records(records: Iterable[Dict[str, Any]], platform: str, source_id: str = ""):
    """批量写入 JSONL + SQLite，自动去重"""
    JSONL_DIR.mkdir(parents=True, exist_ok=True)
    jsonl_path = JSONL_DIR / f"{platform}_{source_id or 'all'}.jsonl"

    conn = init_db()
    inserted = 0
    skipped = 0

    with open(jsonl_path, "a", encoding="utf-8") as f:
        for r in records:
            norm = _normalize(r)
            norm["platform"] = norm.get("platform") or platform
            if not norm.get("id"):
                skipped += 1
                continue
            try:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO comments
                       (id, platform, source_id, source_title, content, author,
                        likes, replies, timestamp, url, extra)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        norm["id"], norm["platform"], norm.get("source_id") or source_id,
                        norm.get("source_title"), norm.get("content"), norm.get("author"),
                        norm.get("likes") or 0, norm.get("replies") or 0,
                        norm.get("timestamp"), norm.get("url"),
                        json.dumps(norm.get("extra") or {}, ensure_ascii=False)
                    )
                )
                if cur.rowcount:
                    inserted += 1
                f.write(json.dumps(norm, ensure_ascii=False) + "\\n")
            except sqlite3.Error:
                skipped += 1

    conn.commit()
    conn.close()
    print(f"💾 写入 {inserted} 条（跳过 {skipped}）→ {jsonl_path}")
    return inserted''',
        new='''def _existing_jsonl_ids(jsonl_path: Path) -> set:
    """读取 JSONL 中已有的 comment_id —— JSONL 是漏斗数据源，自身即去重权威。

    依赖 SQLite 行数会失守：DB 被清后重爬，INSERT 全算新行，JSONL 照样重复追加。
    """
    ids = set()
    if not jsonl_path.exists():
        return ids
    with open(jsonl_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rid = json.loads(line).get("id")
            except json.JSONDecodeError:
                continue  # 坏行不阻断去重（与 mine 坏行跳过一致）
            if rid:
                ids.add(rid)
    return ids


def save_records(records: Iterable[Dict[str, Any]], platform: str, source_id: str = ""):
    """批量写入 JSONL + SQLite，自动去重（批内 + 跨 run，OPEN_ISSUES #20）"""
    JSONL_DIR.mkdir(parents=True, exist_ok=True)
    jsonl_path = JSONL_DIR / f"{platform}_{source_id or 'all'}.jsonl"

    conn = init_db()
    inserted = 0
    skipped = 0
    deduped = 0
    seen_ids = _existing_jsonl_ids(jsonl_path)

    with open(jsonl_path, "a", encoding="utf-8") as f:
        for r in records:
            norm = _normalize(r)
            norm["platform"] = norm.get("platform") or platform
            if not norm.get("id"):
                skipped += 1
                continue
            if norm["id"] in seen_ids:
                # 跨 run 重爬 / 分页重叠的重复 —— 不追加，漏斗 loaded 不再虚高
                deduped += 1
                continue
            try:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO comments
                       (id, platform, source_id, source_title, content, author,
                        likes, replies, timestamp, url, extra)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        norm["id"], norm["platform"], norm.get("source_id") or source_id,
                        norm.get("source_title"), norm.get("content"), norm.get("author"),
                        norm.get("likes") or 0, norm.get("replies") or 0,
                        norm.get("timestamp"), norm.get("url"),
                        json.dumps(norm.get("extra") or {}, ensure_ascii=False)
                    )
                )
                if cur.rowcount:
                    inserted += 1
                f.write(json.dumps(norm, ensure_ascii=False) + "\\n")
                seen_ids.add(norm["id"])  # 批内去重：分页重叠的同 id 只写一次
            except sqlite3.Error:
                skipped += 1

    conn.commit()
    conn.close()
    msg = f"💾 写入 {inserted} 条"
    if deduped:
        msg += f"（去重 {deduped} 条）"
    if skipped:
        msg += f"（跳过 {skipped} 条）"
    print(f"{msg} → {jsonl_path}")
    return inserted''',
        marker="_existing_jsonl_ids",
        desc="storage: JSONL 跨 run comment_id 去重（#20）",
    )
    # patch3：SQLite 复合主键 (platform, source_id, id) + 旧库迁移（#12）。
    # 模板仍是单 id TEXT PRIMARY KEY，跨平台同 id 被 INSERT OR IGNORE 静默互覆。
    patch_text(
        p,
        old='''def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            platform TEXT,
            source_id TEXT,
            source_title TEXT,
            content TEXT,
            author TEXT,
            likes INTEGER,
            replies INTEGER,
            timestamp TEXT,
            url TEXT,
            extra TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_platform ON comments(platform)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_source ON comments(source_id)")
    conn.commit()
    return conn''',
        new='''COMMENTS_DDL = """CREATE TABLE IF NOT EXISTS comments (
            id TEXT,
            platform TEXT,
            source_id TEXT,
            source_title TEXT,
            content TEXT,
            author TEXT,
            likes INTEGER,
            replies INTEGER,
            timestamp TEXT,
            url TEXT,
            extra TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (platform, source_id, id)
        )"""

def _migrate_pk(conn):
    """旧库升级：单 id 主键 → (platform, source_id, id) 复合主键（OPEN_ISSUES #12）。

    跨平台同 id（bilibili '1' 与 reddit '1'）在旧 PK 下被 INSERT OR IGNORE
    静默互覆。PRAGMA table_info 检测旧 schema 后重建表并保数。
    """
    cols = conn.execute("PRAGMA table_info(comments)").fetchall()
    if not cols:
        return  # 空库，建表即新 schema
    pk = [c[1] for c in cols if c[5]]
    if set(pk) == {"platform", "source_id", "id"}:
        return  # 已是复合主键
    conn.execute("ALTER TABLE comments RENAME TO comments_legacy")
    conn.execute(COMMENTS_DDL.replace("IF NOT EXISTS ", ""))
    conn.execute("""INSERT OR IGNORE INTO comments
        (id, platform, source_id, source_title, content, author,
         likes, replies, timestamp, url, extra, created_at)
        SELECT id, COALESCE(platform,''), COALESCE(source_id,''), source_title,
               content, author, likes, replies, timestamp, url, extra, created_at
        FROM comments_legacy""")
    conn.execute("DROP TABLE comments_legacy")

def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    _migrate_pk(conn)
    conn.execute(COMMENTS_DDL)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_platform ON comments(platform)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_source ON comments(source_id)")
    conn.commit()
    return conn''',
        marker="PRIMARY KEY (platform, source_id, id)",
        desc="storage: 复合主键 + 旧库迁移（#12）",
    )


def fix_bilibili() -> None:
    """bilibili 适配器修复走 overlay（extract 会以仓库外 MVP.md 覆盖
    generate_p2.py 模板，模板级修复不可靠，overlay 为权威）。"""
    shutil.copyfile(FIXES_SRC / "bilibili.py",
                    ROOT / "scripts" / "pipeline" / "adapters" / "bilibili.py")
    report.append("🔧 bilibili.py ← overlay（WBI+游标+风控识别）")


def fix_demo() -> None:
    """demo.py 修复走 overlay（extract 会覆盖 generate_p6.py 模板）。"""
    shutil.copyfile(FIXES_SRC / "demo.py", ROOT / "scripts" / "demo.py")
    report.append("🔧 demo.py ← overlay（顺序执行修复）")


def fix_heal() -> None:
    """自愈系统改只读诊断：覆盖 heal_runner.py 与 self-heal.yml。"""
    shutil.copyfile(FIXES_SRC / "heal_runner.py",
                    ROOT / "scripts" / "healing" / "heal_runner.py")
    report.append("🔧 heal_runner.py → 只读诊断模式")
    shutil.copyfile(FIXES_SRC / "self-heal.yml",
                    ROOT / ".github" / "workflows" / "self-heal.yml")
    report.append("🔧 self-heal.yml → 手动触发 + artifact 上传")


def fix_design_mvp() -> None:
    """MVP 推荐按主导信号（频次降序），而非 dict 插入顺序（OPEN_ISSUES #24）。"""
    p = ROOT / "scripts" / "pipeline" / "design_mvp.py"
    patch_text(
        p,
        old='''def design_mvp(pain: dict) -> dict:
    sigs = list(pain.get("signal_distribution", {}).keys())
    quotes = pain.get("representative_quotes", [])''',
        new='''def design_mvp(pain: dict) -> dict:
    # 按频次降序取主导信号（OPEN_ISSUES #24）：dict 插入顺序不等于主导，
    # 首推与 deliverable_hint 都应跟随票数最高的信号。
    sigs = [k for k, _ in sorted(
        (pain.get("signal_distribution") or {}).items(),
        key=lambda kv: kv[1], reverse=True)]
    quotes = pain.get("representative_quotes", [])''',
        marker="按频次降序取主导信号",
        desc="design_mvp: 主导信号排序（#24）",
    )


def fix_exec_report_wire() -> None:
    """Iteration-1：run_all 末尾接入 exec_report —— 每次跑批自动产出
    「执行结果 + 每步为什么」报告（漏斗/分数拆解/被过滤理由/域自查）。

    marker=`exec_report`：已接入即跳过，因此重跑幂等；只有当 run_all 被
    生成器重建回原始状态时才会重新插入。
    """
    p = ROOT / "scripts" / "pipeline" / "run_all.py"
    patch_text(
        p,
        old='''        run([sys.executable, str(base / "export_card.py"),
             "--input", str(mvp_file), "--top", "5"])

    print("\\n🎉 全流程完成！")''',
        new='''        run([sys.executable, str(base / "export_card.py"),
             "--input", str(mvp_file), "--top", "5"])

    # EXEC_REPORT_HOOK：跑批后自动产出「执行结果 + 每步为什么」报告
    run([sys.executable, str(base / "exec_report.py"),
         "--keyword", args.keyword,
         "--discovered", str(latest),
         "--scored", str(mvp_file) if mvp_file.exists() else "",
         "--raw", *[str(p) for p in raw_files]])

    print("\\n🎉 全流程完成！")''',
        marker="exec_report",
        desc="run_all 末尾接入 exec_report 执行报告",
    )


def copy_canonical_modules() -> None:
    """Iteration-1 T11：权威副本覆盖同步。

    generators/fixes/{cluster,mine_pain_points,score_opportunity,export_card}.py
    是已含全部 overlay + iteration-1 T6-T10 修复（噪音过滤/兜底聚类/pain_summary/
    _build_card/score_confidence/文本去重/--topics/代表句 MMR）+ 0.3.0 证据驱动
    评分维度（竞争=对比+失望 / AI杠杆=形态词表，见 score_opportunity）的最终版本。
    生成器重跑后由本步骤覆盖回去，防止模板回退丢失修复。必须在各 patch 之后执行。
    """
    for name in ("cluster.py", "mine_pain_points.py", "score_opportunity.py", "export_card.py"):
        src = FIXES_SRC / name
        dst = ROOT / "scripts" / "pipeline" / name
        if not src.exists():
            raise SystemExit(f"❌ 缺少权威副本 {src}")
        shutil.copyfile(src, dst)
        report.append(f"📄 权威副本覆盖 {dst.relative_to(ROOT)}")


def main():
    copy_new_modules()
    fix_adapter_imports()
    fix_cluster()
    fix_mine()
    fix_run_all()
    fix_e2e()
    fix_crawl_manifest()
    fix_e2e_exitcode()
    fix_e2e_organize()
    fix_scoring()
    fix_export_card()
    fix_serve()
    fix_safe_filename_wiring()
    fix_discover_failclose()
    fix_run_all_failfast()
    fix_compliance_failclose()
    fix_mine_badlines()
    fix_score_dims()
    fix_export_scores_compat()
    fix_storage()
    fix_bilibili()
    fix_demo()
    fix_heal()
    fix_design_mvp()
    fix_exec_report_wire()
    copy_canonical_modules()
    # 生成后断言：bilibili overlay 必须生效（否则 MVP.md 覆盖模板且 overlay 失效）
    bili = (ROOT / "scripts" / "pipeline" / "adapters" / "bilibili.py").read_text(encoding="utf-8")
    if "wbi/search/type" not in bili:
        raise SystemExit("❌ bilibili.py 缺少 WBI 修复——apply_fixes overlay 未生效")
    demo = (ROOT / "scripts" / "demo.py").read_text(encoding="utf-8")
    if "def latest(" not in demo:
        raise SystemExit("❌ demo.py 缺少顺序执行修复——apply_fixes overlay 未生效")
    # 1. UTF-8 入口（复用 fix_utf8）
    r = subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "fix_utf8.py")],
                       capture_output=True, text=True)
    if r.returncode == 0:
        report.append("🔧 fix_utf8:" + r.stdout.splitlines()[0])
    for line in report:
        print(line)
    print("\n✅ apply_fixes 完成")


if __name__ == "__main__":
    main()
