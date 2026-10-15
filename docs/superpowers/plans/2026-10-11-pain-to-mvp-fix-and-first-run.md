# Pain-to-MVP 修复与首跑 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MVP.md 里的生成器落地为真实项目，修掉让"探矿链路"不可信的 P0/P1 问题，并用一次 B站真实关键词跑端到端验收。

**Architecture:** 修复遵循"改生成器、重新生成"的单一事实源原则——所有对生成产物的修改要么通过补丁脚本、要么直接改生成器内容，保证可复现。核心修复四块：UTF-8 入口稳定化、B站 WBI 签名+游标分页、raw 文件全量合并去重、评分去伪。平台适配器接口（`BaseAdapter`）和存储层（`storage.save_records`）保持不变。

**Tech Stack:** Python 3.12、requests、pytest（新增 dev 依赖）、sqlite3 标准库。不引入 bilibili-api-python（WBI 签名手写约 60 行、可单测、零新依赖）。

**Spec:** `docs/superpowers/specs/2026-10-11-pain-to-mvp-prospecting-tool-design.md`

## Global Constraints

- 项目根：`MVP/pain-to-mvp/`（所有相对路径以此为根）
- Windows/win32 为第一运行环境；所有入口脚本必须能在 `PYTHONIOENCODING=cp936` 下不崩
- 禁止在修复中引入新的第三方依赖（pytest 仅作 dev 依赖）
- 所有脚本输出保持中文+emoji 风格（用户偏好），编码问题用代码解决而非删 emoji
- 生成器脚本视为源：`generators/generate_p0.py` ~ `generate_p6.py`

## Review Focus

以下输入/条件是 Spec 暗示但任务测试容易忽略、实际使用最可能咬人的：

1. **B站风控/无网络时**：discover 失败必须记录 bug 并继续其他平台，不是崩溃、不是静默跳过 → Task 3 测试：mock session 抛异常 → adapter 记录后返回空，上层继续
2. **评论数为 0 或极少**：mine_pain_points 输入空列表必须返回空结果而非 IndexError → Task 4 测试
3. **关键词含路径非法字符（如 `/`）**：输出文件名必须净化或给出清晰错误，不是 traceback → Task 4 测试（`safe_filename`）
4. **非 UTF-8 stdout（cp936 控制台）**：所有入口脚本 emoji 输出不崩 → Task 2 测试（PYTHONIOENCODING=cp936 子进程）
5. **修复补丁对已生成代码的二次生成**：重新运行生成器后修复仍在（幂等性）→ Task 1/2 验证步骤：重跑生成 + 修复仍生效

---

### Task 1: 项目落地与测试脚手架

**Files:**
- Create: `generators/extract_generators.py`（从 MVP.md 提取 7 个生成器）
- Create: `requirements-dev.txt`
- Create: `pytest.ini`
- Generate: `scripts/`、`references/`、`assets/`、`data/`、`README.md` 等（由 generate_p0~p6 产出）

**Interfaces:**
- Produces: 可运行的项目骨架；`python scripts/doctor.py` 退出码 0；`python scripts/demo.py` 退出码 0

- [ ] **Step 1: 写提取脚本并提取 7 个生成器**

`extract_generators.py`：读 `../MVP.md`，按 ```python 围栏切块，保留含 `FILES[` 且含 `def generate()` 的块，按出现顺序写为 `generators/generate_p0.py` … `generate_p6.py`。运行后断言 7 个文件均存在且每个含 `"generate"`。

- [ ] **Step 2: 依序生成项目**

```bash
cd pain-to-mvp
for i in 0 1 2 3 4 5 6; do python generators/generate_p$i.py; done
```
Expected: 每个生成器输出 ✅ 列表，无 traceback。

- [ ] **Step 3: 初始化 pytest 脚手架**

`requirements-dev.txt` 内容 `pytest>=8.0`；`pytest.ini` 内容：`[pytest] testpaths = tests python_files = test_*.py`。

- [ ] **Step 4: 验证离线主干**

Run: `python scripts/doctor.py && python scripts/demo.py`
Expected: doctor 输出 "✅ 系统健康"；demo 输出 "🎉 演示完成！" 且 `data/cards/` 下生成 ≥1 个 `.md`。

- [ ] **Step 5: git 初始化并提交**

```bash
git init && git add -A && git commit -m "chore: generate pain-to-mvp project from P0-P6"
```

---

### Task 2: 入口 UTF-8 稳定化

**Files:**
- Create: `scripts/pipeline/encoding.py`
- Create: `generators/fix_utf8.py`（幂等补丁：给所有入口脚本插入 ensure_utf8 调用）
- Test: `tests/test_encoding.py`

**Interfaces:**
- Produces: `ensure_utf8() -> None`（`reconfigure(encoding="utf-8")`，失败时静默降级）；被所有入口脚本调用

- [ ] **Step 1: 写失败的测试**

`tests/test_encoding.py`：
```python
import subprocess, sys, os
from pathlib import Path
ROOT = Path(__file__).parent.parent

def test_ensure_utf8_reconfigures():
    from scripts.pipeline.encoding import ensure_utf8
    ensure_utf8()
    assert sys.stdout.encoding.lower().replace("-", "") == "utf8"

def test_entry_survives_cp936():
    env = dict(os.environ); env["PYTHONIOENCODING"] = "cp936"
    r = subprocess.run([sys.executable, "scripts/doctor.py"], env=env,
                       capture_output=True, cwd=ROOT)
    assert r.returncode == 0, r.stderr.decode("utf8", "ignore")[:300]
```
（需 `tests/` 与 `scripts/` 均有 `__init__.py` 或 conftest 处理导入路径——在 pytest.ini 加 `pythonpath = .`）

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_encoding.py -v`
Expected: `test_entry_survives_cp936` FAIL（UnicodeEncodeError，rc=1）

- [ ] **Step 3: 实现 `scripts/pipeline/encoding.py`**

```python
def ensure_utf8() -> None:
    """把 stdout/stderr  reconfigure 为 UTF-8，防止 Windows cp936 控制台 emoji 崩溃。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass  # 老版本 Python 或已重定向流：降级忽略
```

- [ ] **Step 4: 写幂等补丁 `generators/fix_utf8.py` 并执行**

对 `scripts/**/*.py` 中含 `argparse` 或 `if __name__ == "__main__"` 的文件：在文件首个 import 段之后、模块主体之前插入：
```python
try:
    from pipeline.encoding import ensure_utf8  # noqa
    ensure_utf8()
except Exception:
    pass
```
插入点判定：文件中第一次出现的 `import argparse` 行的上方。补丁运行两次结果一致（幂等：已含 `ensure_utf8()` 则跳过）。

- [ ] **Step 5: 运行测试确认通过 + 复跑生成幂等验证**

Run: `python -m pytest tests/test_encoding.py -v`
Expected: 2 PASS。再 `python generators/generate_p0.py ... generate_p6.py` 重跑后重复 Step 4 补丁与测试，仍全 PASS（证明 Review Focus #5）。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "fix: UTF-8 stdout stable entry scripts for Windows cp936 console"
```

---

### Task 3: B站 WBI 签名 + 游标分页

**Files:**
- Create: `scripts/pipeline/wbi.py`
- Modify: `scripts/pipeline/adapters/bilibili.py`
- Test: `tests/test_wbi.py`

**Interfaces:**
- Produces: `get_mixin_key(img_key: str, sub_key: str) -> str`；`enc_wbi(params: dict, img_key: str, sub_key: str) -> dict`（返回带 `wts`/`w_rid` 的新 dict）；`BilibiliAdapter` 内部缓存 keys，`discover`/`crawl_comments` 全部签名；`crawl_comments` 用 `data.cursor.next` 翻页直到 limit 或无下一页
- Consumes: Task 1 的 `adapters.base.BaseAdapter`；`compliance.RateLimiter`

- [ ] **Step 1: 写失败的测试**

`tests/test_wbi.py`（全部离线）：
```python
from scripts.pipeline.wbi import get_mixin_key, enc_wbi

def test_mixin_key_deterministic():
    # 固定输入 → 固定 32 字符混合 key（对拍官方算法表）
    mk = get_mixin_key("7cd084941338484aae1ad9425b84077c", "4932ebaff29c73fa60ce326a3b7d5a7a")
    assert len(mk) == 32
    assert mk == get_mixin_key("7cd084941338484aae1ad9425b84077c", "4932ebaff29c73fa60ce326a3b7d5a7a")

def test_enc_wbi_sorted_and_adds_signature():
    signed = enc_wbi({"keyword": "test", "mid": 1}, "1" * 32, "2" * 32)
    assert "wts" in signed and "w_rid" in signed
    assert signed["w_rid"] == enc_wbi({"mid": 1, "keyword": "test"}, "1" * 32, "2" * 32)["w_rid"]  # 排序无关性

def test_discover_failure_does_not_break_pipeline(monkeypatch):
    # Review Focus #1：某平台全部风控失败时，discover 不崩、正常返回空/其他平台结果
    from scripts.pipeline import discover_content
    from scripts.pipeline.adapters.bilibili import BilibiliAdapter
    def boom(self, k, limit=20): raise RuntimeError("风控 -352")
    monkeypatch.setattr(BilibiliAdapter, "discover", boom)
    result = discover_content.discover("kw", ["bilibili"], 5)
    assert result == []
```
```
另写 `test_crawl_pagination_uses_cursor`：构造假 session（`requests.Session.get` 被替换为返回两页 JSON，第二页 cursor 为 `"0"`），`crawl_comments("123", limit=30)` 必须发出第二次请求且 `params["next"]` 取第一页返回的 cursor 值而非页码。

- [ ] **Step 2: 运行确认失败**

Run: `python -m pytest tests/test_wbi.py -v`
Expected: FAIL（`ModuleNotFoundError: wbi`）

- [ ] **Step 3: 实现 `scripts/pipeline/wbi.py`**

按 B站公开算法：`mixinKeyEncTab` 固定 64 位重排表；`get_mixin_key` 取 img+sub 顺序查表拼接取前 32 位；`enc_wbi` 加 `wts=time.time()` 整数，按键字典序排序后 urlencode，`md5(query + mixin_key)` 得 `w_rid`。

- [ ] **Step 4: 改造 `adapters/bilibili.py`**

- 新增 `_wbi_keys()`：请求 `https://api.bilibili.com/x/web-interface/nav` 取 `wbi_img.img_url`/`sub_url` 末段，内存缓存
- `discover`：改用 `https://api.bilibili.com/x/web-interface/wbi/search/type`，params 过 `enc_wbi`
- `crawl_comments`：params `{"type":1,"oid":aid,"mode":3,"ps":20}` + `enc_wbi`，从 `data.cursor.next` 取下一页游标；`next` 为 0/空时停。失败抛 RuntimeError 交由上层（Review Focus #1 由 crawl_one 现有 try/except 兜住，Task 3 补测试）

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/test_wbi.py -v`
Expected: 4 PASS（分页、排序无关、mixin key、风控不崩）

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat(bilibili): WBI signing and cursor pagination"
```

---

### Task 4: raw 全量合并去重与文件名安全

**Files:**
- Create: `scripts/pipeline/run_inputs.py`
- Modify: `scripts/pipeline/mine_pain_points.py`（`--inputs` nargs，默认 glob `data/raw/*.jsonl`）
- Modify: `scripts/pipeline/run_all.py`、`scripts/e2e_test.py`（改用 `collect_raw_files` + `merge_jsonl_records`）
- Test: `tests/test_run_inputs.py`

**Interfaces:**
- Produces: `collect_raw_files(raw_dir: Path) -> list[Path]`（按 mtime 排序的全部文件）；`merge_jsonl_records(paths: Sequence[Path]) -> list[dict]`（按 `(platform, source_id, id)` 去重，保持先到先得）；`safe_filename(name: str) -> str`（替换 `\/:*?"<>|` 为 `_`，截断 60 字符）
- Consumes: mine 的 `mine()` 扩一个 `inputs: list[Path] | None` 参数，行为同 `--input` 但多文件合并

- [ ] **Step 1: 写失败的测试**

`tests/test_run_inputs.py`：
```python
from pathlib import Path
from scripts.pipeline.run_inputs import merge_jsonl_records, safe_filename

def test_merge_dedups(tmp_path):
    a = tmp_path / "a.jsonl"; a.write_text('{"id":"1","platform":"bilibili","source_id":"s1"}\n')
    b = tmp_path / "b.jsonl"; b.write_text('{"id":"1","platform":"bilibili","source_id":"s1"}\n{"id":"2","platform":"bilibili","source_id":"s1"}\n')
    assert len(merge_jsonl_records([a, b])) == 2

def test_mine_empty_input_returns_empty(tmp_path):
    from scripts.pipeline import mine_pain_points
    assert mine_pain_points.mine(input_file=str(tmp_path / "empty.jsonl")) == []  # 需预先建空文件

def test_safe_filename():
    assert safe_filename('a/b:c*d?"<>|') == "a_b_c_d_____"

def test_collect_raw_files_returns_all(tmp_path):
    from scripts.pipeline.run_inputs import collect_raw_files
    for n in ("a.jsonl", "b.jsonl", "c.jsonl"):
        (tmp_path / n).write_text('{"id":"1","platform":"p","source_id":"s"}\n')
    assert len(collect_raw_files(tmp_path)) == 3
```

- [ ] **Step 2: 运行确认失败**

Run: `python -m pytest tests/test_run_inputs.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `scripts/pipeline/run_inputs.py`**

三个函数按 Interfaces 签名实现。`merge_jsonl_records` 逐行 json.loads，坏行跳过并计数，key 用 `(r.get("platform"), r.get("source_id"), r.get("id"))`；`safe_filename` 用正则替换非法字符。**同时给 `scripts/pipeline/cluster.py` 的 `cluster_comments` 加空输入守卫**：`if not texts: return []`（否则空输入会产出 size=0 的伪簇，Task 4 Step 1 的空输入测试永远红——ledger: Plan-fix 1）。

- [ ] **Step 4: 改造 mine / run_all / e2e_test**

- `mine_pain_points.py`：CLI 增 `--inputs`（nargs="+"）；`_load_input` 支持 inputs 列表走 `merge_jsonl_records`；输出 tag 用 `safe_filename(keyword or platform)`
- `run_all.py`：删 `raw_files[-1]`，改 `raw_files = collect_raw_files(Path("data/raw"))` 全量传给 mine
- `e2e_test.py`：同改；`latest()` 保留给 discovered/pains/scored 单文件场景

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/test_run_inputs.py -v`
Expected: 4 PASS

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "fix: merge all raw jsonl for mining (no silent data loss)"
```

---

### Task 5: 评分去伪与卡片可读性

**Files:**
- Modify: `scripts/pipeline/score_opportunity.py`
- Modify: `scripts/pipeline/export_card.py`
- Test: `tests/test_scoring.py`

**Interfaces:**
- Produces: `_heuristic_scores(pain) -> dict` 只含 `demand`、`feasibility`（其余为 `None`）；`_compose_total(scores) -> float` 仅对非 None 维度取均值×20；`format_title(quotes: list[str]) -> str`（首条去首尾标点截 30 字）
- Consumes: Task 1 生成的现有模块结构

- [ ] **Step 1: 写失败的测试**

`tests/test_scoring.py`：
```python
from scripts.pipeline.score_opportunity import _heuristic_scores, _compose_total

def test_heuristic_no_fabricated_dims():
    s = _heuristic_scores({"avg_pain": 6, "size": 20, "signal_distribution": {}})
    assert s["demand"] in (3, 4, 5) and 1 <= s["feasibility"] <= 5
    assert s["competition"] is None and s["reach"] is None and s["ai_leverage"] is None

def test_total_over_available_dims_only():
    assert _compose_total({"demand": 5, "feasibility": 4, "competition": None}) == 90.0

def test_format_title():
    from scripts.pipeline.export_card import format_title
    long_quote = "独立开发者半年了一分钱没赚到产品也没人用到底该不该继续坚持这个问题每天晚上都在脑子里转"
    title = format_title(["", long_quote])
    assert len(title) <= 31 and title.endswith("…")
    assert len(title) < len(long_quote)
```

- [ ] **Step 2: 运行确认失败**

Run: `python -m pytest tests/test_scoring.py -v`
Expected: FAIL（现签名返回 5 个恒定分；`_compose_total` 按 None 计算抛 TypeError；`format_title` 不存在）

- [ ] **Step 3: 改 `score_opportunity.py`**

`_heuristic_scores` 删 competition/reach/ai_leverage 的恒定赋值；`_compose_total` 只对 `scores[k] is not None` 的维度 `sum/n*20`；无任何维度时返回 0。LLM 路径不变（补齐 5 维时 clamp 逻辑保留）。

- [ ] **Step 4: 改 `export_card.py`**

标题改 `format_title`；评分表对 `None` 渲染 `—`；`scores` 缺键用 `.get()`。

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/test_scoring.py -v`
Expected: 3 PASS

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "fix: honest scoring (no fabricated dimensions) and readable card titles"
```

---

### Task 6: Dashboard 路径穿越修复

**Files:**
- Modify: `scripts/dashboard/serve.py`
- Test: `tests/test_serve_asset.py`

**Interfaces:**
- Produces: `resolve_asset(rel: str) -> Path | None`（归一化后必须在 `ASSETS` 内，否则 None）

- [ ] **Step 1: 写失败的测试**

`tests/test_serve_asset.py`：
```python
from scripts.dashboard.serve import resolve_asset
def test_traversal_rejected():
    assert resolve_asset("../MVP.md") is None
    assert resolve_asset("../../etc/passwd") is None
def test_normal_ok():
    assert resolve_asset("app.js") is not None
```
（serve.py 顶层不可执行网络启动——导入模块本身不启动服务，已满足）

- [ ] **Step 2: 运行确认失败**

Run: `python -m pytest tests/test_serve_asset.py -v`
Expected: FAIL（`ImportError: resolve_asset`）

- [ ] **Step 3: 实现 resolve_asset 并接入 do_GET**

`do_GET` 的静态分支改：`p = resolve_asset(rel); if p: self._send_file(p) else: self.send_error(403)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_serve_asset.py -v`
Expected: 2 PASS

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "fix(dashboard): path traversal guard for static assets"
```

---

### Task 7: 处置"假闭环"（自愈系统）

**Files:**
- Modify: `scripts/healing/heal_runner.py`
- Modify: `.github/workflows/self-heal.yml`
- Test: `tests/test_heal.py`

**Interfaces:**
- Produces: `heal()` 只读 bug 日志、分类、写报告 `data/bugs/heal-report.md`；`commit_and_push` 内部不再真实调用 git（保留函数签名，恒返回 False 并打印"已禁用自动推送"）

- [ ] **Step 1: 写失败的测试**

`tests/test_heal.py`：
```python
def test_heal_does_not_touch_git(tmp_path, monkeypatch):
    import scripts.healing.heal_runner as h
    calls = []
    monkeypatch.setattr(h.subprocess, "run", lambda *a, **k: calls.append(a) or None)
    h.heal()
    assert calls == []
```
+ `test_fixed_status_not_written_back`：跑 heal 后重新 load bugs，open bug 的 status 仍为 open（不撒谎）。

- [ ] **Step 2: 运行确认失败**

Run: `python -m pytest tests/test_heal.py -v`
Expected: FAIL（现实现 commit_and_push 会调 subprocess）

- [ ] **Step 3: 改 heal_runner.py**

删 `commit_and_push` 真实 git 调用（改为打日志返回 False）；`run_tests` 删除；heal 主流程改为：分类 → 生成 `heal-report.md`（含 bug、分类、建议）→ 不改 status。文件头注释标明"未接线的主流程系统，仅做诊断报告"。

- [ ] **Step 4: 改 self-heal.yml**

去掉 `schedule` 触发器，仅留 `workflow_dispatch`；删除 git commit/push step，改为上传 report 为 artifact。

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/test_heal.py -v`
Expected: 2 PASS

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "fix(healing): report-only mode, remove fake auto-fix and auto-push"
```

---

### Task 8: 端到端验收（真实数据）

**Files:**
- Create: `docs/superpowers/acceptance-2026-10-11.md`（验收记录）

**Interfaces:**
- Consumes: Task 2–7 全部产出

- [ ] **Step 1: 全量回归**

Run: `python -m pytest tests/ -v`
Expected: 全 PASS（约 16 个测试）

- [ ] **Step 2: 离线 demo 复验**

Run: `python scripts/demo.py`
Expected: 卡片生成；检查最重卡片评分只有 demand/feasibility 两维（无恒定假冒维度）

- [ ] **Step 3: B站真实发现（WBI 验证）**

Run: `python scripts/pipeline/discover_content.py --keyword "独立开发" --platforms bilibili --limit 10`
Expected: 拿到 ≥1 条候选（证明 WBI 修复生效；若被风控返回空，记录错误信息到验收文档，降级用 demo 数据继续后续步骤）

- [ ] **Step 4: 全流程真实跑（或 demo 数据降级）**

Run: `python scripts/e2e_test.py --keyword "独立开发" --platform bilibili --limit 10 --comments 100`
Expected: 6 步骤全 ✅；`data/cards/` 有新卡片

- [ ] **Step 5: 看板人工确认**

Run: `python scripts/dashboard/serve.py --port 8787`，浏览器开 `http://localhost:8787`，确认：统计卡数字、卡片可读标题、进度条、（可选）访问 `http://localhost:8787/../MVP.md` 返回 403/404。

- [ ] **Step 6: 填写验收记录并提交**

将每步真实输出（成功/失败、关键数字）写入 `docs/superpowers/acceptance-2026-10-11.md`：
```bash
git add -A && git commit -m "docs: end-to-end acceptance record"
```
