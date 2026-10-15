# -*- coding: utf-8 -*-
"""P0 域校验三层防线：关键词类型前置判定 / 成人擦边黑名单 / 召回后域重合度。

实测依据（docs/exec-report-20261014-2105-独立开发者怎么接单.md）：
- 问题域「独立开发者怎么接单」痛点率 23.6%
- 娱乐域「女孩喜欢的物件」痛点率 4.5%
差距 5.2 倍 —— 域错是唯一被实测证明的 5 倍杠杆。
词表规则，不用语义模型。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from domain_check import classify_keyword, is_adult, domain_overlap  # noqa: E402


# ---------- Layer 1: 关键词类型前置判定 ----------

def test_classify_problem_domain():
    """问题域关键词必须被判为 problem。"""
    assert classify_keyword("独立开发者怎么接单") == "problem"
    assert classify_keyword("独立开发者获客") == "problem"
    assert classify_keyword("如何做自媒体") == "problem"
    assert classify_keyword("编程入门教程") == "problem"


def test_classify_entertainment_domain():
    """娱乐域关键词必须被判为 entertainment。"""
    assert classify_keyword("女孩喜欢的物件") == "entertainment"
    assert classify_keyword("美女穿搭") == "entertainment"
    assert classify_keyword("美食探店") == "entertainment"
    assert classify_keyword("治愈系动漫") == "entertainment"


def test_classify_unknown_domain():
    """无法判定的关键词返回 unknown。"""
    assert classify_keyword("测试") == "unknown"
    assert classify_keyword("") == "unknown"
    assert classify_keyword("abc") == "unknown"


# ---------- Layer 2: 成人擦边黑名单硬拦截 ----------

def test_is_adult_hits_blacklist():
    """命中成人擦边黑名单的文本必须被拦截。"""
    assert is_adult("这个视频有福利姬")
    assert is_adult("擦边内容")
    assert is_adult("福利视频")


def test_is_adult_passes_normal():
    """正常文本不能被误拦。"""
    assert not is_adult("这个工具太难用了")
    assert not is_adult("独立开发者怎么接单")
    assert not is_adult("求推荐一个平替")


def test_preprocess_rejects_adult():
    """preprocess_comments 必须丢弃命中成人黑名单的评论。"""
    from preprocess import preprocess_comments
    comments = [
        {"content": "这个工具太难用了，求解决方案", "id": 1},
        {"content": "福利姬写真集", "id": 2},
        {"content": "独立开发者怎么获客", "id": 3},
    ]
    out = preprocess_comments(comments)
    texts = [c["content"] for c in out]
    assert "福利姬写真集" not in texts
    assert len(out) == 2


# ---------- Layer 3: 召回后域重合度 ----------

def test_domain_overlap_high():
    """关键词与召回标题高度重合时，overlap 必须高。"""
    result = domain_overlap("独立开发者", ["独立开发者如何接单", "独立开发者获客技巧"])
    assert result["overlap_ratio"] > 0.8
    assert result["verdict"] == "domain_match"


def test_domain_overlap_low():
    """关键词与召回标题完全不同时，overlap 必须低。"""
    result = domain_overlap("独立开发者", ["女孩喜欢的物件", "美食探店"])
    assert result["overlap_ratio"] < 0.2
    assert result["verdict"] == "domain_mismatch"


def test_domain_overlap_samples():
    """未命中的标题必须出现在 samples 中（供报告展示）。"""
    result = domain_overlap("独立开发者",
                            ["独立开发者如何接单", "女孩喜欢的物件", "美食探店"])
    assert len(result["samples"]) == 2
    assert "女孩喜欢的物件" in result["samples"]
    assert "美食探店" in result["samples"]


def test_domain_overlap_empty_titles():
    """空标题列表返回 unknown 判定。"""
    result = domain_overlap("独立开发者", [])
    assert result["verdict"] == "unknown"
    assert result["total_titles"] == 0


def test_domain_overlap_majority_offdomain_is_mismatch():
    """多数召回跑偏时不得判为 domain_match（33% 命中曾被判"基本一致"，是误导）。"""
    result = domain_overlap("独立开发者",
                            ["独立开发者如何接单", "女孩喜欢的物件", "美食探店"])
    assert result["overlap_ratio"] == 0.333
    assert result["verdict"] == "domain_mismatch", (
        "2/3 召回是娱乐域，报告不能写「基本一致」")


def test_domain_overlap_half_ondomain_matches():
    """半数命中到阈值即判 domain_match。"""
    result = domain_overlap("独立开发者",
                            ["独立开发者如何接单", "独立开发者获客", "美食探店"])
    assert result["overlap_ratio"] >= 0.5
    assert result["verdict"] == "domain_match"


# ---------- 集成：exec_report 域重合度 ----------

def test_exec_report_shows_domain_verdict(tmp_path, monkeypatch):
    """exec_report section 4 必须展示域重合度判定。"""
    import exec_report as er

    # 创建假 discovered 文件（娱乐域标题，模拟召回跑偏）
    discovered = tmp_path / "discovered.json"
    discovered.write_text(json.dumps([
        {"source_id": "123", "title": "女孩喜欢的物件"},
        {"source_id": "456", "title": "美食探店"},
    ], ensure_ascii=False), encoding="utf-8")

    # 重定向报告输出目录，避免污染 docs/
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)

    md_path = er.generate("独立开发者", discovered=str(discovered), raw_files=[])
    content = md_path.read_text(encoding="utf-8")

    # 必须包含域重合度判定
    assert "域重合度" in content
    assert "domain_mismatch" in content or "跑偏" in content


def test_exec_report_html_shows_domain_verdict(tmp_path, monkeypatch):
    """exec_report HTML section 4 必须展示域重合度判定。"""
    import exec_report as er

    discovered = tmp_path / "discovered.json"
    discovered.write_text(json.dumps([
        {"source_id": "123", "title": "女孩喜欢的物件"},
        {"source_id": "456", "title": "美食探店"},
    ], ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)

    md_path = er.generate("独立开发者", discovered=str(discovered), raw_files=[])
    html_path = md_path.with_suffix(".html")
    html_content = html_path.read_text(encoding="utf-8")

    assert "域重合度" in html_content


def test_section4_text_agrees_with_verdict(tmp_path, monkeypatch):
    """第 4 节文案必须与域重合度判定一致 —— 判 match 却写「跑偏」是自相矛盾。

    真实数据暴露：女孩喜欢的物件 报告写 80%「基本一致」，
    下一句却是写死的「不符…跑偏」，判定与文案打架。
    """
    import exec_report as er

    # 全部召回标题都命中问题域 → 应判 domain_match
    disc_match = tmp_path / "disc_match.json"
    disc_match.write_text(json.dumps([
        {"source_id": "1", "title": "独立开发者如何接单报价"},
        {"source_id": "2", "title": "独立开发者获客难题"},
    ], ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    md = er.generate("独立开发者", discovered=str(disc_match), raw_files=[])
    body = md.read_text(encoding="utf-8")

    assert "domain_match" not in body or "跑偏" not in body.split("## 5.")[0], "判定与文案矛盾"
    sec4 = body.split("## 4.")[1].split("## 5.")[0]
    assert "基本一致" in sec4, "match 判定应说明基本一致"
    assert "跑偏" not in sec4, f"domain_match 时第 4 节不得写「跑偏」，实际：{sec4[:200]}"


def test_section4_text_flags_mismatch(tmp_path, monkeypatch):
    """召回跑偏时第 4 节必须明说跑偏（不能只靠 verdict 字段）。"""
    import exec_report as er

    disc = tmp_path / "disc_mis.json"
    disc.write_text(json.dumps([
        {"source_id": "1", "title": "女孩喜欢的物件"},
        {"source_id": "2", "title": "美食探店"},
    ], ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    md = er.generate("独立开发者", discovered=str(disc), raw_files=[])
    sec4 = md.read_text(encoding="utf-8").split("## 4.")[1].split("## 5.")[0]

    assert "域重合度 0%" in sec4
    assert "跑偏" in sec4, "mismatch 判定必须明说跑偏"


def test_funnel_clean_layer_mentions_adult_rule(tmp_path, monkeypatch):
    """清洗层丢弃计数含成人黑名单命中 —— 说明若不提「成人」则数字与解释不符。"""
    import exec_report as er

    raw = tmp_path / "b.jsonl"
    raw.write_text(
        '{"content": "为什么这么贵，太坑了，失望"}\n'
        '{"content": "福利姬写真集高清资源分享"}\n', encoding="utf-8")
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)

    md = er.generate(keyword="独立开发者", raw_files=[raw])
    body = md.read_text(encoding="utf-8")

    # 漏斗清洗行：为什么丢 必须包含成人黑名单
    funnel_line = [ln for ln in body.splitlines()
                   if ln.startswith("| 清洗 |") and "is_valid" in ln]
    assert funnel_line, "漏斗清洗行缺失"
    assert "成人" in funnel_line[0], (
        f"清洗层丢弃解释必须含成人黑名单（Layer 2 在这层丢弃），实际：{funnel_line[0]}")

    # 第 6 节清洗规则行同样
    rules_line = [ln for ln in body.splitlines()
                  if ln.startswith("| 清洗 |") and "len<4" in ln]
    assert rules_line and "成人" in rules_line[0], (
        f"第6节清洗规则行必须含成人黑名单，实际：{rules_line}")
