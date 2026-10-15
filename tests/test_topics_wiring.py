"""--topics 从 run_all 接线到 mine_pain_points（OPEN_ISSUES #22）：
域内聚焦此前只在 mine CLI 可用、入口不传 = 默认关闭；接线后 run_all 透传。
"""
import json
import os
import time
from pathlib import Path

from scripts.pipeline import run_all


class _Args:
    def __init__(self, topics=None, keyword="测试词"):
        self.keyword = keyword
        self.platforms = ["bilibili"]
        self.limit = 1
        self.comments = 1
        self.topics = topics


def _setup(tmp_path, monkeypatch):
    """让 main 走到 mine 步骤：预置本次运行的 discovered + raw 产出"""
    monkeypatch.chdir(tmp_path)
    d = tmp_path / "data" / "discovered"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{run_all.safe_filename('测试词')}_20261015_0000.json").write_text(
        json.dumps({"items": []}, ensure_ascii=False), encoding="utf-8")

    real_now = time.time()
    monkeypatch.setattr(run_all.time, "time", lambda: real_now - 10)

    raw_dir = tmp_path / "data" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_file = raw_dir / "bilibili_x.jsonl"
    raw_file.write_text(
        '{"id":"1","platform":"bilibili","source_id":"s","content":"c"}\n',
        encoding="utf-8")

    captured = []
    monkeypatch.setattr(run_all, "run", lambda cmd: captured.append(cmd) or True)
    monkeypatch.setattr(run_all, "collect_raw_files", lambda d, since=None: [raw_file])
    # pains/scored 产物模拟"本次运行产出"
    for sub, name in [("pains", "pains_x.json"), ("scored", "scored_x.json")]:
        p = tmp_path / "data" / sub
        p.mkdir(parents=True, exist_ok=True)
        (p / name).write_text("[]", encoding="utf-8")
    return captured


def test_run_all_passes_topics_to_mine(tmp_path, monkeypatch):
    """给了 --topics 时，mine 子命令必须携带 --topics 及其词表"""
    captured = _setup(tmp_path, monkeypatch)
    run_all.main(_Args(topics=["独立开发", "接单"]))
    mine_cmds = [c for c in captured if any("mine_pain_points" in str(x) for x in c)]
    assert mine_cmds, "mine 步骤未执行"
    flat = [str(x) for x in mine_cmds[0]]
    assert "--topics" in flat
    i = flat.index("--topics")
    assert flat[i + 1:i + 3] == ["独立开发", "接单"]


def test_run_all_without_topics_omits_flag(tmp_path, monkeypatch):
    """未给 --topics 时不得凭空加 --topics（默认关闭行为不变）"""
    captured = _setup(tmp_path, monkeypatch)
    run_all.main(_Args(topics=None))
    mine_cmds = [c for c in captured if any("mine_pain_points" in str(x) for x in c)]
    assert mine_cmds
    assert "--topics" not in [str(x) for x in mine_cmds[0]]


def test_run_all_default_topics_attr_missing兼容(tmp_path, monkeypatch):
    """旧调用方的 args 无 topics 属性时不崩（getattr 兜底）"""
    captured = _setup(tmp_path, monkeypatch)

    class Old:
        keyword = "测试词"
        platforms = ["bilibili"]
        limit = 1
        comments = 1

    run_all.main(Old())
    mine_cmds = [c for c in captured if any("mine_pain_points" in str(x) for x in c)]
    assert mine_cmds
    assert "--topics" not in [str(x) for x in mine_cmds[0]]
