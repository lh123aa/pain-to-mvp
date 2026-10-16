# -*- coding: utf-8 -*-
"""A5 可信度修复（2026-10-15 抽检 top3=33% 的两个根因，MS-0005）。

根因①：痛点描述句直接取 representative_quotes[0]——段子（"笑死，干运维还没
用到Python" 靠子串"没用"误命中失望信号）会成为卡片描述与标题源；
根因②：3 条杂谈评论的小簇也产出"可行动机会卡"，证据不足以支撑任何主张。

修复口径：
① 强行动信号（求助/期望/付费意愿）句在代表句中前置；描述引句只从强信号句选，
   无强信号句则省略引句（宁缺毋假，不塞段子）；
② size < 5 的簇不出卡，且跳过不占用 top 配额。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from cluster import _select_representative  # noqa: E402
from export_card import export  # noqa: E402
import mine_pain_points as mp  # noqa: E402

JOKE = "笑死，干运维还没用到Python[笑哭]"          # 段子：子串"没用"误命中失望
HELP = "拿Python搞后端怎么样，Java没学过想转行"     # 真实求助
PLAN = "要是能有模板自动生成前端代码就好了"          # 期望


def _member(text, labels):
    return {
        "content": text, "clean_content": text, "pain_score": 5,
        "pain_signals": [{"type": "t", "label": l, "word": "x", "weight": 3}
                         for l in labels],
    }


# ---------- ① 描述句/代表句：强信号优先，段子永不当描述 ----------

def test_representative_puts_strong_signal_first():
    members = [_member(JOKE, {"失望"}), _member(HELP, {"求助"})]
    rep = _select_representative(members, top=2)
    assert rep[0] == HELP, "求助句必须居代表句首位——段子不得当描述/标题源"


def test_representative_strong_priority_wins_over_rep_score():
    """大池（走 rep_score 路径）同样强信号先行：强句必须进入 top。"""
    strong = _member(HELP, {"求助"})
    others = [_member(f"这个工具太麻烦了流程复杂得要命第{i}种吐槽说法", {"抱怨"})
              for i in range(4)]
    rep = _select_representative([strong] + others, top=2)
    assert rep[0] == HELP, "rep_score 排序不得把求助句挤出代表句首位"


def test_representative_without_signals_order_unchanged():
    """无 pain_signals 的成员（既有测试数据形态）不受分区影响。"""
    a = {"clean_content": "独立开发者怎么获客啊？投放太贵了根本烧不起，求一个低成本的渠道推荐", "pain_score": 8}
    b = {"clean_content": "获客太难了，试了好几个渠道都没效果", "pain_score": 6}
    rep = _select_representative([a, b], top=2)
    assert rep[0] == a["clean_content"]


def test_summary_quote_only_strong_signal():
    cluster = {
        "representative": [JOKE, HELP],
        "members": [_member(JOKE, {"失望"}), _member(HELP, {"求助"})],
    }
    got = mp._select_summary_quote(cluster["representative"], cluster["members"])
    assert got == HELP, "描述句必须取求助/期望/付费意愿信号句，不得取段子"


def test_summary_quote_accepts_expect_and_pay():
    assert mp._select_summary_quote([PLAN], [_member(PLAN, {"期望"})]) == PLAN
    assert mp._select_summary_quote(
        ["这个工具多少钱，收费太贵了值不值"],
        [_member("这个工具多少钱，收费太贵了值不值", {"付费意愿"})],
    ) == "这个工具多少钱，收费太贵了值不值"


def test_summary_quote_omitted_when_no_strong():
    """无强信号句时省略引句（宁缺毋假），不回退到段子。"""
    got = mp._select_summary_quote([JOKE], [_member(JOKE, {"失望"})])
    assert got == "", "无强信号句时应返回空——描述不得塞段子"


def test_summary_quote_strips_trailing_punct():
    got = mp._select_summary_quote([HELP + "！"], [_member(HELP + "！", {"求助"})])
    assert got == HELP


# ---------- ② 极小簇（<5 条）证据不足不出卡 ----------

def _entry(size, score, quote):
    return {
        "cluster_id": 0, "size": size, "avg_pain": 4.0,
        "signal_distribution": {"求助": size},
        "representative_quotes": [quote],
        "total_score": score, "tier": "S" if score >= 80 else "B",
        "scores": {"demand": 4, "competition": 3, "feasibility": 4,
                   "reach": 2, "ai_leverage": 4},
        "score_confidence": 0.9,
        "mvp": {"recommended_mvp": [{"type": "小工具", "rationale": "r"}],
                "validation_plan": [], "revenue_layers": [], "tech_stack": []},
    }


def test_small_cluster_no_card(tmp_path, monkeypatch):
    """3 条杂谈簇不得出卡——证据不足无法支撑可行动主张（A5 2026-10-15）。"""
    monkeypatch.chdir(tmp_path)
    src = tmp_path / "scored.json"
    src.write_text(json.dumps(
        [_entry(3, 43.7, "你怎么不问问工地干活的，为什么不想做包工头")],
        ensure_ascii=False), encoding="utf-8")
    cards = export(str(src), top=5)
    assert cards == [], f"极小簇出了卡：{cards}"


def test_small_cluster_skip_does_not_block_below(tmp_path, monkeypatch):
    """小簇被跳过不占用 top 配额：下方大簇仍顶上。"""
    monkeypatch.chdir(tmp_path)
    src = tmp_path / "scored.json"
    src.write_text(json.dumps([
        _entry(3, 90.0, "段子占位句：草台班子搞笑合集再来一段"),
        _entry(11, 59.6, "求一个能自动生成周报的工具，手写太耗时间了"),
    ], ensure_ascii=False), encoding="utf-8")
    cards = export(str(src), top=1)
    assert len(cards) == 1, "跳过小簇后大簇应顶上 top 配额"
    assert cards[0]["size"] == 11


def test_qualified_cluster_still_exports(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    src = tmp_path / "scored.json"
    src.write_text(json.dumps(
        [_entry(10, 85.0, "求模板化低代码工具，不会前端想做小程序")],
        ensure_ascii=False), encoding="utf-8")
    cards = export(str(src), top=5)
    assert len(cards) == 1, "证据充足的簇必须正常出卡"
