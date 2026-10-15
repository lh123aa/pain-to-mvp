"""storage 入库计数必须真实：不得把 INSERT OR IGNORE 跳过的重复当新增。

JSONL 侧同理：跨 run 反复爬同一视频，重复 comment_id 不得重复追加
（OPEN_ISSUES #20：raw 跨 run 累积 → 漏斗 loaded 虚高）。
"""
import json
from pathlib import Path

from scripts.pipeline import storage

ROOT = Path(__file__).resolve().parent.parent


def _rec(rid, content):
    return {"id": rid, "platform": "bilibili", "source_id": "s1", "content": content}


def test_save_records_counts_only_real_inserts(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # storage 用相对 Path("data")，chdir 后落 tmp
    recs = [_rec("r1", "a"), _rec("r2", "b"), _rec("r1", "a")]  # 第 3 条是重复
    inserted = storage.save_records(recs, platform="bilibili")
    assert inserted == 2, f"实际仅 2 条新入库，却报告 {inserted} 条"

    stats = storage.stats()
    assert stats["total"] == 2, f"数据库应有 2 条，实际 {stats['total']}"


def _jsonl_lines(tmp_path):
    # save_records 用参数 source_id（本测试未传 → 'all'）命名文件
    p = Path(tmp_path) / "data" / "raw" / "bilibili_all.jsonl"
    return [ln for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]


def test_jsonl_dedups_within_batch(tmp_path, monkeypatch):
    """批内重复 comment_id 只写一行（分页重叠会产出批内重复）。"""
    monkeypatch.chdir(tmp_path)
    storage.save_records([_rec("r1", "a"), _rec("r2", "b"), _rec("r1", "a")],
                         platform="bilibili")
    lines = _jsonl_lines(tmp_path)
    assert len(lines) == 2, f"JSONL 应 2 行（批内去重），实际 {len(lines)} 行"


def test_jsonl_does_not_accumulate_across_runs(tmp_path, monkeypatch):
    """跨 run 重爬同一视频，重复 id 不得再追加 —— 漏斗 loaded 不再虚高。"""
    monkeypatch.chdir(tmp_path)
    # 第一轮：3 条新评论
    storage.save_records([_rec("r1", "a"), _rec("r2", "b"), _rec("r3", "c")],
                         platform="bilibili")
    # 第二轮：同视频重爬，r1/r2 重复，r4 是新评论（分页漂移）
    storage.save_records([_rec("r1", "a"), _rec("r2", "b"), _rec("r4", "d")],
                         platform="bilibili")

    lines = _jsonl_lines(tmp_path)
    assert len(lines) == 4, (
        f"两轮共 4 个唯一 id，JSONL 应 4 行，实际 {len(lines)} 行（跨 run 累积）")
    ids = [json.loads(ln)["id"] for ln in lines]
    assert sorted(ids) == ["r1", "r2", "r3", "r4"]


def test_jsonl_still_writable_after_db_wipe(tmp_path, monkeypatch):
    """DB 被清后重爬：JSONL 自身是去重权威，已有 id 不重复、新 id 照写。"""
    monkeypatch.chdir(tmp_path)
    storage.save_records([_rec("r1", "a")], platform="bilibili")
    # 模拟 DB 清空（JSONL 仍在）
    db = Path(tmp_path) / "data" / "pain_to_mvp.db"
    db.unlink()

    storage.save_records([_rec("r1", "a"), _rec("r2", "b")], platform="bilibili")
    lines = _jsonl_lines(tmp_path)
    ids = sorted(json.loads(ln)["id"] for ln in lines)
    assert ids == ["r1", "r2"], f"r1 不得重复、r2 必须补上，实际 {ids}"


def test_fix_storage_overlay_upgrades_template(tmp_path):
    """apply_fixes overlay 必须能把生成器模板态升到含 JSONL 去重的权威版。

    模板（generate_p2，extract 可被仓库外 MVP.md 覆盖）仍是 total_changes 时代；
    幂等测试只验「已修复树重跑不变」，不验「新树能被修到」—— 这里补后者：
    模板 → fix_storage(patch1 rowcount + patch2 去重) → save_records 段与
    工作区权威版逐字节一致。
    """
    import importlib
    import sys

    src = (ROOT / "generators" / "generate_p2.py").read_text(encoding="utf-8")
    key = 'FILES["scripts/pipeline/storage.py"] = r\'\'\''
    start = src.index(key) + len(key)
    template = src[start:src.index("'''", start)]
    assert "conn.total_changes" in template, "模板前提变了（已不是 total_changes 态）"

    p = tmp_path / "storage.py"
    p.write_text(template, encoding="utf-8")

    sys.path.insert(0, str(ROOT / "generators"))
    apply_fixes = importlib.import_module("apply_fixes")
    apply_fixes.fix_storage(p)

    text = p.read_text(encoding="utf-8")
    assert "cur.rowcount" in text, "patch1（rowcount 诚实计数）未打上"
    assert "_existing_jsonl_ids" in text, "patch2（JSONL 跨 run 去重）未打上"
    assert "seen_ids.add" in text, "批内去重逻辑缺失"

    # 与工作区权威版的 save_records 段逐字节一致（overlay = 被测实现）
    def section(t):
        return t.split("def save_records")[1].split("def query_comments")[0]

    assert section(text) == section(
        (ROOT / "scripts" / "pipeline" / "storage.py").read_text(encoding="utf-8")
    ), "overlay 产出的 save_records 与工作区权威版不一致"
