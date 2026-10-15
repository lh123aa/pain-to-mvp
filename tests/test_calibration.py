"""评分校准闭环（OPEN_ISSUES #11 / PRD §五）：
- record：抽检记录可追加（格式校验，fail-close 不写脏数据）
- review：累计抽检可回看命中率（真实率 + 信号级命中率），满 20 条提示回看
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))

from calibration import record, review, SCHEMA_FIELDS


def _write_cal(file, lines):
    file.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------- record：抽检可记录 ----------

def test_record_appends_one_line(tmp_path):
    f = tmp_path / "calibration.jsonl"
    rec = record(f, card_id="20261015-001", verdict="real",
                 note="痛点真实可行动", run="e2e-A5", rank=1,
                 quotes_traceable=True, date="2026-10-15")
    assert f.exists()
    lines = f.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    saved = json.loads(lines[0])
    assert saved == rec
    assert saved["card_id"] == "20261015-001"
    assert saved["verdict"] == "real"
    assert saved["note"] == "痛点真实可行动"
    # 必填字段齐全（格式契约）
    for key in SCHEMA_FIELDS:
        assert key in saved


def test_record_rejects_invalid_verdict(tmp_path):
    """verdict 只允许 real/fake —— 非法值必须拒绝且不落盘（不许骗人）"""
    f = tmp_path / "calibration.jsonl"
    with pytest.raises(ValueError):
        record(f, card_id="x-1", verdict="maybe", note="n")
    assert not f.exists()


def test_record_rejects_empty_note(tmp_path):
    """note 为空的抽检记录没有回看价值 —— 拒绝"""
    f = tmp_path / "calibration.jsonl"
    with pytest.raises(ValueError):
        record(f, card_id="x-1", verdict="real", note="  ")
    assert not f.exists()


def test_record_rejects_duplicate_card(tmp_path):
    """同一卡片重复抽检必须显式拒绝（防重复计数污染命中率）"""
    f = tmp_path / "calibration.jsonl"
    record(f, card_id="dup-1", verdict="real", note="n")
    with pytest.raises(ValueError):
        record(f, card_id="dup-1", verdict="fake", note="改判")


def test_record_extracts_signals_from_card_md(tmp_path, monkeypatch):
    """record 自动从卡片 md 抽取信号分布 —— 让 review 能算信号级命中率"""
    monkeypatch.chdir(tmp_path)
    cards = tmp_path / "data" / "cards"
    cards.mkdir(parents=True)
    (cards / "c-9.md").write_text(
        "# 机会卡片 #c-9\n\n## 痛点\n- **信号分布**：{\"求助\": 5, \"抱怨\": 2}\n"
        "- **代表原话**：\n- 「求推荐一个工具」\n", encoding="utf-8")
    f = tmp_path / "calibration.jsonl"
    rec = record(f, card_id="c-9", verdict="real", note="n")
    assert rec["signals"] == {"求助": 5, "抱怨": 2}


# ---------- review：累计 20 条可回看命中率 ----------

def test_review_tolerates_bad_lines(tmp_path):
    """JSONL 坏行跳过 + 警告，不崩溃（PRD §4.1 fail-close 同款约定）"""
    f = tmp_path / "calibration.jsonl"
    _write_cal(f, [
        "not json",
        json.dumps({"date": "2026-10-13", "card_id": "a-1", "verdict": "real",
                    "note": "n", "run": "r", "rank": 1,
                    "quotes_traceable": True, "signals": None}),
    ])
    result = review(f)
    assert result["total"] == 1
    assert result["skipped_bad_lines"] == 1


def test_review_reports_hit_rate_and_progress(tmp_path):
    f = tmp_path / "calibration.jsonl"
    recs = [
        {"date": "2026-10-13", "card_id": f"t-{i}", "verdict": v, "note": "n",
         "run": "r", "rank": 1, "quotes_traceable": True, "signals": None}
        for i, v in enumerate(["real", "real", "fake"])
    ]
    _write_cal(f, [json.dumps(r, ensure_ascii=False) for r in recs])
    result = review(f)
    assert result["total"] == 3
    assert result["real_count"] == 2
    assert result["fake_count"] == 1
    assert result["hit_rate"] == pytest.approx(2 / 3)
    assert result["target"] == 20
    assert result["reached_target"] is False


def test_review_flags_reached_target(tmp_path):
    """满 20 条即达到回看线 —— reached_target 置位，触发规则回看"""
    f = tmp_path / "calibration.jsonl"
    recs = [
        {"date": "2026-10-15", "card_id": f"t-{i}", "verdict": "real",
         "note": "n", "run": "r", "rank": 1, "quotes_traceable": True,
         "signals": None}
        for i in range(20)
    ]
    _write_cal(f, [json.dumps(r, ensure_ascii=False) for r in recs])
    result = review(f)
    assert result["reached_target"] is True
    assert result["hit_rate"] == pytest.approx(1.0)


def test_review_signal_hit_rates(tmp_path):
    """信号级命中率：某信号在真卡 vs 假卡中的出现率 —— 决定是否调 SIGNALS/权重"""
    f = tmp_path / "calibration.jsonl"
    recs = [
        {"date": "2026-10-15", "card_id": "s-1", "verdict": "real", "note": "n",
         "run": "r", "rank": 1, "quotes_traceable": True,
         "signals": {"求助": 5}},
        {"date": "2026-10-15", "card_id": "s-2", "verdict": "real", "note": "n",
         "run": "r", "rank": 2, "quotes_traceable": True,
         "signals": {"求助": 3, "期望": 1}},
        {"date": "2026-10-15", "card_id": "s-3", "verdict": "fake", "note": "n",
         "run": "r", "rank": 3, "quotes_traceable": True,
         "signals": {"期望": 4}},
    ]
    _write_cal(f, [json.dumps(r, ensure_ascii=False) for r in recs])
    result = review(f)
    rates = result["signal_hit_rates"]
    # 求助：2 张真卡有、0 张假卡有 → 命中率 1.0
    assert rates["求助"]["total"] == 2
    assert rates["求助"]["real"] == 2
    assert rates["求助"]["rate"] == pytest.approx(1.0)
    # 期望：1 真 1 假 → 命中率 0.5（弱信号，回看时的调权候选）
    assert rates["期望"]["total"] == 2
    assert rates["期望"]["real"] == 1
    assert rates["期望"]["rate"] == pytest.approx(0.5)


def test_review_top3_hit_rate(tmp_path):
    """成功线口径：top3（rank<=3）抽检的命中率 ≥70% —— 单独统计"""
    f = tmp_path / "calibration.jsonl"
    recs = [
        {"date": "2026-10-15", "card_id": f"r-{i}", "verdict": v, "note": "n",
         "run": "run-A", "rank": rank, "quotes_traceable": True, "signals": None}
        for i, (v, rank) in enumerate(
            [("real", 1), ("real", 2), ("fake", 3), ("fake", 7), ("real", 8)])
    ]
    _write_cal(f, [json.dumps(r, ensure_ascii=False) for r in recs])
    result = review(f)
    assert result["top3_total"] == 3
    assert result["top3_hit_rate"] == pytest.approx(2 / 3)
