---
id: RK-0001
type: risk
project: pain-to-mvp
title: #27 apply_fixes canonical 覆盖工作区：改4文件必先同步 generators/fixes
date: 2026-10-15
status: open
tags: [apply-fixes,open-issues-27]
links: []
confidence: medium
---

# #27 apply_fixes canonical 覆盖工作区：改4文件必先同步 generators/fixes

# 背景/症状
`tests/test_apply_fixes_stays_idempotent_with_exec_report` 在测试内跑 `apply_fixes.py`，其 `main()` 末尾的 `copy_canonical_modules()` 用 `generators/fixes/*.py`（canonical 权威副本）**覆盖工作区** 4 个文件：`score_opportunity.py / export_card.py / cluster.py / mine_pain_points.py`。

# 代价
直接改工作区这 4 个文件而不同步 canonical → 跑全量测试时改动被静默回退 → 假绿。2026-10-15 已实际踩中：#21 改 `_heuristic_scores` 返回值后，`fix_scoring` 的 marker `'competition': None,` 丢失 → apply_fixes 抛"未找到锚点"（b229b7b 修：改锚 `'reach': None`）。

# 缓解（现行）
- 必查清单已写入 OPEN_ISSUES #27：改上述 4 文件必须**先同步 `generators/fixes/` 再跑全量测试**
- marker 设计原则（本次新认知）：模板态必须缺席（补丁才能生效）、当前工作区必须命中（幂等跳过）、canonical 兜底最终态

# 长期解（未做）
测试改用临时目录跑 apply_fixes，不污染工作区。

# 证据
OPEN_ISSUES #27；CHANGELOG 0.3.0 Fixed 两条；commit b229b7b。

# 下一步
暂按缓解执行；排到工程待办，与 #16（marker 偏通用）同批处理。
