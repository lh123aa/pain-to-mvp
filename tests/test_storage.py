"""storage 入库计数必须真实：不得把 INSERT OR IGNORE 跳过的重复当新增。"""
from scripts.pipeline import storage


def _rec(rid, content):
    return {"id": rid, "platform": "bilibili", "source_id": "s1", "content": content}


def test_save_records_counts_only_real_inserts(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # storage 用相对 Path("data")，chdir 后落 tmp
    recs = [_rec("r1", "a"), _rec("r2", "b"), _rec("r1", "a")]  # 第 3 条是重复
    inserted = storage.save_records(recs, platform="bilibili")
    assert inserted == 2, f"实际仅 2 条新入库，却报告 {inserted} 条"

    stats = storage.stats()
    assert stats["total"] == 2, f"数据库应有 2 条，实际 {stats['total']}"
