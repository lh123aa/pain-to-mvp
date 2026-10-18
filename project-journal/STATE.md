# STATE . pain-to-mvp 痛点→MVP机会发现管线

> 由 journal.py 自动生成（2026-10-18T13:40:36），**手工修改会被下次刷新覆盖**。
> 记录根目录：E:/程序/github/my-projects/MVP/pain-to-mvp/project-journal
> 契约 PROTOCOL.md . 目录 INDEX.md . 宪章 CHARTER.md . 待办 NEXT-ACTIONS.md

## 驾驶舱

| 项目 | 值 |
|---|---|
| 阶段 | **S2 构建** |
| 阶段轨迹 | S2(2026-10-15) |
| 起始 | 2026-10-15（第 4 天） |
| 最后记录 | 2026-10-18（今天） |
| 终局 | 进行中 |
| 条目总量 | 日记 54 条 . 档案 17 份 . 指标 26 行 . 收支 0 行 |

> 成功线 / 止损线见 CHARTER.md -- **成败以此为准，不以感觉为准**。

## 关键数字（最新）

| 指标 | 值 | 单位 | 日期 | 来源 | 置信度 |
|---|---|---|---|---|---|
| tests_passed | 238 |  | 2026-10-18 | pytest -q 全量（0644e38 提交时） | medium |
| calibration_records | 8 |  | 2026-10-16 | calibration.py | high |
| open_issues | 1 |  | 2026-10-15 | - | medium |
| a5_top3_hit_rate | 66.7 |  | 2026-10-16 | calibration.review | high |
| a4_post_fix_passes | 2 |  | 2026-10-16 | e2e_test | high |
| a4_runs_current_code | 3 |  | 2026-10-16 | e2e_test | high |

- _尚无收支记录。_

## 未闭环问题（1）

- PB-0001 v_voucher 二次拦截（10-17 10:00 直播没人看轮）：fail-close 生产实证 EXIT=1（2026-10-17 . open）

## 开放风险（1）

- RK-0001 #27 apply_fixes canonical 覆盖工作区：改4文件必先同步 generators/fixes

## 最近条目

- 2026-10-18 13:40 [T] 工作区清理：5 个一次性调试文件挪临时目录 + .gitignore 防再犯 + docs/research 入库
- 2026-10-18 13:17 [M] tests_passed = 238
- 2026-10-18 12:41 [T] 归档实跑：221 移 39 复 51 待认领，10 项目夹归位，幂等验证通过
- 2026-10-18 13:23 [R] 「直播没人看」跨天重试第 1 次：v_voucher 仍拦截（第 4 次生产实证）
- 2026-10-18 13:17 [M] 指标：测试基线 238 全绿（原 222 基线 + 归档 16 + mock 化 1 + 其他 0）
- 2026-10-18 13:15 [P] test_run_inputs mock 化漏打网络路径：patch 对象是 scripts.pipeline.* 独立模块
- 2026-10-18 12:47 [T] 归档实跑完成：移动 221 / 复制 39 / 跳过 61 / 无归属 51 入 `_待认领/`
- 2026-10-18 12:39 [T] 归档功能完成：读者改造+e2e 接线+overlay+SKILL.md，47 定向绿
- 2026-10-17 14:15 [T] 进度存档：每项目归档 organizer 模块+10 测试 GREEN，剩余读者/e2e接线/SKILL/实跑
- 2026-10-17 13:50 [I] v_voucher 冷却 3h44m 仍拦：今日 0/2 停手，下次跨天（修正 10-16 乐观样本外推）  IN-0002

## 下一步（来自 NEXT-ACTIONS.md）

- **P6 第三轮终验：A4 补样**：留档已落（`docs/acceptance-2026-10-16.md`：A1/A2/A3 ✅、A5 两轮达标、A6 pending）；A4 **只认当前代码窗口**（f9a11ad 后 3/10，需跨天降频补 ≥7 轮满窗 10 次 ≥9 终判；全历史 7/9 含旧代码样本不凑数）
- 校准记录累计：每轮 record top3（现 8/20，总体 62.5%、top3 66.7%；满 20 条首次回看——求助 67%/期望 67% 为调权候选；成功线 top3 ≥70%）；稳定性重跑的同簇副本不入校准（防灌水，2026-10-16 决策）
- A4 高频补跑受 v_voucher 风控约束（**10-17 两次拦截 10:00/13:44 + 10-18 13:23 跨天重试仍拦截**（~24h 冷却假设证伪）；今日 10-18 discover 停手；**明晨 10-19 上午**（距 10-17 13:44 >46h）再试，或用户扫码配 BILI_SESSDATA（脚本 `C:\Users\49046\AppData\Local\Temp\opencode\set_sessdata.py`，10 分钟窗口）；fail-close 生产实证 4 次从未假成功）
- #19 CI 验证：**已推送 GitHub**（2026-10-16，lh123aa/pain-to-mvp，远端 master=f9c0ac8）——待 Actions 首跑绿勾销账：https://github.com/lh123aa/pain-to-mvp/actions
- A6 卡片驱动实际动作：只能由用户执行（候选：20261016-001 S 档 112 条证据卡）
- 阶段 6 工程收尾：#18 合并 master、#19 CI、#27 canonical 长期解（测试用临时目录）
