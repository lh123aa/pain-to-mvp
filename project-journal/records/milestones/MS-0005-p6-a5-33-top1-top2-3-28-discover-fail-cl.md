---
id: MS-0005
type: milestone
project: pain-to-mvp
title: P6重验首轮：A5=33%未过（top1真/top2-3假）+ 修复#28 discover fail-close + 风控阻塞A3/A4
date: 2026-10-15
status: done
tags: []
links: []
confidence: medium
---

# P6重验首轮：A5=33%未过（top1真/top2-3假）+ 修复#28 discover fail-close + 风控阻塞A3/A4

## 增量：P6 重验首轮（A5 数据出炉 + 发现并修复 #28 fail-close 缺口）

### 事实
- A2 离线 demo：6 步全过 ✅
- A3 真实链路：**被 B站 v_voucher 风控阻塞**（当天连跑多轮触发，IP 级）；系统行为正确——检测、明确报错、不绕过、记录 bug（bug-20261015-226e35）
- A5 抽检（15:46 修复后管线轮，top3）：引文 9/9 回溯命中 raw；判定 top1 真（S 档 85 分/112 条/置信 1.00）、top2 假（B 档段子当痛点描述）、top3 假（C 档 3 条全是杂谈）→ **top3 口径 33%，未达 70%**
- 校准记录 2/20 → **5/20**（calibration.jsonl）

### 问题与解法
- **#28**：v_voucher 风控时 discover 捕获异常后仍 exit 0 + 写空 [] 文件 → e2e Step 1 据 returncode 判 ✅ 假成功，失败被推到 crawl 步误报"未找到评论数据"。修复：零发现 `sys.exit(1)` 并点名失败/不可用平台；空文件照写防 latest() 复用旧产物；overlay patch `fix_discover_failclose`（5 段锚点）防 extract 回退
- 契约冲突：`test_wbi.py::test_discover_failure_does_not_break_pipeline` 旧断言"失败返回 [] 继续"正是被证伪的假成功路径——升级为断言 `SystemExit(非0)`，"不能崩"本意保留（不抛裸 RuntimeError）
- 测试自身 bug：`test_mixed_partial_success_not_blocked` 漏写 `monkeypatch.setattr` 行走了真实适配器（真实风控恰好也在报错，掩盖了 mock 缺失）

### A5 根因对比（10-13 vs 10-15）
- 10-13 失败模式：关键词堆叠标题、引文不可回溯、A 档高分假卡
- 10-15 失败模式：**top1 已是真卡且质量高**（引文可溯、置信度上卡、信号分布清晰）；失败集中在 B/C 小簇——痛点描述选取把段子（首条评论）当痛点陈述、极小簇（3 条）不该出可行动卡
- 修复方向（下轮候选）：① 痛点描述/代表句只从求助/期望类信号句选；② 极小簇（<5 条）不出卡或标注"证据不足勿行动"

### 决策
- P6 重验判定诚实化：本轮 A5 未过（33% < 70%），不粉饰；A3/A4 被外部风控阻塞标 pending，等降频/隔天或用户提供 BILI_SESSDATA

### 真实数字
- 测试 188 → **195 passed**（+7 fail-close 测试）
- commit c67b0d9
- 校准 5/20；top3 口径 1/3=33%（累计口径含 10-13 两卡）

### 认知更新
- "fail-close 缺口"往往不在被修的主链上，而在**错误传播的边界**：异常被 catch 后的默认行为（打印+继续）就是最大的假成功来源。检查清单应加一条：所有 `except` 块之后，失败是否仍能传到退出码
- 旧测试断言的"宽容契约"（失败返回空继续）可能是 bug 的共谋——测试红了先问"谁的契约错了"而不是"谁的实现错了"
