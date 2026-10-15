#!/usr/bin/env python3
"""
评分校准闭环（OPEN_ISSUES #11 / PRD §五）。

PRD §五约定的闭环：每轮跑完抽检 top3 卡片 → 追加 calibration.jsonl →
累计每满 20 条回看一次规则命中率，决定是否调 pain_rules.SIGNALS / 权重。

用法：
  记录一条抽检：python calibration.py record --card-id 20261015-001 --verdict real --note "痛点真实、可据卡行动"
  回看命中率：  python calibration.py review [--calibration data/calibration/calibration.jsonl]

设计约定：
- fail-close：非法 verdict / 空 note / 重复卡片一律拒绝，不写脏数据（不许骗人）
- 坏行跳过 + 警告，不崩溃（与 mine --inputs 同款约定）
- signals 自动从 data/cards/<card_id>.md 抽取（review 算信号级命中率的数据来源）
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
import re
from datetime import datetime
from pathlib import Path

DEFAULT_CAL = Path("data/calibration/calibration.jsonl")
CARDS_DIR = Path("data/cards")
TARGET = 20  # PRD §五：累计每满 20 条回看一次规则命中率

VALID_VERDICTS = {"real", "fake"}
# 记录格式契约：record 写入、review 读取都以这组字段为准
SCHEMA_FIELDS = ("date", "card_id", "verdict", "note", "run", "rank",
                 "quotes_traceable", "signals")

_SIGNAL_LINE = re.compile(r"信号分布\*\*：(\{.*?\})")


def _extract_signals_from_card(card_id: str) -> dict | None:
    """从卡片 md 的「信号分布」行抽取信号计数；无卡片/无信号返回 None。"""
    card_path = CARDS_DIR / f"{card_id}.md"
    if not card_path.exists():
        return None
    m = _SIGNAL_LINE.search(card_path.read_text(encoding="utf-8"))
    if not m:
        return None
    try:
        sigs = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    return sigs or None


def record(file, card_id: str, verdict: str, note: str, run: str = None,
           rank: int = None, quotes_traceable: bool = None,
           signals: dict = None, date: str = None) -> dict:
    """追加一条抽检记录；非法输入抛 ValueError 且不落盘。"""
    if verdict not in VALID_VERDICTS:
        raise ValueError(f"verdict 只允许 {sorted(VALID_VERDICTS)}，收到 {verdict!r}")
    if not (note or "").strip():
        raise ValueError("note 不能为空——无理由的抽检记录没有回看价值")
    if not (card_id or "").strip():
        raise ValueError("card_id 不能为空")

    file = Path(file)
    if file.exists():
        existing = _load_records(file)[0]
        if any(r.get("card_id") == card_id for r in existing):
            raise ValueError(f"卡片 {card_id} 已有抽检记录——重复计数会污染命中率")

    entry = {
        "date": date or datetime.now().strftime("%Y-%m-%d"),
        "card_id": card_id,
        "verdict": verdict,
        "note": note.strip(),
        "run": run,
        "rank": rank,
        "quotes_traceable": quotes_traceable,
        "signals": signals if signals is not None else _extract_signals_from_card(card_id),
    }
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def _load_records(file) -> tuple[list, int]:
    """读取 JSONL：返回 (有效记录, 坏行数)。坏行跳过 + 警告。"""
    records, bad = [], 0
    for line in Path(file).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            bad += 1
            print(f"⚠️ calibration 坏行已跳过：{line[:60]}…")
    return records, bad


def review(file, target: int = TARGET) -> dict:
    """回看命中率：总体真实率 + top3 口径（成功线）+ 信号级命中率。"""
    records, bad = _load_records(file)
    total = len(records)
    real_count = sum(1 for r in records if r.get("verdict") == "real")
    fake_count = sum(1 for r in records if r.get("verdict") == "fake")

    top3 = [r for r in records if isinstance(r.get("rank"), int) and r["rank"] <= 3]
    top3_real = sum(1 for r in top3 if r.get("verdict") == "real")

    # 信号级命中率：信号在真卡/假卡中的出现率 → 弱信号是调权候选
    sig_real, sig_total = {}, {}
    for r in records:
        for sig in (r.get("signals") or {}):
            sig_total[sig] = sig_total.get(sig, 0) + 1
            if r.get("verdict") == "real":
                sig_real[sig] = sig_real.get(sig, 0) + 1
    signal_hit_rates = {
        sig: {"total": n, "real": sig_real.get(sig, 0),
              "rate": sig_real.get(sig, 0) / n}
        for sig, n in sorted(sig_total.items(), key=lambda kv: -kv[1])
    }

    return {
        "total": total,
        "real_count": real_count,
        "fake_count": fake_count,
        "hit_rate": real_count / total if total else None,
        "top3_total": len(top3),
        "top3_hit_rate": top3_real / len(top3) if top3 else None,
        "signal_hit_rates": signal_hit_rates,
        "target": target,
        "reached_target": total >= target,
        "skipped_bad_lines": bad,
    }


def main():
    p = argparse.ArgumentParser(description="评分校准闭环（PRD §五）")
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("record", help="记录一条 top 卡片抽检")
    pr.add_argument("--card-id", required=True)
    pr.add_argument("--verdict", required=True, choices=sorted(VALID_VERDICTS))
    pr.add_argument("--note", required=True, help="判定理由（真/假的依据）")
    pr.add_argument("--run", help="运行标识，如 e2e-A5")
    pr.add_argument("--rank", type=int, help="卡片在本轮排名（top3 口径用）")
    pr.add_argument("--quotes-traceable", action="store_true",
                    help="代表原话是否可回溯到原始评论")
    pr.add_argument("--date", help="抽检日期 YYYY-MM-DD（默认今天）")
    pr.add_argument("--calibration", default=str(DEFAULT_CAL))

    pv = sub.add_parser("review", help="回看命中率（满 20 条即达回看线）")
    pv.add_argument("--calibration", default=str(DEFAULT_CAL))
    pv.add_argument("--target", type=int, default=TARGET)

    args = p.parse_args()
    if args.cmd == "record":
        entry = record(Path(args.calibration), args.card_id, args.verdict,
                       args.note, run=args.run, rank=args.rank,
                       quotes_traceable=args.quotes_traceable, date=args.date)
        print(f"✅ 抽检已记录：{entry['card_id']} → {entry['verdict']}")
        return

    result = review(Path(args.calibration), target=args.target)
    print(f"📋 校准回看：共 {result['total']} 条抽检"
          f"（真 {result['real_count']} / 假 {result['fake_count']}）")
    if result["hit_rate"] is not None:
        print(f"   总体命中率：{result['hit_rate']:.1%}"
              f" ｜ top3 口径：{result['top3_hit_rate'] if result['top3_hit_rate'] is not None else '—'}"
              f"（{result['top3_total']} 条）")
    print(f"   进度：{result['total']}/{result['target']}"
          f"{'——已达回看线，应回看规则命中率' if result['reached_target'] else ''}")
    if result["signal_hit_rates"]:
        print("   信号级命中率（低命中 = 调权候选）：")
        for sig, s in result["signal_hit_rates"].items():
            print(f"     {sig}: {s['rate']:.0%}（{s['real']}/{s['total']}）")


if __name__ == "__main__":
    main()
