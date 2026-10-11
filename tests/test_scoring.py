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
