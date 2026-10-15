# Iteration-1「跑通并出价值」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工具全部功能入口真实可用 + 产出可信率 ≥70% 的机会卡片（通过 P6 价值复验）。

**Architecture:** 在现有生成器+overlay 架构上修 9 项：1 个 P0 入口崩溃、4 项 P1 可靠性债、3 项卡片质量缺陷、1 项数据治理。所有代码修改必须同步进生成器模板或 `apply_fixes.py` overlay（重新生成不丢），每任务 TDD，最后全周期重生成终验 + 真实复验。

**Tech Stack:** Python 3.12 标准库为主（sklearn 聚类兜底），pytest。

**Spec:** `docs/PRD.md`（§二验收标准 / §四.1 fail-close / §五校准）+ `docs/OPEN_ISSUES.md`（#1-8、#21）+ `docs/acceptance-2026-10-13.md`（缺陷定位）

## Global Constraints

- 修改 `scripts/pipeline/*.py` 后必须同步进 `generators/generate_p*.py` 模板或 `generators/apply_fixes.py` overlay，且全周期终验（P0-P6 重生成 → apply_fixes → pytest 全绿）
- 所有新文件写入用 python/edit 工具，禁止 PowerShell Set-Content（UTF-16/BOM 教训）
- 补丁标记必须取自"新代码独有"文本（三次翻车教训）；`tests/test_apply_fixes_idempotent.py` 必须保持绿
- 合规红线：不绕验证码、不破解登录；fail-close 若实测封死 B站主路径 → **停下来报告用户**，不得擅自放行
- 分支：`feat/prospecting-fixes`；每任务一 commit；提交前 `python -m pytest tests/ -q` 全绿

## Review Focus（最可能咬人的五件事）

1. **fail-close 实测风险**：B站 robots.txt 内容未知，改后可能封死现役主链路 → Task 2 强制实测 e2e，被拦即停下报告
2. **补丁标记唯一性**：历史三次翻车 → 每个 overlay 补丁跑幂等测试
3. **重新生成覆盖**：Task 10 全周期终验必须重生成一遍验证修复仍在
4. **噪音过滤误杀**：过滤规则过强会把真求助句也滤掉 → 测试用真实样本句做双向断言（段子必须滤、真求助必须留）
5. **分数惩罚改历史**：小簇惩罚只影响新产出，验收报告需注明旧卡片分不可比

---

### Task 0: 检查点提交

**Files:** 无代码改动
**Steps:** `git add -A && git commit -m "docs: PRD 定稿 + 首轮验收报告 + 文档对齐实现"`；确认 `git status` clean。

### Task 1: run_all 一键入口修复（#21 崩溃 + #3 旧文件防护）

**Files:**
- Modify: `scripts/pipeline/run_all.py`
- Test: `tests/test_run_all.py`（新建）

**Interfaces:**
- Produces: `run_all.run(cmd) -> bool` 失败即 `SystemExit(1)`（关键步骤：discover/crawl/mine/score/mvp/export 全部关键）；`main(args)` 中 discover 失败直接中止；pains/scored 文件选取带 `since=run_started_at` mtime 过滤

- [ ] Step 1: 写失败测试：①`test_main_aborts_when_discover_fails`（patch `run`→False，断言 SystemExit 且不再 glob 旧文件，当前 RED: UnboundLocalError）②`test_main_ignores_stale_pains_file`（放一个旧 mtime pains 文件 + 本次无产出，断言报"未找到本次痛点结果"）③`test_module_imports_safe_filename`（import 后调用 main 不再 NameError）
- [ ] Step 2: 跑测试确认 RED（重现 UnboundLocalError）
- [ ] Step 3: 实现——`from run_inputs import collect_raw_files, safe_filename` 移到模块级；`run()` 失败 raise SystemExit；`run_started_at = time.time()` 置于 main 开头；pains/scored glob 加 `p.stat().st_mtime >= run_started_at`
- [ ] Step 4: 跑测试确认 GREEN + 全量 pytest 绿
- [ ] Step 5: 同步生成器/overlay（Task 10 统一终验，此处只在 apply_fixes 加 `fix_run_all_v2` 补丁并跑幂等测试）
- [ ] Step 6: Commit `fix(run_all): 一键入口 UnboundLocalError + fail-fast + 旧产物防护`

### Task 2: robots fail-close（#1）

**Files:**
- Modify: `scripts/pipeline/compliance.py:31-34`
- Test: `tests/test_compliance.py`（新建）

**Interfaces:**
- Produces: `check_robots(url)` 在 robots.txt 读取异常时返回 `False`（当前 `rp.allow_all = True`）

- [ ] Step 1: 失败测试：`test_robots_unreachable_denies`（patch `rp.read` 抛异常 → 断言返回 False；当前 RED 返回 True）
- [ ] Step 2: 确认 RED
- [ ] Step 3: 实现：except 分支 `rp.disallow_all = True`（robotparser 语义：`can_fetch` 返回 False）
- [Step 4]: GREEN
- [ ] Step 4b: **实测**：`python scripts/e2e_test.py --keyword "独立开发者" --platform bilibili --limit 5 --comments 30` —— 若 B站主路径被 robots 拦截 → **停止执行，向用户报告并等待决策**；若通过，记录实测结果
- [ ] Step 5: 同步 overlay + commit `feat(compliance): robots fail-close per PRD 4.1`

### Task 3: mine 单文件坏行保护（#2）

**Files:**
- Modify: `scripts/pipeline/mine_pain_points.py:41-47`（`_load_input` 单文件分支）
- Test: `tests/test_mine_badlines.py`（新建）

**Interfaces:**
- Produces: `_load_input(input_file=...)` 坏 JSON 行跳过 + `print("⚠️ 跳过坏行 N")`，不崩溃（与 `merge_jsonl_records` 行为一致）

- [ ] Step 1: 失败测试：临时 jsonl 写 2 好 1 坏，断言返回 2 条且不抛异常（当前 RED: JSONDecodeError）
- [ ] Step 2: RED → Step 3: 实现 try/except per line → Step 4: GREEN
- [ ] Step 5: overlay + commit

### Task 4: export KeyError + 死代码清理（#4）

**Files:**
- Modify: `scripts/pipeline/export_card.py:126-129,153`（`p["scores"]`→`p.get("scores") or {}`）
- Modify: `scripts/pipeline/score_opportunity.py`（`format_dim` 式 None 容错；清理死代码）
- Test: `tests/test_export_scores.py`（新建）

- [ ] Step 1: 失败测试：`test_export_tolerates_missing_scores`（scored 条目无 `scores` 键 → 导出不崩，维度渲染 `—`；当前 RED KeyError）
- [ ] Step 2: RED → Step 3: 实现（export 两处 `p["scores"]` 容错；`score()` 中无效维度已由 `_compose_total` 处理，确认无死代码残留）→ Step 4: GREEN
- [ ] Step 5: overlay + commit

### Task 5: data 移出 git 索引（#5）

**Files:** `.gitignore`（已改）；git 索引操作
- [ ] Step 1: `git rm -r --cached data/ pain_to_mvp.db`（保留磁盘文件）
- [ ] Step 2: 验证 `git status data/` clean；跑 pytest（conftest 快照 fixture 兼容确认）
- [ ] Step 3: Commit `chore: data 产物移出 git 索引（PRD 4.1）`

### Task 6: 代表句噪音过滤（#6）

**Files:**
- Modify: `scripts/pipeline/cluster.py`（新增 `_noise_score(text) -> int` 与代表句选取逻辑）
- Test: `tests/test_cluster_noise.py`（新建）

**Interfaces:**
- Produces: `cluster_comments(...)` 的 `representative`：仅从 `pain_signals` 非空的成员中按"信号数 desc、pain_score desc"选 top3；过滤规则：长度 <12 字、或"标签串"（≥3 个逗号分段且每段 ≤6 字）；过滤后为空则回退原逻辑

- [ ] Step 1: 失败测试（真实样本双向断言）：
  - `test_taglist_quote_filtered`：「独立开发，知识付费，跨境电商，差异化，独立开发出海」不得进 representative
  - `test_joke_deprioritized`：「超市菜价这么贵，菜农为啥不直接把菜送到超市呢」（无 pain_signals）不得排在有信号的真求助句「请问要如何自学…[笑哭]」之前
  - `test_real_help_kept`：「独立开发需要解决产品调研、营销、需求对接…除非你是个全才」（有信号、非标签串）必须保留
- [ ] Step 2: RED → Step 3: 实现 `_noise_score` + 选取逻辑 → Step 4: GREEN + demo/e2e 抽查 representative 质量
- [ ] Step 5: overlay（cluster.py 归属检查：生成器模板含原文则改模板）+ commit

### Task 7: 痛点摘要可读（#7）

**Files:**
- Modify: `scripts/pipeline/mine_pain_points.py`（pains 条目新增 `pain_summary`）
- Modify: `scripts/pipeline/export_card.py:123`（`description=p.get("pain_summary") or title`）
- Test: `tests/test_pain_summary.py`（新建）

**Interfaces:**
- Produces: pains 条目字段 `pain_summary: str` = `f"{size}条评论集中反映「{主信号}」：" + 最佳代表句（≤60字截断）`；export 消费同名字段

- [ ] Step 1: 失败测试：构造簇 → 断言 pains 输出含 `pain_summary` 且是完整句（含主信号与代表句）；export 的 description 使用 pain_summary
- [ ] Step 2: RED → Step 3: 实现（mine 汇总循环中生成；export 容错回退 title）→ Step 4: GREEN
- [ ] Step 5: overlay + commit

### Task 8: 小簇样本量置信惩罚（#8）

**Files:**
- Modify: `scripts/pipeline/score_opportunity.py`（`score()` 中 total 乘置信系数）
- Test: `tests/test_score_confidence.py`（新建）

**Interfaces:**
- Produces: `score()` 输出条目新增 `score_confidence: float`；`total_score = round(raw_total * min(1.0, 0.6 + 0.04 * size), 1)`（size=3→0.72，size≥10→1.0）；tier 在惩罚后判定

- [ ] Step 1: 失败测试：`test_small_cluster_penalized`（size=3、demand3/feas5：raw 80 → 惩罚后 57.6，tier 不得为 A）；`test_large_cluster_unaffected`（size≥10 分数不变）
- [ ] Step 2: RED → Step 3: 实现 → Step 4: GREEN
- [ ] Step 5: overlay + commit

### Task 9: 全周期重生成终验

- [ ] Step 1: `python generators/generate_p0.py` … `generate_p6.py` → `python generators/apply_fixes.py`
- [ ] Step 2: `python -m pytest tests/ -q` 全绿（预期 32 + 新增约 12 个）
- [ ] Step 3: `python scripts/demo.py` 出卡正常；若重生成打回任何修复 → 补 apply_fixes 断言标记 → 重跑直至绿
- [ ] Step 4: Commit（如产生 diff）

### Task 10: 真实复验（P6 重验）

- [ ] Step 1: e2e 连跑 3 次（`--keyword "独立开发者" --limit 10 --comments 100`）→ 3/3 完整出卡
- [ ] Step 2: A5 抽检 top3 卡片：引文回溯 + 真假判定 → 追加 `data/calibration/calibration.jsonl`；可信率 ≥70% 即通过
- [ ] Step 3: 写 `docs/acceptance-2026-10-13-v2.md`（对照 v1 的 50% 给出复验结果）
- [ ] Step 4: 更新 OPEN_ISSUES（关闭 #1-8、#21）+ CHANGELOG（0.2.0）+ Commit

### Task 11: 收尾

- [ ] Step 1: 汇报用户：复验结果 + A6（≥1 张卡驱动实际动作）留给用户执行
- [ ] Step 2: 建议合并 master（OPEN_ISSUES #18 前置条件此时已满足）
