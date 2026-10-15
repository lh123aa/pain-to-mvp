# -*- coding: utf-8 -*-
"""exec_report：每次跑批自动产出「执行结果 + 为什么这么执行」报告。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

import exec_report as er  # noqa: E402


# ---------- 1. 分数拆解 ----------

def test_score_breakdown_matches_formula():
    """总分必须能拆解成 demand/feasibility/conf 的算术，并标出未评维度。"""
    from score_opportunity import _confidence_factor
    size = 43
    expected = round((3 + 5) / 2 * 20 * _confidence_factor(size), 1)  # 与评分同源
    scored = {
        "size": size, "avg_pain": 4.28,
        "signal_distribution": {"求助": 25, "付费意愿": 1},
        "scores": {"demand": 3, "competition": None, "feasibility": 5,
                   "reach": None, "ai_leverage": None},
        "total_score": expected, "tier": "A",
    }
    b = er.breakdown(scored)
    assert b["demand"] == 3
    assert b["feasibility"] == 5
    assert b["feas_basis"] == "size=43<50"      # 说明可行性是"由簇大小"给的
    assert b["conf"] == _confidence_factor(size), "报告必须与评分共用同一 conf 公式"
    assert b["conf"] < 1.0, "43 条尚未封顶（封顶已延后到 50 条）"
    assert abs(b["recomputed"] - expected) < 0.05    # 反推总分与实际一致
    assert b["unevaluated"] == ["competition", "reach", "ai_leverage"]
    assert b["dims_used"] == 2 and b["dims_total"] == 5   # 5 维只用 2 维


def test_breakdown_exposes_size_driven_score():
    """同痛点强度下，簇大小必须显出对分数的影响。

    feasibility 由 size 决定（<50 满分 5，400 条只得 3）—— 揭示可行性是伪信息；
    conf 在 size≥50 才封顶 1.0（旧版 10 条即封顶，11 条与 112 条证据同价，
    是 112 条真实需求簇被 11 条玩梗簇压过的根因之一）。
    """
    small = er.breakdown({"size": 43, "avg_pain": 4.28, "signal_distribution": {"求助": 25},
                          "scores": {"demand": 3, "feasibility": 5,
                                     "competition": None, "reach": None, "ai_leverage": None},
                          "total_score": 80.0, "tier": "A"})
    big = er.breakdown({"size": 400, "avg_pain": 4.28, "signal_distribution": {"求助": 25},
                        "scores": {"demand": 3, "feasibility": 3,
                                   "competition": None, "reach": None, "ai_leverage": None},
                        "total_score": 60.0, "tier": "B"})
    assert small["feasibility"] == 5 and big["feasibility"] == 3, "size<50 必须拿满 5 分"
    assert "size" in small["feas_basis"], "必须标明可行性是'由簇大小'给的，不是内容判断"
    assert big["conf"] == 1.0, "大簇应封顶 1.0"
    assert small["conf"] < 1.0, "43 条不得已封顶（旧版 size≥10 即 1.0）"
    assert small["conf"] < big["conf"], "43 条与 400 条的证据强度必须不同"
    # 同一 demand=3 下，小簇靠 feasibility 满分拿到更高总分（尽管 conf 略折减）
    assert small["recomputed"] > big["recomputed"]
    assert small["tier"] == "A" and big["tier"] != "A"


# ---------- 2. 被过滤评论的词级理由 ----------

def test_dropped_samples_carry_word_level_reason():
    """被丢弃的评论必须给出「命中了哪个词 / 一个都没命中」。"""
    rows = [
        {"content": "哈哈哈太好笑了"},                       # 0 分
        {"content": "为什么这个东西这么贵啊"},                # why + pay → 高分（不该被丢）
        {"content": "up主加油"},                             # 0 分
    ]
    dropped = er.explain_dropped(rows, min_score=3)
    dropped_texts = [d["content"] for d in dropped]
    assert "为什么这个东西这么贵啊" not in dropped_texts, "高分评论不得进被丢清单"
    zero = [d for d in dropped if d["score"] == 0]
    assert len(zero) == 2
    for d in zero:
        assert d["hits"] == [], "0 分必须明示 0 个信号命中"
        assert "0 个规则词" in d["reason"]


def test_dropped_reason_names_the_hits_that_weren_t_enough():
    """1~2 分的评论要说清「命中了什么、为什么还不够 3 分」。"""
    rows = [{"content": "建议加个夜间模式"}]   # expect(希望/建议) weight=4 → ≥3 会被保留
    kept = er.explain_dropped(rows, min_score=3)
    # 4 分应被保留，故不在 dropped 里
    assert all(r["content"] != "建议加个夜间模式" for r in kept)

    rows2 = [{"content": "建议参考下"}]
    got = er.explain_dropped(rows2, min_score=99)   # 用高阈值强制它被丢
    assert got and got[0]["score"] > 0
    assert got[0]["hits"], "必须列出命中的词"
    assert str(got[0]["score"]) in got[0]["reason"]


# ---------- 3. 决策漏斗 ----------

def test_funnel_counts_every_stage(tmp_path):
    """漏斗必须逐层数出 载入/清洗/去重/痛点/簇/卡片，且数字自洽（层层递减）。"""
    raw = tmp_path / "raw.jsonl"
    lines = [
        '{"content": "为什么这么贵，太坑了，失望"}\n',      # 高分 → 保留
        '{"content": "哈哈哈"}\n',                          # 清洗层丢（is_valid 不过）
        '{"content": "为什么这么贵，太坑了，失望"}\n',      # 重复 → 去重层丢
        '{"content": "这个视频的配乐和剪辑都很舒服"}\n',    # 0 分 → 痛点层丢 ★
        "\n",                                               # 坏行
    ]
    raw.write_text("".join(lines), encoding="utf-8")
    f = er.funnel([raw])
    assert f["loaded"] == 4              # 坏行不算
    assert f["cleaned"] <= f["loaded"]
    assert f["deduped"] <= f["cleaned"]
    assert f["painful"] <= f["deduped"]
    assert "dropped_pain" in f and f["dropped_pain"] == f["deduped"] - f["painful"]
    assert f["dropped_pain"] >= 1, "通过清洗但 0 分的评论必须在痛点层被丢"
    assert f["dropped_clean"] >= 1, "'哈哈哈' 这类必须在清洗层就丢"


# ---------- 4. 报告落盘 ----------

def test_report_written_and_mentions_key_facts(tmp_path, monkeypatch):
    """报告必须落盘，并含 漏斗/分数拆解/被丢理由/视频标题 四块。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    raw = tmp_path / "bilibili_1.jsonl"
    raw.write_text(
        '{"content": "为什么这么贵"}\n'
        '{"content": "哈哈哈"}\n'
        '{"content": "这个视频的配乐和剪辑都很舒服"}\n',   # 通过清洗但 0 分 → 报告须解释它为何被丢
        encoding="utf-8")
    disc = tmp_path / "disc.json"
    disc.write_text(json.dumps([
        {"source_id": "1", "title": "测试视频标题A"},
        {"source_id": "2", "title": "测试视频标题B"},
    ], ensure_ascii=False), encoding="utf-8")
    scored = tmp_path / "scored.json"
    scored.write_text(json.dumps([{
        "size": 5, "avg_pain": 4.0,
        "signal_distribution": {"求助": 3},
        "scores": {"demand": 3, "feasibility": 5, "competition": None,
                   "reach": None, "ai_leverage": None},
        "total_score": 72.8, "tier": "A",
        "representative_quotes": ["为什么这么贵"],
    }], ensure_ascii=False), encoding="utf-8")

    out = er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw],
                      scored=scored)
    assert out.exists(), "报告必须落盘"
    body = out.read_text(encoding="utf-8")
    assert "决策漏斗" in body
    assert "为什么这个分" in body or "分数拆解" in body
    assert "测试视频标题A" in body, "必须列出实际召回视频（暴露域跑偏）"
    assert "0 个规则词" in body or "命中" in body
    assert "测试关键词" in body
    assert "未评" in body or "competition" in body, "必须标出未评维度"


def test_section2_formula_text_matches_actual_conf(tmp_path, monkeypatch):
    """第 2 节公式文案必须与现行 conf 公式一致。

    历史缺陷：1b1e2d5 把斜率 0.04 调到 0.008，公式文案没跟着改 ——
    报告展示的公式与真实计算各说各话（数字与解释不符）。
    须给 scored（公式行只在有卡片时渲染）。
    """
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    scored = tmp_path / "scored_f.json"
    scored.write_text(json.dumps([{
        "size": 60, "avg_pain": 6.0, "signal_distribution": {"求助": 20},
        "scores": {"demand": 3, "competition": None, "feasibility": 3,
                   "reach": None, "ai_leverage": None},
        "total_score": 60.0, "tier": "B",
        "representative_quotes": ["太难了"],
    }], ensure_ascii=False), encoding="utf-8")
    out = er.generate(keyword="测试关键词", discovered=None, raw_files=[], scored=scored)
    body = out.read_text(encoding="utf-8")
    assert "0.6+0.008×size" in body, "公式文案必须用现行 conf 斜率 0.008"
    assert "0.6+0.04×size" not in body, "过期公式 0.04 残留在报告里"


def test_section2_table_exposes_evidence_dims(tmp_path, monkeypatch):
    """竞争/AI杠杆进了均值，拆解表必须展示数值与「证据驱动」口径。

    旧表只有 需求/可行性 两列（当时其余三维恒 None）—— 维度进均值后
    不上表就是不可核对；旧的「三维恒为 None」说明也变成谎话。
    """
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    scored = tmp_path / "scored_ev.json"
    # 竞争=5 的算术：(4+5+3)/3×20 = 80.0，conf(60)=1.0 → 80.0 自洽
    scored.write_text(json.dumps([{
        "size": 60, "avg_pain": 6.0,
        "signal_distribution": {"求助": 30, "对比": 10, "失望": 10},
        "scores": {"demand": 4, "competition": 5, "feasibility": 3,
                   "reach": None, "ai_leverage": None},
        "total_score": 80.0, "tier": "A",
        "representative_quotes": ["求个工具"],
    }], ensure_ascii=False), encoding="utf-8")
    out = er.generate(keyword="测试关键词", discovered=None, raw_files=[], scored=scored)
    sec2 = out.read_text(encoding="utf-8").split("## 2.")[1].split("## 3.")[0]

    assert "| 4 | 5 | 3 (size=60<200) |" in sec2, (
        f"拆解行必须依次展示 需求4/竞争5/可行性3，实际：{sec2[:400]}")
    assert "竞争" in sec2 and "AI杠杆" in sec2, "表头缺证据维度列"
    assert "证据驱动" in sec2, "参与口径须改为证据驱动"
    assert "竞争空缺 / 触达难度 / AI杠杆` 恒为 `None`" not in sec2, (
        "旧的「三维恒 None」说明已过期（竞争/AI杠杆现在证据驱动）")


def test_report_filename_contains_keyword(tmp_path, monkeypatch):
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    out = er.generate(keyword="独立开发者", discovered=None, raw_files=[], scored=None)
    assert "exec-report-" in out.name and out.name.endswith(".md")


# ---------- 5. 口径与动态计算（首版实际缺陷回归） ----------

def test_dropped_sample_scope_matches_funnel(tmp_path):
    """抽样池必须与漏斗 dropped_pain 同口径（去重后），不得混入去重前的重复行。

    首版缺陷：报告写「丢 44 条」（去重后口径），抽样却跑 cleaned_rows（去重前），
    导致同一条评论在样本里重复出现 3 次。
    """
    raw = tmp_path / "r.jsonl"
    # 3 条完全相同的高分评论（跨视频重复）+ 1 条通过清洗但 0 分
    same = '{"content": "为什么这么贵，太坑了，失望"}\n'
    raw.write_text(same * 3 + '{"content": "这个视频的配乐和剪辑都很舒服"}\n',
                   encoding="utf-8")
    st = er._stages([raw])
    assert st["dropped_dup"] == 2, "重复行应在去重层被丢"

    pool = er.explain_dropped(st["deduped_rows"], 3, sample=None)
    assert len(pool) == st["dropped_pain"], "抽样池必须与漏斗丢弃数同口径"
    contents = [d["content"] for d in pool]
    assert len(contents) == len(set(contents)), "样本里不得出现重复条目"


def test_drop_rate_is_computed_not_hardcoded(tmp_path, monkeypatch):
    """丢弃率必须按本次实际数据算，不得出现写死的百分比。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    raw = tmp_path / "r.jsonl"
    # 1 条高分保留 + 4 条相同 0 分（去重后 1 条）→ dropped_pain/deduped = 1/2 = 50%
    raw.write_text(
        '{"content": "为什么这么贵，太坑了，失望"}\n'
        '{"content": "这个视频的配乐和剪辑都很舒服"}\n' * 4, encoding="utf-8")
    out = er.generate(keyword="测试关键词", discovered=None, raw_files=[raw], scored=None)
    body = out.read_text(encoding="utf-8")
    assert "76%" not in body, "不得残留写死的 76%"
    f = er.funnel([raw])
    expected = f"{f['dropped_pain'] / f['deduped'] * 100:.0f}%"
    assert expected in body, f"必须显示本次实际算出的丢弃率 {expected}"


# ---------- 6. run_all 接入 & 幂等 ----------

def test_run_all_wires_exec_report():
    """run_all 必须在 export 之后调用 exec_report（常驻能力）。"""
    src = (ROOT / "scripts" / "pipeline" / "run_all.py").read_text(encoding="utf-8")
    assert "exec_report" in src, "run_all 未接入 exec_report"
    # 必须在 export_card 步骤之后
    assert src.index("export_card") < src.index("exec_report")


def test_apply_fixes_stays_idempotent_with_exec_report(workspace_clone):
    """改动后重跑 apply_fixes 不得破坏 run_all 的 exec_report 步骤。

    OPEN_ISSUES #27：在工作区副本上跑（子进程 ROOT 指向副本），不再碰真实树。
    """
    import subprocess
    p = workspace_clone / "scripts" / "pipeline" / "run_all.py"
    before = p.read_text(encoding="utf-8")
    r = subprocess.run([sys.executable, str(workspace_clone / "generators" / "apply_fixes.py")],
                       capture_output=True, text=True, cwd=str(workspace_clone), timeout=300)
    after = p.read_text(encoding="utf-8")
    assert r.returncode == 0, r.stderr[-400:]
    assert "exec_report" in after, "apply_fixes 重跑把 exec_report 接入打掉了"
    assert before == after, "apply_fixes 重跑改动了 run_all（不幂等）"
