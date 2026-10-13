"""run_all 一键入口：入口崩溃修复（#21）+ fail-fast + 旧产物防护（#3）。"""
import json
import os
import time
from pathlib import Path

import pytest

from scripts.pipeline import run_all


def _touch_discovered(tmp_path, keyword="测试词"):
    d = tmp_path / "data" / "discovered"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{run_all.safe_filename(keyword)}_20261013_0000.json"
    f.write_text(json.dumps({"items": []}, ensure_ascii=False), encoding="utf-8")
    return f


def test_main_aborts_when_discover_fails(tmp_path, monkeypatch):
    """discover 失败必须立刻中止，绝不进入旧文件 glob（当前 RED: UnboundLocalError）"""
    monkeypatch.chdir(tmp_path)
    # 让真实 run() 执行：discover 子进程返回非零 → run() 应抛 SystemExit
    monkeypatch.setattr(run_all.subprocess, "run",
                        lambda cmd, text=True: type("R", (), {"returncode": 1})())

    class A:
        keyword = "测试词"
        platforms = ["bilibili"]
        limit = 1
        comments = 1

    with pytest.raises(SystemExit):
        run_all.main(A())


def test_main_ignores_stale_pains_file(tmp_path, monkeypatch):
    """本次运行无新 pains 产出时，旧 mtime 的 pains 文件不得被消费（当前 RED: 直接 return 不报错）"""
    monkeypatch.chdir(tmp_path)
    _touch_discovered(tmp_path)

    # 让 main 认为"运行开始于 10 秒前"：预放的 discovered/raw 因此算本次产出，
    # 而 1 小时前的旧 pains 文件仍会被过滤——探测点直达 pains 阶段。
    real_now = time.time()
    monkeypatch.setattr(run_all.time, "time", lambda: real_now - 10)

    # 旧的 pains 文件（mtime 1 小时前）
    pains_dir = tmp_path / "data" / "pains"
    pains_dir.mkdir(parents=True, exist_ok=True)
    stale = pains_dir / "pains_old.json"
    stale.write_text("[]", encoding="utf-8")
    os.utime(stale, (time.time() - 3600,) * 2)

    # crawl 产出一条本次 raw（保证过了 crawl 检查）
    raw_dir = tmp_path / "data" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "bilibili_x.jsonl").write_text(
        '{"id":"1","platform":"bilibili","source_id":"s","content":"c"}\n', encoding="utf-8")

    monkeypatch.setattr(run_all, "run", lambda cmd: True)
    # 直接给到 crawl 产出，确保探测的是 pains 阶段而非 crawl 检查
    monkeypatch.setattr(run_all, "collect_raw_files",
                        lambda d, since=None: [raw_dir / "bilibili_x.jsonl"])

    class A:
        keyword = "测试词"
        platforms = ["bilibili"]
        limit = 1
        comments = 1

    with pytest.raises(SystemExit) as e:
        run_all.main(A())
    assert "本次" in str(e.value)


def test_run_failure_raises_systemexit(monkeypatch):
    """关键步骤失败即中止（fail-fast），而不是继续往下走"""
    monkeypatch.setattr(run_all.subprocess, "run",
                        lambda cmd, text=True: type("R", (), {"returncode": 1})())
    with pytest.raises(SystemExit):
        run_all.run(["python", "-c", "pass"])
