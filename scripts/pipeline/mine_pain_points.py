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
        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    comments.append(json.loads(line))
        return comments
    if platform:
        return query_comments(platform=platform, limit=limit)
    return []

def mine(input_file=None, platform=None, limit=1000, min_pain=3, min_cluster=3, inputs=None):
    raw = _load_input(input_file, platform, limit, inputs)
    print(f"📥 载入 {len(raw)} 条评论")

    cleaned = preprocess_comments(raw)
    print(f"🧹 清洗后 {len(cleaned)} 条")

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
        pains.append({
            "cluster_id": c["cluster_id"],
            "size": c["size"],
            "avg_pain": c["avg_pain"],
            "total_pain": c["total_pain"],
            "signal_distribution": sig_counter,
            "representative_quotes": c["representative"],
            "evidence_ids": [m.get("id") for m in c["members"][:5]],
            "method": c["method"],
        })

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    tag = platform or Path(input_file).stem if input_file else "all"
    out_file = OUTPUT_DIR / f"pains_{tag}_{ts}.json"
    out_file.write_text(json.dumps(pains, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n💾 已保存 → {out_file}")

    print("\n📊 Top 3 痛点簇：")
    for p in pains[:3]:
        print(f"  - 簇{p['cluster_id']} | {p['size']}条 | 平均痛点 {p['avg_pain']} | {list(p['signal_distribution'].keys())}")
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
    args = p.parse_args()
    mine(args.input, args.platform, args.limit, args.min_pain, args.min_cluster, inputs=args.inputs)
