"""评分必须诚实：无数据来源的维度不得伪造；卡片标题必须可读。"""
from scripts.pipeline.score_opportunity import _compose_total, _heuristic_scores


def test_heuristic_no_fabricated_dims():
    s = _heuristic_scores({"avg_pain": 6, "size": 20, "signal_distribution": {}})
    assert s["demand"] in (3, 4, 5)
    assert 1 <= s["feasibility"] <= 5
    assert s["competition"] is None
    assert s["reach"] is None
    assert s["ai_leverage"] is None


def test_total_over_available_dims_only():
    assert _compose_total({"demand": 5, "feasibility": 4, "competition": None}) == 90.0


def test_total_all_none_is_zero():
    assert _compose_total({k: None for k in
                           ("demand", "competition", "feasibility", "reach", "ai_leverage")}) == 0.0


def test_format_title():
    from scripts.pipeline.export_card import format_title
    long_quote = "独立开发者半年了一分钱没赚到产品也没人用到底该不该继续坚持这个问题每天晚上都在脑子里转"
    title = format_title(["", long_quote])
    assert len(title) <= 31 and title.endswith("…")
    assert len(title) < len(long_quote)
    # 空引语列表不应崩
    assert format_title([]) == "未命名痛点"


def test_format_dim_none_renders_dash():
    from scripts.pipeline.export_card import format_dim
    assert format_dim(4) == "4/5"
    assert format_dim(None) == "—"


# ---------- 方向A收窄版：证据驱动维度（OPEN_ISSUES #21，2026-10-15 批准） ----------

def _pain(sigs, quotes=None, size=60, avg=6.0):
    p = {"size": size, "avg_pain": avg, "signal_distribution": sigs}
    if quotes is not None:
        p["representative_quotes"] = quotes
    return p


def test_competition_scored_when_both_signals_dense():
    """对比+失望双证据且密度够 → 竞争空缺满分（有竞品但不满意 = 空缺大）。"""
    s = _heuristic_scores(_pain({"求助": 30, "对比": 10, "失望": 10}, size=60))
    assert s["competition"] == 5, f"双证据+33%密度应满分，实际 {s['competition']}"


def test_competition_scored_sparse_real_fixture_numbers():
    """真实 112 簇（对比6+失望7=11.6%）→ 4 分（有证据但密度不到加成线）。"""
    s = _heuristic_scores(_pain({"求助": 56, "对比": 6, "失望": 7}, size=112))
    assert s["competition"] == 4, f"实际 {s['competition']}"


def test_competition_single_signal_is_mid():
    """只有对比（在比较现方案但没抱怨）→ 中档 3 分，不得虚高。"""
    s = _heuristic_scores(_pain({"求助": 20, "对比": 6}, size=60))
    assert s["competition"] == 3, f"单证据应 3 分，实际 {s['competition']}"


def test_competition_none_without_evidence():
    """无对比无失望 → None：无证据不评，不伪造（方向A核心红线）。"""
    s = _heuristic_scores(_pain({"求助": 20}))
    assert s["competition"] is None


def test_ai_leverage_high_for_software_form_words():
    """代表句含工具/网站/一键类形态词 → AI杠杆 4-5（AI 可 10x）。"""
    s = _heuristic_scores(_pain({"求助": 5},
                                quotes=["求个工具能一键整理数据", "有没有网站能查询价格"]))
    assert s["ai_leverage"] is not None and s["ai_leverage"] >= 4, s


def test_ai_leverage_low_for_offline_form_words():
    """代表句含线下/门店/上门类 → AI杠杆 1-2（AI 难以杠杆）。"""
    s = _heuristic_scores(_pain({"求助": 5},
                                quotes=["线下门店维修太麻烦，还要上门服务"]))
    assert s["ai_leverage"] is not None and s["ai_leverage"] <= 2, s


def test_ai_leverage_none_without_form_words():
    """代表句无任何形态词 → None（不拿纯痛点句硬评杠杆）。"""
    s = _heuristic_scores(_pain({"求助": 5}, quotes=["太难了，每天都要手动做"]))
    assert s["ai_leverage"] is None


def test_reach_stays_none_even_with_full_evidence():
    """收窄版红线：触达难度无独立数据来源，任何证据下都留 None。"""
    s = _heuristic_scores(_pain({"求助": 30, "对比": 10, "失望": 10},
                                quotes=["求个工具", "做个网站"]))
    assert s["reach"] is None, "触达不得被硬凑（方向A收窄版）"


def test_reason_explains_each_dim_and_reach_gap():
    """reason 必须交代竞争/AI杠杆的证据来源，以及触达为何仍不参与。"""
    s = _heuristic_scores(_pain({"求助": 20, "对比": 6, "失望": 7},
                                quotes=["求个工具"]))
    r = s["reason"]
    assert "竞争" in r and "对比" in r and "失望" in r, f"竞争证据须可核对：{r}"
    assert "AI杠杆" in r, f"AI杠杆须说明来源：{r}"
    assert "触达" in r and "不参与" in r, f"触达缺席须明说：{r}"


def test_compose_total_includes_evidence_dims():
    """有证据维度进均值（2 维 90 分的语义在证据齐时变成 3-4 维）。"""
    # (5+4+4)/3 = 4.333 → ×20 = 86.7（3 维均值不再是 2 维的 (5+4)/2=90）
    assert _compose_total({"demand": 5, "feasibility": 4, "competition": 4}) == 86.7
    # 无证据时退回 2 维语义
    assert _compose_total({"demand": 5, "feasibility": 4, "competition": None}) == 90.0
