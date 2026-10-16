# STATE . pain-to-mvp 痛点→MVP机会发现管线

> 由 journal.py 自动生成（2026-10-16T11:10:55），**手工修改会被下次刷新覆盖**。
> 记录根目录：E:/程序/github/my-projects/MVP/pain-to-mvp/project-journal
> 契约 PROTOCOL.md . 目录 INDEX.md . 宪章 CHARTER.md . 待办 NEXT-ACTIONS.md

## 驾驶舱

| 项目 | 值 |
|---|---|
| 阶段 | **S2 构建** |
| 阶段轨迹 | S2(2026-10-15) |
| 起始 | 2026-10-15（第 2 天） |
| 最后记录 | 2026-10-16（今天） |
| 终局 | 进行中 |
| 条目总量 | 日记 34 条 . 档案 13 份 . 指标 20 行 . 收支 0 行 |

> 成功线 / 止损线见 CHARTER.md -- **成败以此为准，不以感觉为准**。

## 关键数字（最新）

| 指标 | 值 | 单位 | 日期 | 来源 | 置信度 |
|---|---|---|---|---|---|
| tests_passed | 205 |  | 2026-10-16 | - | medium |
| calibration_records | 7 |  | 2026-10-16 | - | medium |
| open_issues | 1 |  | 2026-10-15 | - | medium |
| a5_top3_hit_rate | 60 |  | 2026-10-16 | - | medium |

- _尚无收支记录。_

## 未闭环问题（0）

_无。_

## 开放风险（1）

- RK-0001 #27 apply_fixes canonical 覆盖工作区：改4文件必先同步 generators/fixes

## 最近条目

- 2026-10-16 11:10 [M] a5_top3_hit_rate = 60
- 2026-10-16 11:10 [M] calibration_records = 7
- 2026-10-16 11:10 [M] tests_passed = 205
- 2026-10-16 11:10 [MS] A5针对性修复#29+第二轮重验：出2卡跳过极小簇，抽检2/2=100%本轮达标  MS-0006
- 2026-10-15 17:00 [M] a5_top3_hit_rate = 33
- 2026-10-15 17:00 [M] calibration_records = 5
- 2026-10-15 17:00 [M] tests_passed = 195
- 2026-10-15 17:00 [MS] P6重验首轮：A5=33%未过（top1真/top2-3假）+ 修复#28 discover fail-close + 风控阻塞A3/A4  MS-0005
- 2026-10-15 16:20 [M] open_issues = 1
- 2026-10-15 16:20 [M] tests_passed = 188

## 下一步（来自 NEXT-ACTIONS.md）

- **P6 重验第三轮（全新爬取）**：A5 第二轮达标（2/2=100%）但复用旧 raw 且 n=2——等风控解除后跑一轮**全新关键词爬取**做终验，同时补 A3/A4 稳定性（10 次 ≥9 或风控允许下的多次）
- 校准记录累计：每轮 run_all 后 record top3（现 7/20，满 20 条做首次规则回看——信号级命中率已见求助/期望 60% 为调权候选；成功线 top3 ≥70%，现 60%）
- 推 GitHub：remote 就绪后 `git push -u origin master`（CI test.yml 即生效）
- A3/A4 重跑：B站 v_voucher IP 风控解除（降频/隔天，或用户提供 BILI_SESSDATA 进 .env）
- #19 CI 验证：需推 GitHub 后首次 push/PR 才能观察绿勾（文件已就绪）
- A6 卡片驱动实际动作：只能由用户执行（候选：20261016-001 S 档 112 条证据卡）
- 阶段 6 工程收尾：#18 合并 master、#19 CI、#27 canonical 长期解（测试用临时目录）
