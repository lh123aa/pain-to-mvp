"""归档后的读者改造：校准与看板必须找得到已移入 data/projects/*/cards 的卡片。

- calibration.find_card：先搜 projects/*/cards/{id}.md，再回退 data/cards/{id}.md
- write_dashboard.rebuild：卡片来源 = data/cards/*.md + data/projects/*/cards/*.md
  （迁移期两条路径共存，幂等不重复——同一卡片只算一份）
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# ---------- calibration.find_card ----------

def test_find_card_locates_moved_project_card(tmp_path, monkeypatch):
    import scripts.pipeline.calibration as cal
    cards = tmp_path / "projects" / "独立开发者" / "cards"
    cards.mkdir(parents=True)
    (cards / "20261016-001.md").write_text(
        "# 卡片\n- **信号分布**：{\"求助\": 3}\n", encoding="utf-8")
    legacy = tmp_path / "data" / "cards"
    legacy.mkdir(parents=True)
    p = cal.find_card("20261016-001", data_root=tmp_path / "data",
                     projects_root=tmp_path / "projects")
    assert p == cards / "20261016-001.md"


def test_find_card_falls_back_to_legacy(tmp_path):
    import scripts.pipeline.calibration as cal
    legacy = tmp_path / "cards"
    legacy.mkdir()
    (legacy / "20261015-001.md").write_text("# x", encoding="utf-8")
    p = cal.find_card("20261015-001", data_root=tmp_path,
                      projects_root=tmp_path / "projects" / "nope")
    assert p == legacy / "20261015-001.md"


def test_find_card_missing_returns_none(tmp_path):
    import scripts.pipeline.calibration as cal
    (tmp_path / "cards").mkdir()
    assert cal.find_card("nope", data_root=tmp_path,
                         projects_root=tmp_path / "projects") is None


def test_extract_signals_uses_moved_card(tmp_path, monkeypatch):
    import scripts.pipeline.calibration as cal
    cards = tmp_path / "projects" / "独立开发者" / "cards"
    cards.mkdir(parents=True)
    (cards / "20261016-001.md").write_text(
        "- **信号分布**：{\"求助\": 3, \"吐槽\": 1}\n", encoding="utf-8")
    sigs = cal._extract_signals_from_card(
        "20261016-001", data_root=tmp_path / "data",
        projects_root=tmp_path / "projects")
    assert sigs == {"求助": 3, "吐槽": 1}


# ---------- write_dashboard.rebuild ----------

def test_dashboard_counts_project_cards(tmp_path, monkeypatch):
    import importlib
    import scripts.dashboard.write_dashboard as wd
    # 造两份卡片：legacy 1 张 + project 1 张
    legacy = tmp_path / "cards"
    legacy.mkdir()
    (legacy / "20261015-001.md").write_text(
        "- **标题**：旧卡\n- **机会分**：80.0/100\n", encoding="utf-8")
    pcards = tmp_path / "projects" / "独立开发者" / "cards"
    pcards.mkdir(parents=True)
    (pcards / "20261016-001.md").write_text(
        "- **标题**：新卡\n- **机会分**：90.0/100\n", encoding="utf-8")
    monkeypatch.setattr(wd, "CARD_DIR", legacy)
    monkeypatch.setattr(wd, "PROJECTS_ROOT", tmp_path / "projects")
    monkeypatch.setattr(wd, "DASHBOARD", tmp_path / "dashboard.json")
    db = wd.rebuild()
    assert db["summary"]["total"] == 2
    assert db["requirements"][0]["id"] == "20261016-001"  # 90 分排前
    assert db["requirements"][0]["card_path"].replace("\\", "/").endswith(
        "projects/独立开发者/cards/20261016-001.md")


def test_dashboard_no_duplicates_when_card_in_both(tmp_path, monkeypatch):
    """同一卡片若 legacy 与 project 各有一份（异常残留），只计一次不翻倍。"""
    import scripts.dashboard.write_dashboard as wd
    legacy = tmp_path / "cards"
    legacy.mkdir()
    same = "# 卡\n"
    (legacy / "20261016-001.md").write_text(same, encoding="utf-8")
    pcards = tmp_path / "projects" / "独立开发者" / "cards"
    pcards.mkdir(parents=True)
    (pcards / "20261016-001.md").write_text(same, encoding="utf-8")
    monkeypatch.setattr(wd, "CARD_DIR", legacy)
    monkeypatch.setattr(wd, "PROJECTS_ROOT", tmp_path / "projects")
    monkeypatch.setattr(wd, "DASHBOARD", tmp_path / "dashboard.json")
    db = wd.rebuild()
    assert db["summary"]["total"] == 1
