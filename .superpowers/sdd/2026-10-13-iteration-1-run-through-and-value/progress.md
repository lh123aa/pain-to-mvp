# SDD ledger — plan: docs/superpowers/plans/2026-10-13-iteration-1-run-through-and-value.md

执行方式：原生执行（用户既定选择）。分支：feat/prospecting-fixes。

## Pre-flight: 共享接口扫描
- Row 1: Task 7（pains 新增 pain_summary）消费 Task 6（representative 已过滤噪音）的产出——Task 7 的"最佳代表句"取自过滤后的 representative，顺序依赖成立，无冲突。
- Row 2: Task 8（score 惩罚后 total_score/tier）→ Task 4（export 容错 scores）消费同一条目，字段名不变，无冲突。
- Row 3: Task 5（data/ 移出 git 索引）可能影响 conftest 的 hermetic 快照 fixture（I3 修复用 git 还原 data/）→ Task 5 Step 2 强制跑全量 pytest 验证。
- Row 4: Task 2（robots fail-close）→ Task 10（真实复验）依赖 B站主路径可用；若被拦按计划停下报告。
- Row 5: 全部 pipeline 修改需同步进生成器模板或 apply_fixes overlay（Global Constraint）；Task 9 全周期终验兜底。

## 计划缺陷处置
- （无）

## Task 0: complete (commit f4ff2be — docs checkpoint: PRD/验收/计划 14 files)

## Task 1: complete (commits f4ff2be..4ff77f5, tests: python -m pytest tests/ → 35 passed)
- run_all.py：模块级 import（修 #21 UnboundLocalError）+ run() fail-fast SystemExit + discovered/pains/scored 三处 mtime 本次过滤（#3）+ 四个"未找到"分支全部 SystemExit
- overlay：新增 fix_run_all_failfast（5 个补丁，排在 fix_safe_filename_wiring 之后）；幂等测试绿、重跑零改动
- Task 1 Ruling: 测试初版 patch run_all.run 导致 fail-fast 逻辑绕过（run 本身是被测对象）→ 下沉到 patch subprocess.run；"未找到"分支从静默 return 改为 SystemExit（管道/CI 必须拿到非零退出码）— 成本：run.sh 有 || true 不受影响
- Task 1 Ruling: test_main_ignores_stale_pains_file 探测深度不足（预放文件会被 discovered 阶段先过滤）→ monkeypatch time 前移 10s，确保探测点直达 pains 阶段 — 成本：无

## Task 2: complete (commits 4ff77f5..a7156c8, tests: python -m pytest tests/ → 38 passed)
- compliance.check_robots except 分支：allow_all=True → disallow_all=True（fail-close）+ 失败结果进缓存
- 实测（计划 Step 4b）：fail-close 生效下 e2e 真实链路 6/6 通过（B站 robots 可达且允许所爬路径）——无需触发"停下报告"分支
- overlay：fix_compliance_failclose 注册于 fix_run_all_failfast 之后

## Task 3: 待执行
