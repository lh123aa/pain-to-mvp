# -*- coding: utf-8 -*-
"""exec_report 的 HTML 单文件输出（最终报告形式，2026-10-14 用户选定）。

要求：自包含（双击浏览器即开、可直接分享）、不可信输入转义、
六节齐全、丢弃率动态算、与 Markdown 同名成对。
"""
import glob as globmod
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

import exec_report as er  # noqa: E402


def _html(tmp_path) -> str:
    files = sorted(tmp_path.glob("exec-report-*.html"))
    assert files, f"未产出 HTML，实际文件：{[p.name for p in tmp_path.iterdir()]}"
    return files[-1].read_text(encoding="utf-8")


def _seed(tmp_path):
    raw = tmp_path / "bilibili_1.jsonl"
    raw.write_text(
        '{"content": "为什么这么贵，太坑了，失望"}\n'
        '{"content": "这个视频的配乐和剪辑都很舒服"}\n',   # 通过清洗但 0 分
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
    return disc, raw, scored


def test_generate_writes_html_and_markdown_pair(tmp_path, monkeypatch):
    """HTML 与 Markdown 必须同名成对产出（各取所需，git 存档 + 浏览器查看）。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    disc, raw, scored = _seed(tmp_path)
    md = er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)

    assert md.exists() and md.suffix == ".md"
    html_files = list(tmp_path.glob("exec-report-*.html"))
    assert len(html_files) == 1, "必须同时产出 HTML"
    assert html_files[0].stem == md.stem, "HTML 与 Markdown 必须同名成对"


def test_html_is_self_contained(tmp_path, monkeypatch):
    """单文件必须自包含：内联样式、零外部请求（断网也能打开）。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    disc, raw, scored = _seed(tmp_path)
    er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)
    body = _html(tmp_path)

    assert body.lstrip().lower().startswith("<!doctype html>")
    assert "<style" in body, "样式必须内联"
    for banned in ("<link", "<script", "src=", "http://", "https://", "url("):
        assert banned not in body, f"存在外部依赖 {banned}，破坏单文件离线可用性"


def test_html_escapes_untrusted_titles(tmp_path, monkeypatch):
    """discovered 的 title 不经任何清洗直入报告，必须转义，否则破结构/注入。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    _, raw, scored = _seed(tmp_path)
    disc = tmp_path / "disc_evil.json"
    disc.write_text(json.dumps([
        {"source_id": "9", "title": '<img src=x onerror=alert(1)>危险标题 & "引号"'},
    ], ensure_ascii=False), encoding="utf-8")

    er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)
    body = _html(tmp_path)

    assert "<img src=x" not in body, "未转义的标签破进 HTML"
    assert "&lt;img" in body, "必须以实体形式呈现原始标题"
    assert "&amp;" in body, "& 必须转义"


def test_html_has_all_six_sections_and_dynamic_rate(tmp_path, monkeypatch):
    """六节齐全，且丢弃率是本次算出来的、不是写死的。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    disc, raw, scored = _seed(tmp_path)
    er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)
    body = _html(tmp_path)

    for sec in ("决策漏斗", "分数拆解", "被痛点层丢弃", "实际召回的视频",
                "异常", "本次执行用到的规则"):
        assert sec in body, f"缺 {sec} 节"

    f = er.funnel([raw])
    expected = f"{f['dropped_pain'] / f['deduped'] * 100:.0f}%"
    assert expected in body, f"丢弃率必须是动态算出的 {expected}"
    assert "76%" not in body, "不得残留写死的 76%"


def test_html_shows_funnel_and_breakdown_with_unevaluated_dims(tmp_path, monkeypatch):
    """主角漏斗与配角拆解表都要在，且必须标出未评维度（核心可解释点）。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    disc, raw, scored = _seed(tmp_path)
    er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)
    body = _html(tmp_path)

    assert "funnel" in body, "漏斗必须有可视化结构"
    assert "测试视频标题A" in body, "视频标题（域自查）必须在"
    assert "2/5" in body or "只有 2/5" in body, "必须点出只有 2 个维度参与"
    assert "competition" in body or "竞争空缺" in body, "必须标出未评维度"
    assert "0 个规则词" in body or "0 个规则" in body, "词级理由必须在"


def test_html_groups_zero_hit_samples_to_kill_repetition(tmp_path, monkeypatch):
    """0 分样本的 reason 必须收敛为组内一次说明，不得每条重复（视觉噪声）。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    _, _, scored = _seed(tmp_path)
    disc = tmp_path / "disc.json"
    disc.write_text(json.dumps([{"source_id": "1", "title": "T"}],
                               ensure_ascii=False), encoding="utf-8")
    raw = tmp_path / "many.jsonl"
    # 1 条高分（保留）+ 3 条 0 分（被丢，引文各不相同）
    raw.write_text(
        '{"content": "为什么这么贵，太坑了，失望"}\n'
        '{"content": "这个视频的配乐和剪辑都很舒服"}\n'
        '{"content": "镜头语言很讲究构图舒服"}\n'
        '{"content": "旁白的声音质感不错"}\n', encoding="utf-8")

    er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)
    body = _html(tmp_path)

    assert body.count("0 个规则词") == 1, (
        f"0 命中说明应只出现一次（组标题），实际 {body.count('0 个规则词')} 次")
    for q in ("配乐和剪辑", "镜头语言", "旁白的声音"):
        assert q in body, f"0 分样本引文 {q} 必须仍逐条列出"


def test_html_table_header_aligns_with_numeric_column(tmp_path, monkeypatch):
    """数字列的表头必须与内容同为右对齐（对齐红线：接近对齐最丑）。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    disc, raw, scored = _seed(tmp_path)
    er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)
    body = _html(tmp_path)
    assert '<th class="num">#</th>' in body, "# 列头必须右对齐与数字列一致"


def test_html_output_has_no_emoji_icons(tmp_path, monkeypatch):
    """红线 #2：报告不得用 emoji 充当图标/装饰（专业文档感）。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    disc, raw, scored = _seed(tmp_path)
    er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)
    body = _html(tmp_path)
    emoji = [c for c in body if ord(c) > 0x1F000 and 0x1F300 <= ord(c) <= 0x1FAFF]
    assert not emoji, f"HTML 含 emoji 图标：{emoji[:5]}"


def test_section6_lists_domain_rules(tmp_path, monkeypatch):
    """第 6 节规则表必须列出域校验三层防线的规则与位置（可核对性）。"""
    monkeypatch.setattr(er, "REPORT_DIR", tmp_path)
    disc, raw, scored = _seed(tmp_path)
    md = er.generate(keyword="测试关键词", discovered=disc, raw_files=[raw], scored=scored)
    body = md.read_text(encoding="utf-8")

    # 三层防线各自的位置必须可查
    for loc in ("run_all.domain_precheck", "domain_check.is_adult",
                "domain_check.domain_overlap"):
        assert loc in body, f"第 6 节规则表缺 {loc}"
    html_body = _html(tmp_path)
    for loc in ("run_all.domain_precheck", "domain_check.is_adult",
                "domain_check.domain_overlap"):
        assert loc in html_body, f"HTML 第 6 节规则表缺 {loc}"
