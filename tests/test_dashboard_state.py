"""dashboard 状态机（OPEN_ISSUES #9 / PRD §6.1）：
六阶段单向流转 + dropped 终态 + progress 只增不减 + schema_version 顶层。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "dashboard"))

import update_progress as up


def _make_db(tmp_path, status="mining", progress=40):
    """预置一个 dashboard.json（含一条需求）"""
    db = {
        "schema_version": 1,
        "last_updated": None,
        "summary": {},
        "requirements": [{
            "id": "r-1", "title": "t", "status": status, "progress": progress,
            "stage": "s", "score": None, "representative_quotes": [],
            "discovered_at": "2026-10-15T00:00:00", "timeline": [],
        }],
    }
    (tmp_path / "data").mkdir(exist_ok=True)
    (tmp_path / "data" / "dashboard.json").write_text(
        json.dumps(db, ensure_ascii=False), encoding="utf-8")
    return db


def test_rejects_invalid_status(tmp_path, monkeypatch, capsys):
    """非法状态（不在 PRD 六阶段枚举内）必须拒绝且不写盘"""
    monkeypatch.chdir(tmp_path)
    _make_db(tmp_path)
    ok = up.update("r-1", status="banana")
    assert ok is False
    db = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    assert db["requirements"][0]["status"] == "mining"  # 未被污染
    assert "非法状态" in capsys.readouterr().out


def test_rejects_backward_transition(tmp_path, monkeypatch, capsys):
    """状态单向流转：mining → discovering 回退必须拒绝"""
    monkeypatch.chdir(tmp_path)
    _make_db(tmp_path, status="mining")
    ok = up.update("r-1", status="discovering")
    assert ok is False
    assert "回退" in capsys.readouterr().out
    db = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    assert db["requirements"][0]["status"] == "mining"


def test_allows_forward_and_same_stage(tmp_path, monkeypatch):
    """前进（mining → scoring）与同阶段更新（scoring → scoring，改 stage 文案）允许"""
    monkeypatch.chdir(tmp_path)
    _make_db(tmp_path, status="mining")
    assert up.update("r-1", status="scoring") is True
    assert up.update("r-1", status="scoring", stage="评分完成") is True
    db = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    assert db["requirements"][0]["status"] == "scoring"
    assert db["requirements"][0]["stage"] == "评分完成"


def test_dropped_is_terminal(tmp_path, monkeypatch, capsys):
    """dropped 是终态：任意状态可 drop，drop 后不可再流转"""
    monkeypatch.chdir(tmp_path)
    _make_db(tmp_path, status="scoring")
    assert up.update("r-1", status="dropped") is True
    assert up.update("r-1", status="done") is False
    db = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    assert db["requirements"][0]["status"] == "dropped"


def test_progress_only_increases(tmp_path, monkeypatch):
    """progress 只增不减（PRD §6.1）：50 → 30 应保持 50"""
    monkeypatch.chdir(tmp_path)
    _make_db(tmp_path, status="scoring", progress=50)
    up.update("r-1", status="designing", progress=30)
    db = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    assert db["requirements"][0]["progress"] == 50
    up.update("r-1", status="designing", progress=80)
    db = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    assert db["requirements"][0]["progress"] == 80


def test_schema_version_written_top_level(tmp_path, monkeypatch):
    """dashboard.json 顶层必须含 schema_version（PRD §6.1）"""
    monkeypatch.chdir(tmp_path)
    _make_db(tmp_path)
    up.update("r-1", status="scoring")
    db = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    assert db.get("schema_version") == up.SCHEMA_VERSION


def test_legacy_status_migrated_on_load(tmp_path, monkeypatch):
    """旧枚举（discovered/analyzing/...）在加载时迁移到 PRD 六阶段，不崩不丢"""
    monkeypatch.chdir(tmp_path)
    db = {
        "last_updated": None, "summary": {}, "requirements": [
            {"id": "old-1", "status": "discovered", "progress": 10},
            {"id": "old-2", "status": "completed", "progress": 90},
            {"id": "old-3", "status": "dropped", "progress": 20},
        ],
    }
    (tmp_path / "data").mkdir(exist_ok=True)
    (tmp_path / "data" / "dashboard.json").write_text(
        json.dumps(db, ensure_ascii=False), encoding="utf-8")
    up.update("old-1", status="done")
    db2 = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    st = {r["id"]: r["status"] for r in db2["requirements"]}
    assert st["old-1"] == "done"        # discovered →(迁移 designing)→ done 前进合法
    assert st["old-2"] == "done"        # completed → done
    assert st["old-3"] == "dropped"     # dropped 保持终态
    assert db2["schema_version"] == up.SCHEMA_VERSION


def test_add_requirement_starts_pending(tmp_path, monkeypatch):
    """新增需求从 pending 起步（状态机起点）"""
    monkeypatch.chdir(tmp_path)
    _make_db(tmp_path)
    assert up.add_requirement("n-1", "新需求") is True
    db = json.loads((tmp_path / "data" / "dashboard.json").read_text(encoding="utf-8"))
    new = [r for r in db["requirements"] if r["id"] == "n-1"][0]
    assert new["status"] == "pending"
