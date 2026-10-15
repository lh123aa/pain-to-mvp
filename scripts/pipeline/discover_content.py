#!/usr/bin/env python3
"""
内容发现入口。跨平台搜索候选内容，输出排序列表。
用法：
  python discover_content.py --keyword "独立开发者获客" --platforms bilibili youtube --limit 20
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
import sys
from datetime import datetime
from pathlib import Path

from adapters import get_adapter
from compliance import preflight
from pipeline_score import filter_and_rank

from run_inputs import safe_filename

OUTPUT_DIR = Path("data/discovered")

def discover(keyword, platforms, limit):
    all_results = []
    failed = []       # 异常失败平台（风控/网络）
    unavailable = []  # 依赖未装或未配置
    for p in platforms:
        print(f"\n🌐 平台：{p}")
        try:
            adapter = get_adapter(p)
            if not adapter.is_available():
                print(f"⚠️ {p} 适配器不可用（依赖未装或未配置）")
                unavailable.append(p)
                continue
            results = adapter.discover(keyword, limit=limit)
            print(f"✅ 发现 {len(results)} 条候选")
            all_results.extend(results)
        except Exception as e:
            print(f"❌ {p} 失败：{e}")
            failed.append(p)
            # 记录 bug
            try:
                from healing.capture_bug import capture_bug
                capture_bug(phase="Phase 2", tool=p, severity="medium", error=str(e))
            except Exception:
                pass

    ranked = filter_and_rank(all_results)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file = OUTPUT_DIR / f"{safe_filename(keyword)}_{datetime.now().strftime('%Y%m%d_%H%M')}.json"
    # 零产出也照写（占位空文件），防止下游 latest() 复用上一轮旧产物（NFR 4.1）
    out_file.write_text(json.dumps(ranked, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n💾 已保存 {len(ranked)} 条 → {out_file}")

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

    print("\n📊 Top 5 值得爬取：")
    for r in ranked[:5]:
        print(f"  - [{r['platform']}] {r.get('title', '')[:40]} | 评论 {r.get('comment_count', 0)} | 分 {r['_rank_score']}")
    return ranked

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--keyword", required=True)
    p.add_argument("--platforms", nargs="+", default=["bilibili"])
    p.add_argument("--limit", type=int, default=20)
    args = p.parse_args()
    discover(args.keyword, args.platforms, args.limit)
