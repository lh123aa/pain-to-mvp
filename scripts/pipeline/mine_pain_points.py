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


def _keep_topics(comments, topics=None):
    """主题聚焦过滤（T10）：多视频混合评论中剔除与目标领域无关的闲聊。

    数据源常为多个视频的评论区合并，闲聊/玩梗评论（"超市菜价""包工头"）
    命中通用痛感词后会污染聚类。指定主题词后只保留命中任一词的评论。
    """
    if not topics:
        return comments
    out = []
    for c in comments:
        text = c.get("clean_content") or c.get("content") or ""
        if any(t in text for t in topics):
            out.append(c)
    return out


def _output_tag(platform, input_file):
    """输出文件名 tag：三元优先级低于 or，显式括号固定意图（OPEN_ISSUES #17）。

    `platform or stem if input_file else 'all'` 实为 `(platform or stem) if input_file else 'all'`。
    语义保持不变：无 input_file 时恒 'all'，有 input_file 时 platform 优先。
    """
    return (platform or Path(input_file).stem) if input_file else "all"


_STRONG_SIGNALS = {"求助", "期望", "付费意愿"}
_QUOTE_PUNCT = "，。！？、；：,.!?;: "


def _select_summary_quote(representative, members):
    """痛点描述引句（A5 2026-10-15 抽检根因①）：只取携带强行动信号的代表句。

    段子（"笑死，干运维还没用到Python" 靠子串"没用"误命中失望）永不当描述；
    无强信号句时返回 ''——pain_summary 保留"N条评论集中反映「信号」"前缀，
    宁可描述不带引句，也不拿段子冒充痛点陈述（不许骗人）。
    """
    labels_by_quote = {}
    for m in members or []:
        labs = {s.get("label") for s in (m.get("pain_signals") or [])}
        if not labs:
            continue
        for t in (m.get("clean_content"), m.get("content")):
            if t and t.strip():
                labels_by_quote.setdefault(t.strip(), set()).update(labs)
    for q in representative or []:
        q = (q or "").strip()
        if q and labels_by_quote.get(q, set()) & _STRONG_SIGNALS:
            return q.strip(_QUOTE_PUNCT)
    return ""


def mine(input_file=None, platform=None, limit=1000, min_pain=3, min_cluster=3, inputs=None, output=None, topics=None):
    raw = _load_input(input_file, platform, limit, inputs)
    print(f"📥 载入 {len(raw)} 条评论")

    cleaned = preprocess_comments(raw)
    print(f"🧹 清洗后 {len(cleaned)} 条")

    deduped = _dedup_by_text(cleaned)
    if len(deduped) < len(cleaned):
        print(f"🔁 文本去重 {len(cleaned) - len(deduped)} 条（跨视频重复评论）")
        cleaned = deduped

    if topics:
        before = len(cleaned)
        cleaned = _keep_topics(cleaned, topics)
        print(f"🎯 主题聚焦「{'/'.join(topics)}」保留 {len(cleaned)}/{before} 条")

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
        best_quote = _select_summary_quote(quotes, c["members"])
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
    tag = _output_tag(platform, input_file)
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
    p.add_argument("--topics", nargs="+", help="主题词列表：只保留命中任一词的评论（多视频混合源聚焦领域）")
    args = p.parse_args()
    mine(args.input, args.platform, args.limit, args.min_pain, args.min_cluster, inputs=args.inputs, output=args.output, topics=args.topics)
