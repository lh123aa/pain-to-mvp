# -*- coding: utf-8 -*-
"""排序修复（2026-10-14 问题域跑批暴露的真实缺陷）。

实测：112 条评论的真实产品需求簇（付费信号 10 条）得 70 分排第 2，
      11 条玩梗簇（代表句「笑死，干运维还没用到Python[笑哭]」）得 80 分排第 1。

根因（逐条反推验证）：
  1. `_confidence_factor = 0.6+0.04*size` 在 size≥10 即封顶 1.0 —— 11 条与
     112 条证据同价，样本量的正向作用失效；
  2. 与此同时 `feasibility = 5 if size<50 else 4`（小簇更聚焦）仍在反向计分，
     于是 size≥10 之后「证据量」只剩反向惩罚这一条腿 → 簇越大分越低；
  3. demand 的付费信号加成为二值 +1 且被 round 抹平，10 条与 1 条同为 3 分。

修复必须让大簇反超，且理由必须可核对、标题不得是玩梗句。
"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

import export_card as ec  # noqa: E402
import exec_report as er  # noqa: E402
from score_opportunity import (  # noqa: E402
    _confidence_factor, _heuristic_scores, score,
)

# 2026-10-14 20:30「独立开发者怎么接单」跑批的三个真实簇
CLUSTER_BIG = {  # 112 条，含真实产品需求，付费意愿 10 条
    "size": 112, "avg_pain": 4.28,
    "signal_distribution": {"求助": 56, "期望": 35, "抱怨": 14, "付费意愿": 10,
                            "失望": 7, "对比": 6, "困惑": 6},
}
CLUSTER_MUS = {  # 11 条，代表句是玩梗
    "size": 11, "avg_pain": 4.91,
    "signal_distribution": {"求助": 7, "抱怨": 2, "期望": 2, "失望": 2,
                            "付费意愿": 1, "对比": 1},
}
CLUSTER_TINY = {"size": 3, "avg_pain": 4.67,
                "signal_distribution": {"期望": 2, "求助": 1, "困惑": 1}}


def _run_score(pains):
    """走完整 score()（use_llm=False），返回按分数降序的结果。"""
    with tempfile.TemporaryDirectory() as td:
        inp, out = Path(td) / "p.json", Path(td) / "s.json"
        for i, p in enumerate(pains):
            p.setdefault("representative_quotes", ["测试原话"])
            p.setdefault("pain_summary", "测试摘要")
            p.setdefault("cluster_id", i)
            p.setdefault("total_pain", 10)
        inp.write_text(json.dumps(pains, ensure_ascii=False), encoding="utf-8")
        return score(str(inp), str(out), use_llm=False)


# ---------- #1 排序公式 ----------

def test_conf_keeps_differentiating_past_ten():
    """11 条不得与 112 条同为满分置信；封顶应延后到 50 条。"""
    assert _confidence_factor(11) < _confidence_factor(112), \
        "旧缺陷：size≥10 即封顶 1.0，11 条与 112 条证据同价"
    assert _confidence_factor(50) == 1.0, "封顶应在 50 条"
    assert _confidence_factor(3) >= 0.6, "下限保护不归零（T8）"
    assert _confidence_factor(5000) == 1.0, "大簇不加成（T8）"


def test_large_real_cluster_outranks_meme_cluster():
    """核心回归：112 条真实需求簇必须排在 11 条玩梗簇之前。"""
    res = _run_score([dict(CLUSTER_MUS), dict(CLUSTER_BIG), dict(CLUSTER_TINY)])
    by = {r["size"]: r for r in res}
    assert by[112]["total_score"] > by[11]["total_score"], (
        f"排序仍反了：112 条 {by[112]['total_score']} 分 "
        f"< 11 条 {by[11]['total_score']} 分")
    assert res[0]["size"] == 112, "降序输出里大簇必须第一"
    assert by[112]["tier"] == "A", "真实大簇应落 A 档"
    assert by[11]["tier"] != "A", "11 条玩梗簇不得独占 A 档"
    assert by[11]["total_score"] < by[112]["total_score"]


def test_paid_signal_scales_with_volume():
    """付费信号量级必须进需求分：10 条 ≠ 1 条 ≠ 0 条。"""
    base = {"size": 112, "avg_pain": 4.0}
    many = _heuristic_scores({**base, "signal_distribution": {"付费意愿": 10}})
    few = _heuristic_scores({**base, "signal_distribution": {"付费意愿": 1}})
    none = _heuristic_scores({**base, "signal_distribution": {"求助": 5}})
    assert many["demand"] > none["demand"], "10 条付费信号必须高于 0 条"
    assert few["demand"] >= none["demand"], "有 1 条付费不得低于 0 条"
    assert many["demand"] > few["demand"], "10 条必须高于 1 条（旧版二者同为 3 分）"


def test_conf_and_demand_changes_are_still_bounded():
    """维度分仍锁在 1-5，置信仍锁在 [0.6, 1.0]（不得为修排序而越界）。"""
    for paid in (0, 1, 5, 10, 40):
        s = _heuristic_scores({"size": 500, "avg_pain": 7.5,
                               "signal_distribution": {"付费意愿": paid}})
        assert 1 <= s["demand"] <= 5, s
        assert 1 <= s["feasibility"] <= 5, s
    for size in (0, 1, 3, 11, 49, 50, 51, 200, 9999):
        assert 0.6 <= _confidence_factor(size) <= 1.0


# ---------- #2 评分理由 ----------

def test_score_reason_is_checkable_arithmetic():
    """score_reason 必须含可核对的数据，而不是「启发式评分」四个字。"""
    res = _run_score([dict(CLUSTER_BIG)])
    reason = (res[0].get("score_reason") or "").strip()
    assert reason, "启发式路径也必须产出 score_reason"
    assert reason != "启发式评分", "空话兜底必须消失"
    assert "4.28" in reason, f"理由须含平均痛点值：{reason}"
    assert "112" in reason, f"理由须含簇规模：{reason}"
    assert "付费" in reason, "理由须交代付费信号如何计分"
    assert "置信" in reason, "理由须含样本置信度"


def test_every_card_gets_a_reason(tmp_path):
    """score() 对每个簇都写 score_reason（含无付费信号的最小簇）。"""
    res = _run_score([dict(CLUSTER_TINY)])
    assert res and res[0].get("score_reason"), "最小簇也要有理由"


def test_card_reason_fallback_still_carries_numbers():
    """旧数据缺 score_reason 时，卡片兜底文案也必须带分数，不是空话。"""
    row = {"size": 11, "avg_pain": 4.0, "signal_distribution": {"求助": 7},
           "representative_quotes": ["原话"], "pain_summary": "摘要",
           "scores": {"demand": 3, "competition": None, "feasibility": 5,
                      "reach": None, "ai_leverage": None},
           "total_score": 55.0, "tier": "C", "mvp": {}}
    built = ec._build_card(row, 55.0, "C")
    body = built["content"]
    assert "**评分理由**：启发式评分\n" not in body, "空话兜底仍在"
    assert "55.0" in body, "兜底文案须带本次分数"
    assert "置信" in body or "样本" in body, "兜底文案须说明分数构成"


# ---------- #3 卡片标题 ----------

def test_card_title_skips_memes():
    """玩梗句（含 [表情] 标签）不得当卡片标题，退回主题标题。"""
    meme = ["笑死，干运维还没用到Python[笑哭]",
            "独立开发者最需要chatgpt[吃瓜]"]
    t = ec.format_title(meme, fallback="求助痛点（11 条评论）")
    assert "[笑哭]" not in t and "[吃瓜]" not in t, f"玩梗句混进标题：{t}"
    assert t == "求助痛点（11 条评论）", "无合格原话时应退回主题标题"


def test_card_title_prefers_informative_quote_over_first():
    """取信息量最高的一条，而不是首条。"""
    quotes = ["太坑了太坑了太坑了太坑了",                      # 首条，12 字
              "如果有一种工具能基于预设模板自动生成前端代码就好了"]  # 25 字，信息量更高
    t = ec.format_title(quotes)
    assert t == quotes[1], f"未选信息量更高的候选：{t}"
    assert quotes[0] != t, "取了首条而不是信息量更高的候选"


def test_card_title_fallback_shows_topic_and_scale():
    """主题标题必须同时给主导信号与样本规模（可判断证据量）。"""
    p = {"size": 11, "signal_distribution": {"求助": 7, "抱怨": 2}}
    t = ec._topic_title(p)
    assert "求助" in t and "11" in t, f"主题标题不合格：{t}"
    # 无信号时不得拼成「痛点痛点」（首版实测缺陷）
    empty = ec._topic_title({"size": 0, "signal_distribution": {}})
    assert "痛点痛点" not in empty, f"空信号双词 bug 复现：{empty}"
    assert empty.startswith("痛点（"), f"空信号兜底不合格：{empty}"


def test_card_title_keeps_short_but_real_pain_statement():
    """长度阈值不得误伤短而真实的诉求（9 字预算类原话必须留下）。"""
    t = ec.format_title(["预算有限投不起广告"])
    assert t == "预算有限投不起广告", f"短真实诉求被误伤：{t}"


def test_card_title_behaviour_on_clean_quotes():
    """无玩梗的正常原话仍按原规则截断（回归保护）。"""
    long_q = "独立开发者半年了一分钱没赚到产品也没人用到底该不该继续坚持这个问题每天晚上都在脑子里转"
    t = ec.format_title(["", long_q])
    assert t.endswith("…") and len(t) <= 31
    assert ec.format_title([]) == "未命名痛点"


# ---------- 报告反推必须与评分同源 ----------

def test_report_breakdown_shares_single_conf_formula():
    """旧版：exec_report 硬编码同一公式于第二处，改评分即反推失配。"""
    b = er.breakdown({"size": 43, "avg_pain": 4.0, "signal_distribution": {},
                      "scores": {"demand": 3, "competition": None,
                                 "feasibility": 5, "reach": None,
                                 "ai_leverage": None},
                      "total_score": 80.0, "tier": "A"})
    assert b["conf"] == _confidence_factor(43), "报告必须与评分用同一公式来源"
    assert b["conf"] < 1.0, "43 条尚未封顶（封顶已延后到 50 条）"


def test_report_recomputes_score_engine_output_exactly():
    """报告反推的总分必须与 score() 实际产出逐分一致。"""
    res = _run_score([dict(CLUSTER_BIG)])
    actual = res[0]
    b = er.breakdown(actual)
    assert b["recomputed"] == actual["total_score"], (
        f"反推 {b['recomputed']} ≠ 实际 {actual['total_score']}")
    assert b["size"] == 112
