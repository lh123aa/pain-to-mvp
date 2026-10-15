---
id: SL-0001
type: solution
project: pain-to-mvp
title: 阶段4 #11校准闭环落地：calibration.py record/review（7660a67）
date: 2026-10-15
status: done
tags: [calibration]
links: []
confidence: medium
---

# 阶段4 #11校准闭环落地：calibration.py record/review（7660a67）

# 背景
OPEN_ISSUES #11（PRD §五）：抽检记录此前只有 2 条裸 JSONL、无格式契约、无回看工具，成功线"20 条可回看命中率"无机制支撑。

# 做法
`scripts/pipeline/calibration.py` 两命令（TDD，10 项测试，全量 153 passed）：
- `record`：格式契约 SCHEMA_FIELDS；fail-close（verdict 仅 real/fake、note 必填、同卡重复拒绝）；signals 自动从 data/cards/<id>.md 的"信号分布"行抽取
- `review`：总体命中率 + top3 口径（成功线）+ 信号级命中率（低命中信号 = pain_rules.SIGNALS 调权候选）；满 20 条提示达回看线；坏行跳过不崩溃

# 可复用要点
- 信号级命中率把"要不要调词表"从感觉变成数字：某信号在真卡出现率高 = 保留，在假卡出现率高 = 调权/删除候选
- record 拒绝重复 card_id：命中率统计最怕同卡重复计数，校验前置于写盘

# 验证
全量 pytest 153 passed（143 基线 + 10 新增）；真实数据冒烟：review 输出 2 条、真1假1、命中率 50%、进度 2/20；CLI 重复拒绝实测生效。

# 下一步
每轮 run_all 后 record top3（现 2/20）；满 20 条做首次规则回看。
