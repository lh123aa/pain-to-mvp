#!/usr/bin/env python3
"""
执行报告：跑批结束后自动产出「执行结果 + 每步为什么这么执行」。

存在的意义（docs/exec-report-20261014-girl-objects.md 结论）：
漏斗、分数拆解、被过滤评论的逐条理由，此前只散落在 stdout 里，
人看得到过程才拿得到反馈 —— 这是「系统学会筛选」的前置。

本脚本**只读**现有产物（raw / discovered / scored）并重算漏斗，
不修改 mine / score / export 任何一步，因此不破坏 generators 模板同步。
"""
import io
import json
import sys
from datetime import datetime
from pathlib import Path

# --- UTF-8 入口稳定化（与 pipeline 其余脚本一致） ---
import os as _os

_here = _os.path.dirname(_os.path.abspath(__file__))
for _cand in (_here, _os.path.dirname(_here), _os.path.join(_os.path.dirname(_here), "pipeline")):
    if _os.path.isdir(_os.path.join(_cand, "pipeline")) and _cand not in sys.path:
        sys.path.insert(0, _cand)
        break
try:
    from pipeline.encoding import ensure_utf8

    ensure_utf8()
except Exception:
    pass

from pain_rules import detect_signals, filter_painful  # noqa: E402
from preprocess import preprocess_comments  # noqa: E402
from mine_pain_points import _dedup_by_text  # noqa: E402
from run_inputs import safe_filename  # noqa: E402

try:
    from score_opportunity import DIMS  # 单一真相源：评分维度顺序
except Exception:  # pragma: no cover
    DIMS = ("demand", "competition", "feasibility", "reach", "ai_leverage")

REPORT_DIR = Path("docs")
SAMPLE_DROPPED = 10        # 被过滤评论抽样条数
MIN_PAIN = 3               # 与 run_all 实际使用一致（mine 默认）

DIM_ZH = {
    "demand": "需求强度",
    "competition": "竞争空缺",
    "feasibility": "个人可行性",
    "reach": "触达难度",
    "ai_leverage": "AI杠杆",
}


# ---------------- 分数拆解 ----------------

def _tier(total: float) -> str:
    return ("S" if total >= 85 else "A" if total >= 70 else
            "B" if total >= 55 else "C" if total >= 40 else "D")


def breakdown(p: dict) -> dict:
    """把一张卡片的总分拆回算术，标出未评维度 —— 回答「为什么是这个分」。"""
    scores = p.get("scores") or {}
    size = int(p.get("size") or 0)

    # feasibility 由簇大小决定（score_opportunity._heuristic_scores），非内容判断
    if size < 50:
        basis = f"size={size}<50"
    elif size < 200:
        basis = f"size={size}<200"
    else:
        basis = f"size={size}>=200"

    valid = [scores.get(k) for k in DIMS if scores.get(k) is not None]
    conf = round(min(1.0, 0.6 + 0.04 * size), 2)
    raw = (sum(valid) / len(valid)) / 5 * 100 if valid else 0.0
    recomputed = round(raw * conf, 1)

    return {
        "demand": scores.get("demand"),
        "feasibility": scores.get("feasibility"),
        "feas_basis": basis,
        "conf": conf,
        "raw": round(raw, 1),
        "recomputed": recomputed,
        "stated_total": p.get("total_score"),
        "unevaluated": [k for k in DIMS if scores.get(k) is None],
        "dims_used": len(valid),
        "dims_total": len(DIMS),
        "tier": _tier(recomputed),
        "size": size,
    }


# ---------------- 被过滤评论的词级理由 ----------------

def explain_dropped(rows: list, min_score: int = MIN_PAIN, sample: int = None) -> list:
    """逐条解释「为什么这条没够到痛点阈值」：命中了哪个词 / 一个都没命中。"""
    out = []
    for r in rows:
        text = (r.get("clean_content") or r.get("content") or r.get("text") or "").strip()
        if not text:
            continue
        hits = detect_signals(text)
        score = sum(h["weight"] for h in hits)
        if score >= min_score:
            continue
        if not hits:
            reason = f"{score} 分：0 个规则词命中（闲聊 / 分享 / 纯情绪，规则词表无匹配）"
        else:
            words = "、".join(f"{h['word']}({h['label']}+{h['weight']})" for h in hits)
            reason = f"{score} 分：命中 {words}，权重和仍 < 阈值 {min_score}"
        out.append({"content": text, "score": score, "hits": hits, "reason": reason})
    out.sort(key=lambda x: x["score"], reverse=True)
    return out if sample is None else out[:sample]


# ---------------- 决策漏斗 ----------------

def _read_jsonl(path) -> list:
    rows = []
    try:
        fh = io.open(path, encoding="utf-8")
    except Exception:
        return rows
    with fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue  # 坏行跳过（与 mine 行为一致）
    return rows


def _stages(raw_files, min_pain: int = MIN_PAIN) -> dict:
    """重算 mine 的各层计数，附带清洗后的行（供被过滤样本解释）。"""
    rows = []
    for f in raw_files or []:
        rows.extend(_read_jsonl(f))
    loaded = len(rows)

    cleaned = preprocess_comments(rows)
    n_clean = len(cleaned)

    deduped = _dedup_by_text(cleaned)
    n_dedup = len(deduped)

    painful = filter_painful(deduped, min_score=min_pain)
    n_pain = len(painful)

    return {
        "loaded": loaded,
        "cleaned": n_clean,
        "deduped": n_dedup,
        "painful": n_pain,
        "dropped_clean": loaded - n_clean,
        "dropped_dup": n_clean - n_dedup,
        "dropped_pain": n_dedup - n_pain,
        # 口径对齐：抽样解释用去重后的行，否则与 dropped_pain 数字对不上，
        # 且同一条跨视频重复评论会在样本里出现多次
        "deduped_rows": deduped,
    }


def funnel(raw_files, min_pain: int = MIN_PAIN) -> dict:
    """漏斗计数（不含内部行数据）。"""
    st = _stages(raw_files, min_pain)
    return {k: v for k, v in st.items() if k.endswith("_rows") is False}


# ---------------- 报告生成 ----------------

def _read_discovered(discovered) -> list:
    if not discovered:
        return []
    try:
        data = json.loads(Path(discovered).read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else (data.get("items") or [])


def _read_scored(scored) -> list:
    if not scored:
        return []
    try:
        data = json.loads(Path(scored).read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _render(keyword, ts, st, dropped, items, cards, raw_files, min_pain) -> str:
    L = []
    A = L.append

    A(f"# 执行报告 — {keyword}")
    A("")
    A(f"> 生成 {ts} ｜ 关键词「{keyword}」｜ 入口 `run_all.py` ｜ 本报告**只读**重算，不改任何步骤")
    A("")

    # 1. 漏斗
    A("## 1. 决策漏斗")
    A("")
    if st is None:
        A("_本次未提供 raw 输入，漏斗不可用。_")
    else:
        A("| 层 | 保留 | 本层丢弃 | 为什么丢 |")
        A("|---|---:|---:|---|")
        A(f"| 载入 raw | {st['loaded']} | — | 坏行 / 空行不计数 |")
        A(f"| 清洗 | {st['cleaned']} | -{st['dropped_clean']} | `is_valid` 不过：短于 4 字、纯表情、广告 |")
        A(f"| 跨视频去重 | {st['deduped']} | -{st['dropped_dup']} | T9：跨视频文本完全相同的重复评论 |")
        A(f"| 痛点过滤 | {st['painful']} | -{st['dropped_pain']} | `pain_score < {min_pain}`：规则词权重和不足 |")
        A("")
        if st["dropped_pain"] and st["deduped"]:
            rate = st["dropped_pain"] / st["deduped"] * 100
            A(f"**{rate:.0f}% 的去重后评论在这层消失**（本次 {st['dropped_pain']}/{st['deduped']} 条），"
              "抽样理由见第 3 节。")
            A("")

    # 2. 分数拆解
    A("## 2. 分数拆解：每张卡为什么这个分")
    A("")
    if not cards:
        A("_无评分数据。_")
    else:
        A("公式：`total = 有效维度均值 / 5 × 100 × min(1.0, 0.6+0.04×size)`")
        A("")
        A("| # | 分 | 档 | 需求 | 可行性 | conf | 反推总分 | 未评维度 |")
        A("|---|---:|---|---:|---|---:|---:|---|")
        for i, c in enumerate(cards, 1):
            b = breakdown(c)
            une = ", ".join(f"{DIM_ZH.get(k, k)}" for k in b["unevaluated"]) or "—"
            feas = f"{b['feasibility']} ({b['feas_basis']})" if b["feasibility"] is not None else "—"
            A(f"| {i} | {c.get('total_score')} | {b['tier']} | "
              f"{b['demand'] if b['demand'] is not None else '—'} | {feas} | "
              f"{b['conf']:.2f} | {b['recomputed']} | {une} |")
        A("")
        b0 = breakdown(cards[0])
        A(f"**只有 {b0['dims_used']}/{b0['dims_total']} 个评分维度参与** —— "
          "启发式路径下 `竞争空缺 / 触达难度 / AI杠杆` 恒为 `None`，"
          '被均值运算剔除（不是"没打分"，是"没参与"）。')
        A("")
        A(f"**`个人可行性` 由簇大小决定**（{b0['feas_basis']}），不是对内容的判断 —— "
          "簇小反而容易拿满分 5。")
        A("")
        A("**`conf` 封顶规则**：`size ≥ 10` 即到 1.00，样本量再多不加分。")
        A("")

    # 3. 被过滤评论的词级理由
    A(f"## 3. 被痛点层丢弃的评论（抽样 {len(dropped)} 条，按分数降序）")
    A("")
    if not dropped:
        A("_本次没有评论在痛点层被丢弃。_")
    else:
        for d in dropped:
            txt = d["content"] if len(d["content"]) <= 60 else d["content"][:60] + "…"
            A(f"- **[{d['score']}分]** 「{txt}」")
            A(f"  - {d['reason']}")
    A("")

    # 4. 实际召回的视频（域匹配自查）
    A("## 4. 实际召回的视频（域匹配自查）")
    A("")
    if not items:
        A("_未提供 discovered 文件。_")
    else:
        A("采集层**没有域校验** —— 关键词与下列标题不符，说明搜索召回跑偏，整条链路照单全收：")
        A("")
        for it in items:
            sid = it.get("source_id", "?")
            title = (it.get("title") or "").strip() or "(无标题)"
            A(f"- {title}  `({sid})`")
        A("")

    # 5. 异常（0 条评论 / 文件缺失）
    A("## 5. 异常")
    A("")
    anomalies = []
    for f in raw_files or []:
        name = Path(f).name
        sid = name.split("_", 1)[-1].replace(".jsonl", "") if "_" in name else name
        n = len(_read_jsonl(f))
        if n == 0:
            anomalies.append(f"`{sid}` → raw 文件 0 条（评论区空 / 视频失效 -404 / 权限限制）")
    if not anomalies:
        A("_无 0 条评论的视频。_")
    else:
        for a in anomalies:
            A(f"- {a}")
        A("")
        A("0 条**不是 bug**：`code=0, replies=0, is_end=True` = 该视频确实无评论；"
          "`-404` = 视频已失效。两者都会被明确记录而非静默跳过。")
    A("")

    # 6. 本次用到的规则
    A("## 6. 本次执行用到的规则")
    A("")
    A("| 步骤 | 规则 | 位置 |")
    A("|---|---|---|")
    A("| 清洗 | `len<4` / 纯表情 / 广告 → 丢 | `preprocess.is_valid` |")
    A("| 去重 | 跨视频 `clean_content` 完全相同 → 丢 | `mine._dedup_by_text` |")
    A(f"| 痛点过滤 | 信号词权重和 ≥ {min_pain} 才保留 | `pain_rules.filter_painful` |")
    A("| 簇主题 | **取频次最高信号**（求助量大恒压付费/失望） | `mine_pain_points.py:126` |")
    A("| 代表句 | `avg × (0.5+0.5×pain/max)` 乘性打分 + MMR，**无长度上限** | `cluster.py:71-83` |")
    A("| 评分 | 2/5 维参与；`feasibility` 看 size；`conf` 看 size | `score_opportunity.py:33-95` |")
    A("| MVP 类型 | 取信号 dict **第一个键**（插入顺序，非主导信号） | `design_mvp.py:39` |")
    A("| 主题聚焦 | `--topics` 可选，**run_all 默认不启用** | `run_all.py:72` |")
    A("")
    A("---")
    A("_由 `exec_report.py` 自动产出。规则有误 → 改对应源文件后重跑。_")
    return "\n".join(L)


def generate(keyword, discovered=None, raw_files=None, scored=None, min_pain=MIN_PAIN):
    """生成并落盘执行报告，返回 Path。"""
    ts = datetime.now().strftime("%Y%m%d-%H%M")
    safe = safe_filename(keyword) if keyword else "unknown"
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    out = REPORT_DIR / f"exec-report-{ts}-{safe}.md"

    st = _stages(raw_files, min_pain) if raw_files else None
    dropped = explain_dropped(st["deduped_rows"] if st else [], min_pain, SAMPLE_DROPPED)
    items = _read_discovered(discovered)
    cards = _read_scored(scored)

    body = _render(keyword, ts, st, dropped, items, cards, raw_files, min_pain)
    out.write_text(body, encoding="utf-8")
    return out


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="产出执行报告（结果 + 为什么）")
    p.add_argument("--keyword", required=True)
    p.add_argument("--discovered", help="本次 discovered JSON（取视频标题）")
    p.add_argument("--scored", help="本次 scored JSON（取分数拆解）")
    p.add_argument("--raw", nargs="+", default=[], help="本次 raw JSONL（重算漏斗）")
    p.add_argument("--min-pain", type=int, default=MIN_PAIN)
    a = p.parse_args()
    path = generate(a.keyword, a.discovered, a.raw, a.scored, a.min_pain)
    print(f"📄 执行报告 → {path}")
