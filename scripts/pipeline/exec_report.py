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

from html import escape as _esc  # 不可信输入（评论/标题）直入报告前必须转义

from pain_rules import detect_signals, filter_painful  # noqa: E402
from preprocess import preprocess_comments  # noqa: E402
from mine_pain_points import _dedup_by_text  # noqa: E402
from run_inputs import safe_filename  # noqa: E402
from domain_check import domain_overlap  # noqa: E402
# conf 公式必须与评分同源：旧版此处硬编码 0.6+0.04*size，评分一改反推就失配
from score_opportunity import _confidence_factor  # noqa: E402

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


def _drop_rate(st) -> "float | None":
    """痛点层丢弃率（%）。Markdown 与 HTML 必须共用，避免两处算出不同数字。"""
    if not st or not st.get("deduped"):
        return None
    return st["dropped_pain"] / st["deduped"] * 100


def _anomalies(raw_files) -> list:
    """0 条评论的视频 id（评论区空 / -404 失效）。"""
    out = []
    for f in raw_files or []:
        name = Path(f).name
        sid = name.split("_", 1)[-1].replace(".jsonl", "") if "_" in name else name
        if len(_read_jsonl(f)) == 0:
            out.append(sid)
    return out


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
    # 与 score_opportunity 共用同一公式来源；旧卡自带 score_confidence 时以其为准
    conf = p.get("score_confidence")
    if conf is None:
        conf = _confidence_factor(size)
    raw = (sum(valid) / len(valid)) / 5 * 100 if valid else 0.0
    recomputed = round(raw * conf, 1)

    return {
        "demand": scores.get("demand"),
        "competition": scores.get("competition"),
        "feasibility": scores.get("feasibility"),
        "feas_basis": basis,
        "reach": scores.get("reach"),
        "ai_leverage": scores.get("ai_leverage"),
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
        A(f"| 清洗 | {st['cleaned']} | -{st['dropped_clean']} | `is_valid` 不过：短于 4 字、纯表情、广告、成人擦边 |")
        A(f"| 跨视频去重 | {st['deduped']} | -{st['dropped_dup']} | T9：跨视频文本完全相同的重复评论 |")
        A(f"| 痛点过滤 | {st['painful']} | -{st['dropped_pain']} | `pain_score < {min_pain}`：规则词权重和不足 |")
        A("")
        rate = _drop_rate(st)
        if rate is not None and st["dropped_pain"]:
            A(f"**{rate:.0f}% 的去重后评论在这层消失**（本次 {st['dropped_pain']}/{st['deduped']} 条），"
              "抽样理由见第 3 节。")
            A("")

    # 2. 分数拆解
    A("## 2. 分数拆解：每张卡为什么这个分")
    A("")
    if not cards:
        A("_无评分数据。_")
    else:
        A("公式：`total = 有效维度均值 / 5 × 100 × min(1.0, 0.6+0.008×size)`")
        A("")
        A("| # | 分 | 档 | 需求 | 竞争 | 可行性 | AI杠杆 | conf | 反推总分 | 未评维度 |")
        A("|---|---:|---|---:|---:|---|---:|---:|---:|---|")
        for i, c in enumerate(cards, 1):
            b = breakdown(c)
            une = ", ".join(f"{DIM_ZH.get(k, k)}" for k in b["unevaluated"]) or "—"
            feas = f"{b['feasibility']} ({b['feas_basis']})" if b["feasibility"] is not None else "—"
            comp = b["competition"] if b["competition"] is not None else "—"
            ai = b["ai_leverage"] if b["ai_leverage"] is not None else "—"
            A(f"| {i} | {c.get('total_score')} | {b['tier']} | "
              f"{b['demand'] if b['demand'] is not None else '—'} | {comp} | {feas} | "
              f"{ai} | {b['conf']:.2f} | {b['recomputed']} | {une} |")
        A("")
        b0 = breakdown(cards[0])
        A(f"**评分维度按证据参与** —— 本卡 {b0['dims_used']}/{b0['dims_total']} 维进均值："
          "`竞争空缺`（对比+失望信号）与 `AI杠杆`（代表句产品形态词）**证据驱动** —— "
          "有证据才评、无证据为 `None` 被均值剔除（不是「没打分」，是「没参与」）；"
          "`触达难度` 无独立数据来源，启发式路径恒为 `None`。")
        A("")
        A(f"**`个人可行性` 由簇大小决定**（{b0['feas_basis']}），不是对内容的判断 —— "
          "簇小反而容易拿满分 5。")
        A("")
        A("**`conf` 封顶规则**：`size ≥ 50` 才到 1.00，`size=11` 只算 0.69 —— "
          "11 条与 112 条的证据不再同价（旧版 10 条即封顶，样本量只剩反向惩罚，"
          "是大簇被小簇压过的根因之一）。")
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
        titles = [it.get("title", "") for it in items]
        overlap = domain_overlap(keyword, titles)
        if overlap["verdict"] == "domain_mismatch":
            A(f"**域重合度 {overlap['overlap_ratio']:.0%}（跑偏）** —— 关键词与召回标题不符，搜索召回可能跑偏")
            A("")
            A("未命中的标题样本：")
            for s in overlap["samples"]:
                A(f"- {s}")
            A("")
            A("采集层**没有域校验** —— 关键词与下列标题不符，说明搜索召回跑偏，整条链路照单全收：")
        elif overlap["verdict"] == "domain_match":
            A(f"**域重合度 {overlap['overlap_ratio']:.0%}（通过）** —— 关键词与召回标题基本一致")
            A("")
            A("召回**落在关键词域内**；域校验通过不代表痛点率高，仍需看第 1 节漏斗：")
        else:
            A("_域重合度无法判定（关键词类型未知或无召回标题）。_")
            A("")
            A("下列为实际召回的视频：")
        A("")
        for it in items:
            sid = it.get("source_id", "?")
            title = (it.get("title") or "").strip() or "(无标题)"
            A(f"- {title}  `({sid})`")
        A("")

    # 5. 异常（0 条评论 / 文件缺失）
    A("## 5. 异常")
    A("")
    anomalies = _anomalies(raw_files)
    if not anomalies:
        A("_无 0 条评论的视频。_")
    else:
        for sid in anomalies:
            A(f"- `{sid}` → raw 文件 0 条（评论区空 / 视频失效 -404 / 权限限制）")
        A("")
        A("0 条**不是 bug**：`code=0, replies=0, is_end=True` = 该视频确实无评论；"
          "`-404` = 视频已失效。两者都会被明确记录而非静默跳过。")
    A("")

    # 6. 本次用到的规则
    A("## 6. 本次执行用到的规则")
    A("")
    A("| 步骤 | 规则 | 位置 |")
    A("|---|---|---|")
    A("| 清洗 | `len<4` / 纯表情 / 广告 / 成人擦边 → 丢 | `preprocess.is_valid` |")
    A("| 去重 | 跨视频 `clean_content` 完全相同 → 丢 | `mine._dedup_by_text` |")
    A(f"| 痛点过滤 | 信号词权重和 ≥ {min_pain} 才保留 | `pain_rules.filter_painful` |")
    A("| 簇主题 | **取频次最高信号**（求助量大恒压付费/失望） | `mine_pain_points.py:126` |")
    A("| 代表句 | `avg × (0.5+0.5×pain/max)` 乘性打分 + MMR，**无长度上限** | `cluster.py:71-83` |")
    A("| 评分 | **证据驱动**：需求=痛点+付费量级、竞争=对比+失望、可行看 size、AI杠杆=形态词表、触达恒 None；`conf` 看 size | `score_opportunity._heuristic_scores` |")
    A("| MVP 类型 | 取信号 dict **第一个键**（插入顺序，非主导信号） | `design_mvp.py:39` |")
    A("| 主题聚焦 | `--topics` 可选，**run_all 默认不启用** | `run_all.py:72` |")
    A("| 域校验前置 | 娱乐域关键词 → 爬取前警告（**不阻断**） | `run_all.domain_precheck` |")
    A("| 成人黑名单 | 命中成人擦边词 → 清洗层丢弃（合规红线不绕过） | `domain_check.is_adult` |")
    A("| 召回域重合 | 标题命中域词 < 50% → 判 `domain_mismatch` | `domain_check.domain_overlap` |")
    A("")
    A("---")
    A("_由 `exec_report.py` 自动产出。规则有误 → 改对应源文件后重跑。_")
    return "\n".join(L)


# 单文件 HTML 的全部样式：内联、零外部请求（断网可开、可直接转发）。
# 版式决策：2 个字体家族（人文无衬线 × 等宽数字）；字号阶梯 12/13/15/19/30；
# 8pt 间距网格；中性墨色 60% + 青灰强调 10%（#0F766E，刻意避开紫蓝俗套）；
# 只用边框不用阴影、圆角统一 6px、左对齐；漏斗靠"尺寸"立焦点，不靠高饱和。
_HTML_CSS = """
:root{
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;
  --mono:ui-monospace,"Cascadia Mono",Consolas,"SFMono-Regular",monospace;
  --paper:#FBFBFC;--card:#FFFFFF;
  --ink:#16181D;--ink2:#454A54;--ink3:#767C88;
  --line:#E4E6EA;--line2:#F0F1F4;
  --accent:#0F766E;--accent-soft:#E7F2F1;
  --warn:#B45309;--warn-soft:#FBF1E6;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);
  font:400 15px/1.75 var(--sans);-webkit-font-smoothing:antialiased}
.page{max-width:960px;margin:0 auto;padding:56px 32px 80px}
code,.mono{font-family:var(--mono);font-size:.92em;font-variant-numeric:tabular-nums}
code{background:var(--line2);padding:1px 5px;border-radius:4px}

.head{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:48px}
.kicker{font:600 12px/1.4 var(--mono);letter-spacing:.14em;color:var(--accent);margin-bottom:8px}
h1{font:700 30px/1.2 var(--sans);letter-spacing:-.02em;margin:0 0 8px}
.meta{font-size:13px;color:var(--ink3);margin:0}
.meta code{background:none;padding:0;color:var(--ink2)}

section{margin-bottom:48px}
h2{font:650 19px/1.35 var(--sans);margin:0 0 16px;display:flex;align-items:baseline;gap:10px}
h2 .n{font:600 12px/1 var(--mono);color:var(--accent);letter-spacing:.08em;
  border:1px solid var(--accent);border-radius:4px;padding:4px 6px;flex:none}

.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:24px}
.callout{border-left:2px solid var(--warn);background:var(--warn-soft);color:#7A3B06;
  padding:12px 16px;border-radius:0 4px 4px 0;font-size:14px;margin:16px 0 0}
.callout strong{color:var(--warn);font-family:var(--mono)}
.note{font-size:13px;color:var(--ink3);margin:16px 0 0;line-height:1.7}
.formula{font:500 13px/1.6 var(--mono);color:var(--ink2);background:var(--line2);
  padding:10px 12px;border-radius:4px;margin:0 0 20px;overflow-x:auto}

.funnel{display:grid;gap:10px}
.stage{display:grid;grid-template-columns:88px 1fr 64px 76px;align-items:center;gap:12px}
.stage .lab{font-size:13px;color:var(--ink2);text-align:right}
.track{height:26px;background:var(--line2);border-radius:3px;overflow:hidden}
.fill{height:100%;background:rgba(15,118,110,.22);border-right:2px solid var(--accent)}
.stage .cnt{font:600 15px/1 var(--mono);text-align:right;color:var(--ink)}
.stage .drop{font:500 13px/1 var(--mono);text-align:right;color:var(--ink3)}
.stage .drop.on{color:var(--warn)}

.tbl-wrap{overflow-x:auto}
.tbl{width:100%;border-collapse:collapse;font-size:14px}
.tbl th{font:600 12px/1.4 var(--sans);color:var(--ink3);letter-spacing:.06em;
  text-align:left;padding:0 12px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:10px 12px;border-bottom:1px solid var(--line2);vertical-align:top}
.tbl tr:last-child td{border-bottom:none}
.tbl .num{font-family:var(--mono);text-align:right;font-variant-numeric:tabular-nums}
.tbl th.num{text-align:right}
.tier{display:inline-block;font:600 12px/1 var(--mono);padding:5px 7px;border-radius:4px;
  background:var(--line2);color:var(--ink2)}
.tier.a{background:var(--accent);color:#FFFFFF}
.basis{font-size:12px;color:var(--ink3);font-family:var(--mono)}
.chip{display:inline-block;font-size:12px;color:var(--ink3);border:1px dashed var(--line);
  border-radius:4px;padding:2px 6px;margin:0 4px 4px 0}
.chip.on{border-style:solid;color:var(--ink2);border-color:var(--line)}

ul.notes{margin:20px 0 0;padding:0;list-style:none;font-size:14px;color:var(--ink2)}
ul.notes li{padding-left:16px;position:relative;margin-bottom:8px}
ul.notes li:before{content:"";position:absolute;left:0;top:.75em;width:6px;height:1px;background:var(--ink3)}
ul.notes li:last-child{margin-bottom:0}
ul.notes strong{color:var(--ink)}

ul.samples{margin:0;padding:0;list-style:none}
.grp + .grp{margin-top:20px;padding-top:20px;border-top:1px solid var(--line2)}
.grp-h{font:600 12px/1.5 var(--sans);color:var(--ink3);letter-spacing:.06em;margin-bottom:12px}
ul.samples li{padding:12px 0;border-bottom:1px solid var(--line2)}
ul.samples li:first-child{padding-top:0}
ul.samples li:last-child{border-bottom:none;padding-bottom:0}
.s{display:inline-block;font:600 12px/1 var(--mono);padding:5px 6px;border-radius:4px;
  background:var(--line2);color:var(--ink2);margin-right:8px;vertical-align:1px}
.s.lo{background:var(--warn-soft);color:var(--warn)}
.q{color:var(--ink);font-size:14px}
.rsn{font-size:13px;color:var(--ink3);margin-top:4px;padding-left:48px}

ol.videos{margin:0;padding:0;list-style:none;counter-reset:v}
ol.videos li{display:flex;gap:12px;align-items:baseline;padding:8px 0;
  border-bottom:1px solid var(--line2);font-size:14px}
ol.videos li:first-child{padding-top:0}
ol.videos li:last-child{border-bottom:none;padding-bottom:0}
ol.videos li:before{counter-increment:v;content:counter(v,decimal-leading-zero);
  font:500 12px/1 var(--mono);color:var(--ink3);flex:none}
.vt{flex:1;color:var(--ink);min-width:0}
.vid{font:500 12px/1 var(--mono);color:var(--ink3);flex:none}

.foot{border-top:1px solid var(--line);padding-top:16px;font-size:12px;color:var(--ink3)}
@media (max-width:640px){
  .page{padding:32px 16px 56px}
  h1{font-size:24px}
  .stage{grid-template-columns:60px 1fr 44px 68px;gap:8px}
  .stage .lab{font-size:12px}
}
@media print{
  body{background:#FFFFFF}
  section{break-inside:avoid}
}
"""


def _render_html(keyword, ts, st, dropped, items, cards, raw_files, min_pain) -> str:
    """HTML 单文件报告。所有插值必须过 _esc（评论/标题是不可信输入）。"""
    e = _esc
    rate = _drop_rate(st)
    bds = [breakdown(c) for c in cards]
    anomalies = _anomalies(raw_files)

    L = []
    A = L.append

    A("<!DOCTYPE html>")
    A('<html lang="zh-CN">')
    A("<head>")
    A('<meta charset="utf-8">')
    A('<meta name="viewport" content="width=device-width,initial-scale=1">')
    A(f"<title>执行报告 — {e(keyword)}</title>")
    A("<style>" + _HTML_CSS + "</style>")
    A("</head>")
    A("<body><div class='page'>")

    # 页眉：kicker → h1（全页唯一大字）→ meta
    A('<header class="head">')
    A('<div class="kicker">EXEC REPORT</div>')
    A(f"<h1>{e(keyword)}</h1>")
    A(f'<p class="meta">生成 {e(ts)} ｜ 入口 <code>run_all.py</code> ｜ '
      "本报告只读重算，不改任何步骤</p>")
    A("</header>")

    # 1. 决策漏斗（主角）
    A("<section>")
    A('<h2><span class="n">1</span>决策漏斗</h2>')
    A('<div class="card">')
    if st is None:
        A('<p class="note">本次未提供 raw 输入，漏斗不可用。</p>')
    else:
        base = st["loaded"] or 1
        rows = [
            ("载入 raw", st["loaded"], None),
            ("清洗", st["cleaned"], st["dropped_clean"]),
            ("跨视频去重", st["deduped"], st["dropped_dup"]),
            ("痛点过滤", st["painful"], st["dropped_pain"]),
        ]
        A('<div class="funnel">')
        for lab, keep, drop in rows:
            w = keep / base * 100
            drop_html = "—" if drop is None else (
                f'<span class="drop on">-{drop}</span>' if drop else '<span class="drop">0</span>')
            A(f'<div class="stage"><div class="lab">{e(lab)}</div>'
              f'<div class="track"><div class="fill" style="width:{w:.1f}%"></div></div>'
              f'<div class="cnt">{keep}</div>{drop_html}</div>')
        A("</div>")
        A('<p class="note">条宽 = 该层保留数 ÷ 载入数；右列为本层丢弃量。</p>')
    A("</div>")
    if rate is not None and st and st["dropped_pain"]:
        A(f'<p class="callout"><strong>{rate:.0f}%</strong> 的去重后评论在痛点层消失'
          f"（本次 {st['dropped_pain']}/{st['deduped']} 条）→ 抽样理由见第 3 节</p>")
    A("</section>")

    # 2. 分数拆解（配角）
    A("<section>")
    A('<h2><span class="n">2</span>分数拆解：每张卡为什么这个分</h2>')
    if not bds:
        A('<div class="card"><p class="note">无评分数据。</p></div>')
    else:
        A('<div class="card">')
        A('<p class="formula">total = 有效维度均值 / 5 × 100 × min(1.0, 0.6+0.008×size)</p>')
        A('<div class="tbl-wrap"><table class="tbl"><thead><tr>'
          '<th class="num">#</th><th class="num">分</th><th>档</th><th class="num">需求</th>'
          '<th class="num">竞争</th><th>可行性</th><th class="num">AI杠杆</th>'
          '<th class="num">conf</th><th class="num">反推总分</th>'
          "<th>未评维度</th></tr></thead><tbody>")
        for i, (c, b) in enumerate(zip(cards, bds), 1):
            tier_cls = "tier a" if b["tier"] == "A" else "tier"
            feas = ("—" if b["feasibility"] is None else
                    f'{b["feasibility"]} <span class="basis">({e(b["feas_basis"])})</span>')
            comp = "—" if b.get("competition") is None else b["competition"]
            ai = "—" if b.get("ai_leverage") is None else b["ai_leverage"]
            chips = "".join(
                f'<span class="chip">{e(DIM_ZH.get(k, k))}</span>' for k in b["unevaluated"])
            A(f'<tr><td class="num">{i}</td><td class="num">{e(str(c.get("total_score")))}</td>'
              f'<td><span class="{tier_cls}">{b["tier"]}</span></td>'
              f'<td class="num">{b["demand"] if b["demand"] is not None else "—"}</td>'
              f'<td class="num">{comp}</td>'
              f"<td>{feas}</td>"
              f'<td class="num">{ai}</td>'
              f'<td class="num">{b["conf"]:.2f}</td>'
              f'<td class="num">{b["recomputed"]}</td>'
              f'<td>{chips or "—"}</td></tr>')
        A("</tbody></table></div>")
        b0 = bds[0]
        A("<ul class='notes'>")
        A(f'<li><strong>评分维度按证据参与</strong> —— 本卡 {b0["dims_used"]}/{b0["dims_total"]} 维进均值：'
          "<code>竞争空缺</code>（对比+失望信号）与 <code>AI杠杆</code>（代表句产品形态词）"
          "<strong>证据驱动</strong> —— 有证据才评、无证据为 <code>None</code> 被均值剔除"
          "（不是「没打分」，是「没参与」）；<code>触达难度</code> 无独立数据来源，"
          "启发式路径恒为 <code>None</code>。</li>")
        A(f'<li><strong>个人可行性由簇大小决定</strong>（{e(b0["feas_basis"])}），'
          "不是对内容的判断 —— 簇小反而容易拿满分 5。</li>")
        A("<li><strong>conf 封顶规则</strong>：<code>size ≥ 50</code> 才到 1.00，"
          "<code>size=11</code> 只算 0.69 —— 11 条与 112 条的证据不再同价"
          "（旧版 10 条即封顶，样本量只剩反向惩罚，是大簇被小簇压过的根因之一）。</li>")
        A("</ul>")
        A("</div>")
    A("</section>")

    # 3. 被丢评论的词级理由
    # 分组而非逐条重复同一句解释：零命中的样本占 9/10 时，逐条渲染会把同一句
    # 「0 个规则词命中（…）」复制 9 次，既稀释信息又让本节压过主角漏斗。
    A("<section>")
    A(f'<h2><span class="n">3</span>被痛点层丢弃的评论（抽样 {len(dropped)} 条，按分数降序）</h2>')
    A('<div class="card">')
    if not dropped:
        A('<p class="note">本次没有评论在痛点层被丢弃。</p>')
    else:
        near = [d for d in dropped if d["score"] > 0]
        zero = [d for d in dropped if d["score"] == 0]
        groups = []
        if near:
            groups.append(("命中了规则词，但权重和仍不够阈值", near, True))
        if zero:
            groups.append(("0 个规则词命中 —— 闲聊 / 分享 / 纯情绪（规则词表无匹配）",
                           zero, False))
        for title, rows, show_reason in groups:
            A('<div class="grp">')
            A(f'<div class="grp-h">{e(title)}</div>')
            A('<ul class="samples">')
            for d in rows:
                txt = d["content"] if len(d["content"]) <= 80 else d["content"][:80] + "…"
                cls = "s lo" if d["score"] > 0 else "s"
                reason = f'<div class="rsn">{e(d["reason"])}</div>' if show_reason else ""
                A(f'<li><span class="{cls}">{d["score"]}分</span>'
                  f'<span class="q">「{e(txt)}」</span>{reason}</li>')
            A("</ul></div>")
    A("</div>")
    A("</section>")

    # 4. 实际召回的视频（域自查）
    A("<section>")
    A('<h2><span class="n">4</span>实际召回的视频（域匹配自查）</h2>')
    if not items:
        A('<p class="note">未提供 discovered 文件。</p>')
    else:
        titles = [it.get("title", "") for it in items]
        overlap = domain_overlap(keyword, titles)
        if overlap["verdict"] == "domain_mismatch":
            A(f'<p class="callout"><strong>域重合度 {overlap["overlap_ratio"]:.0%}（跑偏）</strong> '
              "—— 关键词与召回标题不符，搜索召回可能跑偏</p>")
            A('<div class="card"><div class="grp-h">未命中的标题样本</div><ul class="samples">')
            for s in overlap["samples"]:
                A(f'<li><span class="q">「{e(s)}」</span></li>')
            A("</ul></div>")
            A('<p class="note">采集层<strong>没有域校验</strong> —— 关键词与下列标题不符，'
              "说明搜索召回跑偏，整条链路照单全收：</p>")
        elif overlap["verdict"] == "domain_match":
            A(f'<p class="note"><strong>域重合度 {overlap["overlap_ratio"]:.0%}（通过）</strong> '
              "—— 关键词与召回标题基本一致</p>")
            A('<p class="note">召回<strong>落在关键词域内</strong>；'
              "域校验通过不代表痛点率高，仍需看第 1 节漏斗：</p>")
        else:
            A('<p class="note">域重合度无法判定（关键词类型未知或无召回标题）。'
              "</p>")
            A('<p class="note">下列为实际召回的视频：</p>')
        A('<div class="card"><ol class="videos">')
        for it in items:
            sid = it.get("source_id", "?")
            title = (it.get("title") or "").strip() or "(无标题)"
            A(f'<li><span class="vt">{e(title)}</span>'
              f'<span class="vid">{e(str(sid))}</span></li>')
        A("</ol></div>")
    A("</section>")

    # 5. 异常
    A("<section>")
    A('<h2><span class="n">5</span>异常</h2>')
    if not anomalies:
        A('<p class="note">无 0 条评论的视频。</p>')
    else:
        A('<div class="card"><ul class="samples">')
        for sid in anomalies:
            A(f'<li><span class="s lo">0 条</span>'
              f'<span class="q"><code>{e(str(sid))}</code> raw 文件 0 条</span>'
              '<div class="rsn">评论区空 / 视频已失效 -404 / 权限限制</div></li>')
        A("</ul></div>")
        A('<p class="note">0 条<strong>不是 bug</strong>：<code>code=0, replies=0, is_end=True</code> '
          "= 该视频确实无评论；<code>-404</code> = 视频已失效。两者都会被明确记录，而非静默跳过。</p>")
    A("</section>")

    # 6. 规则清单
    A("<section>")
    A('<h2><span class="n">6</span>本次执行用到的规则</h2>')
    A('<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>'
      "<th>步骤</th><th>规则</th><th>位置</th></tr></thead><tbody>")
    rules = [
        ("清洗", "<code>len&lt;4</code> / 纯表情 / 广告 / 成人擦边 → 丢", "preprocess.is_valid"),
        ("去重", "跨视频 <code>clean_content</code> 完全相同 → 丢", "mine._dedup_by_text"),
        ("痛点过滤", f"信号词权重和 ≥ {min_pain} 才保留", "pain_rules.filter_painful"),
        ("簇主题", "取频次最高信号（求助量大恒压付费/失望）", "mine_pain_points.py:126"),
        ("代表句", "乘性打分 + MMR，<strong>无长度上限</strong>", "cluster.py:71-83"),
        ("评分", "<strong>证据驱动</strong>：需求=痛点+付费量级、竞争=对比+失望、"
         "可行看 size、AI杠杆=形态词表、触达恒 None；conf 看 size",
         "score_opportunity._heuristic_scores"),
        ("MVP 类型", "取信号 dict <strong>第一个键</strong>（插入顺序，非主导信号）",
         "design_mvp.py:39"),
        ("主题聚焦", "<code>--topics</code> 可选，<strong>run_all 默认不启用</strong>",
         "run_all.py:72"),
        ("域校验前置", "娱乐域关键词 → 爬取前警告（<strong>不阻断</strong>）",
         "run_all.domain_precheck"),
        ("成人黑名单", "命中成人擦边词 → 清洗层丢弃（合规红线不绕过）",
         "domain_check.is_adult"),
        ("召回域重合", "标题命中域词 &lt; 50% → 判 <code>domain_mismatch</code>",
         "domain_check.domain_overlap"),
    ]
    for step, rule, loc in rules:
        A(f"<tr><td>{e(step)}</td><td>{rule}</td><td><code>{e(loc)}</code></td></tr>")
    A("</tbody></table></div></div>")
    A("</section>")

    A('<footer class="foot">由 <code>exec_report.py</code> 自动产出 ｜ '
      "规则有误 → 改对应源文件后重跑</footer>")
    A("</div></body></html>")
    return "\n".join(L)


def generate(keyword, discovered=None, raw_files=None, scored=None, min_pain=MIN_PAIN):
    """生成并落盘执行报告（Markdown + HTML 同名成对），返回 Markdown Path。"""
    ts = datetime.now().strftime("%Y%m%d-%H%M")
    safe = safe_filename(keyword) if keyword else "unknown"
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stem = f"exec-report-{ts}-{safe}"

    st = _stages(raw_files, min_pain) if raw_files else None
    dropped = explain_dropped(st["deduped_rows"] if st else [], min_pain, SAMPLE_DROPPED)
    items = _read_discovered(discovered)
    cards = _read_scored(scored)

    md = REPORT_DIR / f"{stem}.md"
    md.write_text(_render(keyword, ts, st, dropped, items, cards, raw_files, min_pain),
                  encoding="utf-8")
    (REPORT_DIR / f"{stem}.html").write_text(
        _render_html(keyword, ts, st, dropped, items, cards, raw_files, min_pain),
        encoding="utf-8")
    return md


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
    print(f"🌐 浏览器打开 → {path.with_suffix('.html')}")
