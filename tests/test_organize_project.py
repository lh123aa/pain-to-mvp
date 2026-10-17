"""每个项目（关键词）生成的文件单独归档一个子文件夹（用户需求 2026-10-17）。

布局：data/projects/{关键词}/{discovered|pains|scored|cards|raw}/
- discovered 文件名 = safe_filename(keyword)_YYYYMMDD_HHMM.json → 关键词权威
- pains/scored/cards 无关键词标记 → 按 mtime 就近归属到「发现时间 <= 文件时间
  且间隔最小」的那一轮（MAX_GAP 内），无归属 → projects/_待认领/
- raw 只**复制**进项目夹、根 raw/ 保留：raw 同时服务跨轮去重（#20/#31），
  移走会导致同关键词重跑全量重爬 → 风控风险加重（2026-10-17 v_voucher 两次拦截）
- 归档后重建看板（看板 glob 改为 data/cards + data/projects/*/cards）
- 归档幂等：重复执行不重复搬移、不崩溃
"""
import json
import os
import time
from pathlib import Path

from scripts.pipeline.organize_project import (
    apply_plan,
    plan_migrate,
    plan_run,
    project_dir,
    write_readme,
)

KW = "独立开发者"
SAFE_KW = "独立开发者"


def _touch(path: Path, content: str = "{}", mtime: float = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def _discovered(root: Path, kw_stem: str, ts: str, source_ids, mtime: float) -> Path:
    data = [{"source_id": sid, "platform": "bilibili"} for sid in source_ids]
    return _touch(root / "discovered" / f"{kw_stem}_{ts}.json",
                  json.dumps(data, ensure_ascii=False), mtime)


def _mk_root(tmp_path: Path) -> Path:
    for sub in ("discovered", "pains", "scored", "cards", "raw"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


# ---------- migrate：历史全量归位 ----------

def test_migrate_moves_discovered_into_project_folder(tmp_path):
    root = _mk_root(tmp_path)
    t0 = time.time() - 7200
    f = _discovered(root, SAFE_KW, "20261017_0937", ["111"], t0)
    moves, copies, unattr = plan_migrate(root)
    assert (root / "discovered" / f.name) in [m[0] for m in moves]
    dst = dict(moves)[f]
    assert dst == project_dir(root, SAFE_KW) / "discovered" / f.name


def test_migrate_attributes_pains_and_cards_by_nearest_run(tmp_path):
    root = _mk_root(tmp_path)
    t0 = time.time() - 7200
    _discovered(root, SAFE_KW, "20261017_0937", ["111"], t0)
    pains = _touch(root / "pains" / "pains_all_20261017_0938.json", "{}", t0 + 90)
    card = _touch(root / "cards" / "20261017-001.md", "# card", t0 + 120)
    moves, _, unattr = plan_migrate(root)
    dm = dict(moves)
    assert dm[pains] == project_dir(root, SAFE_KW) / "pains" / pains.name
    assert dm[card] == project_dir(root, SAFE_KW) / "cards" / card.name
    assert pains not in unattr and card not in unattr


def test_migrate_far_files_go_to_pending_folder(tmp_path):
    """超出归属窗口（>30 分钟）的文件不硬安给某个项目 → _待认领/。"""
    root = _mk_root(tmp_path)
    t0 = time.time() - 7200
    _discovered(root, SAFE_KW, "20261017_0937", ["111"], t0)
    orphan = _touch(root / "pains" / "pains_all_20260101_0000.json", "{}", t0 + 10 * 3600)
    moves, _, unattr = plan_migrate(root)
    dst = dict(moves)[orphan]
    assert "_待认领" in str(dst)
    assert dst.parent.name == "pains"


def test_migrate_raw_copied_not_moved(tmp_path):
    """raw 复制进项目夹，根保留（跨轮去重依赖 jsonl_path_for 单一权威）。"""
    root = _mk_root(tmp_path)
    t0 = time.time() - 7200
    _discovered(root, SAFE_KW, "20261017_0937", ["111"], t0)
    raw = _touch(root / "raw" / "bilibili_111.jsonl", '{"id":"1"}\n', t0 + 30)
    moves, copies, _ = plan_migrate(root)
    assert raw not in [m[0] for m in moves]  # 不进移动清单
    assert (raw, project_dir(root, SAFE_KW) / "raw" / raw.name) in copies


def test_migrate_raw_shared_by_two_keywords_copied_to_both(tmp_path):
    root = _mk_root(tmp_path)
    t0 = time.time() - 7200
    _discovered(root, SAFE_KW, "20261017_0937", ["111"], t0)
    _discovered(root, "聊天女主播", "20261017_0938", ["111"], t0 + 60)
    raw = _touch(root / "raw" / "bilibili_111.jsonl", '{"id":"1"}\n', t0 + 30)
    _, copies, _ = plan_migrate(root)
    dsts = [c[1] for c in copies if c[0] == raw]
    assert len(dsts) == 2
    assert any("独立开发者" in str(d) for d in dsts)
    assert any("聊天女主播" in str(d) for d in dsts)
    assert raw.exists()  # 原件保留


def test_migrate_is_idempotent(tmp_path):
    root = _mk_root(tmp_path)
    t0 = time.time() - 7200
    _discovered(root, SAFE_KW, "20261017_0937", ["111"], t0)
    _touch(root / "cards" / "20261017-001.md", "# card", t0 + 120)
    m1, c1, _ = plan_migrate(root)
    apply_plan(m1, c1)
    m2, c2, _ = plan_migrate(root)
    assert m2 == []
    apply_plan(m2, c2)  # 不崩溃


def test_unsafe_keyword_folder_uses_safe_filename(tmp_path):
    root = _mk_root(tmp_path)
    proj = project_dir(root, "a/b c")
    # 路径分隔符必须被替换（与 discovered 文件命名的 safe_filename 同源；
    # 内部空格保留是既有权威行为，不在本需求范围）
    assert "/" not in proj.name and "\\" not in proj.name
    assert proj.parent == root / "projects"


# ---------- run：e2e 收尾归档本轮 ----------

def test_run_mode_moves_only_files_after_run_start(tmp_path):
    root = _mk_root(tmp_path)
    t0 = time.time() - 7200
    _discovered(root, SAFE_KW, "20261016_1646", ["111"], t0)
    old_card = _touch(root / "cards" / "20261016-001.md", "# old", t0 + 120)
    run_start = time.time() - 60
    new_disc = _discovered(root, SAFE_KW, "20261017_1000", ["222"], time.time() - 30)
    new_card = _touch(root / "cards" / "20261017-001.md", "# new", time.time() - 10)
    moves, copies, _ = plan_run(root, KW, run_start)
    dm = dict(moves)
    assert new_card in dm and new_disc in dm
    assert old_card not in dm  # 历史文件不进本轮归档（归 migrate 管）
    assert raw_of(root, "bilibili_222.jsonl") not in [m[0] for m in moves]


def raw_of(root: Path, name: str) -> Path:
    return root / "raw" / name


def test_run_mode_copies_manifest_raw(tmp_path):
    root = _mk_root(tmp_path)
    from scripts.pipeline.run_inputs import write_crawl_manifest
    raw = _touch(root / "raw" / "bilibili_222.jsonl", '{"id":"2"}\n')
    write_crawl_manifest(root / "raw", [raw])
    run_start = time.time() - 60
    _discovered(root, SAFE_KW, "20261017_1000", ["222"], time.time() - 30)
    moves, copies, _ = plan_run(root, KW, run_start)
    assert (raw, project_dir(root, SAFE_KW) / "raw" / raw.name) in copies


# ---------- README 索引 ----------

def test_write_readme_lists_archived_files(tmp_path):
    root = _mk_root(tmp_path)
    t0 = time.time() - 7200
    _discovered(root, SAFE_KW, "20261017_0937", ["111"], t0)
    _touch(root / "cards" / "20261017-001.md", "# card", t0 + 120)
    m, c, _ = plan_migrate(root)
    apply_plan(m, c)
    readme = write_readme(project_dir(root, SAFE_KW))
    text = readme.read_text(encoding="utf-8")
    assert "20261017-001.md" in text
    assert "discovered" in text or "发现" in text
