---
id: SL-0002
type: solution
project: pain-to-mvp
title: 阶段5 P2三项闭环：状态机#9/.env#10/topics#22（9ba0c6f）
date: 2026-10-15
status: done
tags: [p2,prD]
links: []
confidence: medium
---

# 阶段5 P2三项闭环：状态机#9/.env#10/topics#22（9ba0c6f）

# 背景
看板阶段 5：P2 批量清账（#9/#10/#22 三项，PRD 决策遗留的接线与校验缺口）。

# 三项与做法
1. **#9 dashboard 状态机**（PRD §6.1）：`update_progress.py` 重写——六阶段单向流转（pending→…→done）+ dropped 终态；`check_transition()` 纯函数校验（非法状态/回退/终态流转拒绝且不写盘）；progress 只增不减（max 保护）；schema_version 顶层写入；旧枚举（discovered/analyzing/mvp_design/validating/completed/in_progress）加载时经 LEGACY_STATUS 迁移，历史文件不改写、保存时归一；CLI 失败退出码 1。
2. **#10 .env 接线**（PRD §七）：`env_loader.py` load_env()（dotenv、override=False 环境优先、缺文件/缺依赖 fail-safe）；接线点选在 `pipeline/__init__.py`——所有 CLI 入口都带 UTF-8 稳定化块 `from pipeline.encoding import ...`，必经包导入 = 零接线覆盖全入口，不用逐文件改。
3. **#22 --topics 透传**：run_all mine 步骤加 `--topics`（getattr 兜底旧调用方无 topics 属性），未给参数行为不变。

# 决策与取舍
- 状态机拒绝策略 = "拒绝且不写盘"（返回 False + CLI 退出码 1），不是警告后继续——PRD "不许骗人"底线。
- 旧数据迁移选"加载时映射、保存时归一"而非改写历史文件（与 journal append-only 同哲学）。
- discovered → designing 映射：卡片导出即 MVP 方案已设计（pipeline 终点），语义最贴近。

# 验证
全量 pytest 167 passed（161 → 167：test_dashboard_state 8 + test_env_loader 3 + test_topics_wiring 3；161 = 153 + 状态机 8）。文档同步：CHANGELOG 0.3.1、OPEN_ISSUES #9/#10/#22 移入已闭环、USAGE §五"计划"改"已接线"、update_progress 示例状态改枚举内值。

# 下一步
P2 剩余 9 项（#12-#15、#23-#26），非阻塞按需清。
