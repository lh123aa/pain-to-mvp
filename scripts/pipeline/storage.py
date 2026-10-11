#!/usr/bin/env python3
"""
标准存储层：统一 JSONL + SQLite 写入，字段标准化。
所有工具的输出都应经过这里，保证下游可消费。
"""
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterable, Dict, Any

DATA_DIR = Path("data")
DB_PATH = DATA_DIR / "pain_to_mvp.db"
JSONL_DIR = DATA_DIR / "raw"

STANDARD_FIELDS = [
    "id", "platform", "source_id", "source_title", "content",
    "author", "likes", "replies", "timestamp", "url", "extra"
]

def _normalize(record: Dict[str, Any]) -> Dict[str, Any]:
    """把任意工具的字段映射到标准格式"""
    out = {k: record.get(k) for k in STANDARD_FIELDS}
    # 兼容常见字段名
    mapping = {
        "comment_id": "id", "cid": "id", "rpid": "id",
        "text": "content", "body": "content", "reply": "content",
        "nickname": "author", "uname": "author", "user": "author",
        "like_count": "likes", "score": "likes", "digg_count": "likes", "votes": "likes",
        "create_time": "timestamp", "created_utc": "timestamp", "time": "timestamp",
        "reply_count": "replies", "rcount": "replies",
    }
    for src, dst in mapping.items():
        if not out.get(dst) and record.get(src) is not None:
            out[dst] = record[src]
    out["extra"] = {k: v for k, v in record.items() if k not in STANDARD_FIELDS}
    return out

def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            platform TEXT,
            source_id TEXT,
            source_title TEXT,
            content TEXT,
            author TEXT,
            likes INTEGER,
            replies INTEGER,
            timestamp TEXT,
            url TEXT,
            extra TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_platform ON comments(platform)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_source ON comments(source_id)")
    conn.commit()
    return conn

def save_records(records: Iterable[Dict[str, Any]], platform: str, source_id: str = ""):
    """批量写入 JSONL + SQLite，自动去重"""
    JSONL_DIR.mkdir(parents=True, exist_ok=True)
    jsonl_path = JSONL_DIR / f"{platform}_{source_id or 'all'}.jsonl"

    conn = init_db()
    inserted = 0
    skipped = 0

    with open(jsonl_path, "a", encoding="utf-8") as f:
        for r in records:
            norm = _normalize(r)
            norm["platform"] = norm.get("platform") or platform
            if not norm.get("id"):
                skipped += 1
                continue
            try:
                conn.execute(
                    """INSERT OR IGNORE INTO comments
                       (id, platform, source_id, source_title, content, author,
                        likes, replies, timestamp, url, extra)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        norm["id"], norm["platform"], norm.get("source_id") or source_id,
                        norm.get("source_title"), norm.get("content"), norm.get("author"),
                        norm.get("likes") or 0, norm.get("replies") or 0,
                        norm.get("timestamp"), norm.get("url"),
                        json.dumps(norm.get("extra") or {}, ensure_ascii=False)
                    )
                )
                if conn.total_changes:
                    inserted += 1
                f.write(json.dumps(norm, ensure_ascii=False) + "\n")
            except sqlite3.Error:
                skipped += 1

    conn.commit()
    conn.close()
    print(f"💾 写入 {inserted} 条（跳过 {skipped}）→ {jsonl_path}")
    return inserted

def query_comments(platform=None, source_id=None, limit=1000):
    conn = init_db()
    sql = "SELECT * FROM comments WHERE 1=1"
    params = []
    if platform:
        sql += " AND platform=?"; params.append(platform)
    if source_id:
        sql += " AND source_id=?"; params.append(source_id)
    sql += " LIMIT ?"; params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    cols = ["id","platform","source_id","source_title","content","author",
            "likes","replies","timestamp","url","extra","created_at"]
    return [dict(zip(cols, r)) for r in rows]

def stats():
    conn = init_db()
    total = conn.execute("SELECT COUNT(*) FROM comments").fetchone()[0]
    by_platform = conn.execute(
        "SELECT platform, COUNT(*) FROM comments GROUP BY platform"
    ).fetchall()
    conn.close()
    return {"total": total, "by_platform": dict(by_platform)}

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--stats", action="store_true")
    args = p.parse_args()
    if args.stats:
        print(json.dumps(stats(), ensure_ascii=False, indent=2))
