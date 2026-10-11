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
        marker="import time",
        desc="run_all: import time",
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
        marker='"competition": None,',
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
        old='''ASSETS = ROOT / "assets" / "dashboard"

class Handler(BaseHTTPRequestHandler):''',
        new='''ASSETS = ROOT / "assets" / "dashboard"


def resolve_asset(rel: str):
    """把 URL 相对路径解析为 ASSETS 内的文件；越界返回 None（防路径穿越）。"""
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


def fix_storage() -> None:
    """入库计数诚实化：conn.total_changes 是连接级累计值，会把 IGNORE 的重复
    误计为新增；改用 cursor.rowcount（新插=1，IGNORE=0）。"""
    p = ROOT / "scripts" / "pipeline" / "storage.py"
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


def main():
    copy_new_modules()
    fix_adapter_imports()
    fix_cluster()
    fix_mine()
    fix_run_all()
    fix_e2e()
    fix_scoring()
    fix_export_card()
    fix_serve()
    fix_safe_filename_wiring()
    fix_storage()
    fix_bilibili()
    fix_demo()
    fix_heal()
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
