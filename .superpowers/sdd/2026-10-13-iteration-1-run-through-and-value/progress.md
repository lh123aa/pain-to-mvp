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

## Task 0: 待执行
