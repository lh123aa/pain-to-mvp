#!/usr/bin/env python3
"""
痛点挖掘入口：读评论 → 清洗 → 识别信号 → 聚类 → 输出痛点列表。
用法：
  python mine_pain_points.py --input data/raw/bilibili_xxx.jsonl --output data/pains/xxx.json
  python mine_pain_points.py --platform bilibili --limit 1000
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
from datetime import datetime
from pathlib import Path

from preprocess import preprocess_comments
from pain_rules import filter_painful
from cluster import cluster_comments
from run_inputs import merge_jsonl_records
from storage import query_comments

OUTPUT_DIR = Path("data/pains")

def _load_input(input_file=None, platform=None, limit=1000, inputs=None):
    if inputs:
        # 多文件全量合并去重（多视频/多来源评论不丢）
        return merge_jsonl_records([Path(p) for p in inputs])
    if input_file:
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
        return comments
    if platform:
        return query_comments(platform=platform, limit=limit)
    return []

def _dedup_by_text(comments):
    """文本级去重（T9）：同一评论在多个视频/来源下重复出现只保留首条。

    (platform, source_id, id) 去重无法覆盖跨视频重复——同一条热门吐槽
    会在多个视频下被抓到，虚增簇规模 → total_pain → 机会分。
    """
    seen = set()
    out = []
    for c in comments:
        key = " ".join((c.get("clean_content") or c.get("content") or "").split())
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def mine(input_file=None, platform=None, limit=1000, min_pain=3, min_cluster=3, inputs=None, output=None):
    raw = _load_input(input_file, platform, limit, inputs)
    print(f"📥 载入 {len(raw)} 条评论")

    cleaned = preprocess_comments(raw)
    print(f"🧹 清洗后 {len(cleaned)} 条")

    deduped = _dedup_by_text(cleaned)
    if len(deduped) < len(cleaned):
        print(f"🔁 文本去重 {len(cleaned) - len(deduped)} 条（跨视频重复评论）")
        cleaned = deduped

    painful = filter_painful(cleaned, min_score=min_pain)
    print(f"🔥 痛点评论 {len(painful)} 条")

    clusters = cluster_comments(painful, min_size=min_cluster)
    print(f"🧩 形成 {len(clusters)} 个痛点簇")

    # 汇总每个簇的痛点描述
    pains = []
    for c in clusters:
        # 汇总信号类型
        sig_counter = {}
        for m in c["members"]:
            for s in m.get("pain_signals", []):
                sig_counter[s["label"]] = sig_counter.get(s["label"], 0) + 1
        quotes = c["representative"]
        top_signal = max(sig_counter.items(), key=lambda kv: kv[1])[0] if sig_counter else "共性诉求"
        best_quote = (quotes[0] if quotes else "").strip().strip("，。！？、；：,.!?;: ")
        pain_summary = f"{c['size']}条评论集中反映「{top_signal}」" + (f"：{best_quote}" if best_quote else "")
        pains.append({
            "cluster_id": c["cluster_id"],
            "size": c["size"],
            "avg_pain": c["avg_pain"],
            "total_pain": c["total_pain"],
            "signal_distribution": sig_counter,
            "pain_summary": pain_summary,
            "representative_quotes": quotes,
            "evidence_ids": [m.get("id") for m in c["members"][:5]],
            "method": c["method"],
        })

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    tag = platform or Path(input_file).stem if input_file else "all"
    out_file = Path(output) if output else OUTPUT_DIR / f"pains_{tag}_{ts}.json"
    if out_file.parent != Path(""):
        out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(pains, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n💾 已保存 → {out_file}")

    print("\n📊 Top 3 痛点簇：")
    for p in pains[:3]:
        print(f"  - 簇{p['cluster_id']} | {p['size']}条 | 平均痛点 {p['avg_pain']} | {p.get('pain_summary', '')}")
        for q in p["representative_quotes"][:2]:
            print(f"      「{q[:50]}」")
    return pains

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--input", help="评论 JSONL 文件（单个）")
    p.add_argument("--inputs", nargs="+", help="多个评论 JSONL 文件（全量合并，优先于 --input）")
    p.add_argument("--platform", help="平台（从 SQLite 读）")
    p.add_argument("--limit", type=int, default=1000)
    p.add_argument("--min-pain", type=int, default=3)
    p.add_argument("--min-cluster", type=int, default=3)
    p.add_argument("--output", help="输出 JSON 路径（默认 data/pains/自动命名）")
    args = p.parse_args()
    mine(args.input, args.platform, args.limit, args.min_pain, args.min_cluster, inputs=args.inputs, output=args.output)
