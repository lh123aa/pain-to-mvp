# STATE . pain-to-mvp 痛点→MVP机会发现管线

> 由 journal.py 自动生成（2026-10-22T18:55:04），**手工修改会被下次刷新覆盖**。
> 记录根目录：G:/程序/pain-to-mvp/project-journal
> 契约 PROTOCOL.md . 目录 INDEX.md . 宪章 CHARTER.md . 待办 NEXT-ACTIONS.md

## 驾驶舱

| 项目 | 值 |
|---|---|
| 阶段 | **S2 构建** |
| 阶段轨迹 | S2(2026-10-15) |
| 起始 | 2026-10-15（第 8 天） |
| 最后记录 | 2026-10-22（今天） |
| 终局 | 进行中 |
| 条目总量 | 日记 104 条 . 档案 17 份 . 指标 48 行 . 收支 0 行 |

> 成功线 / 止损线见 CHARTER.md -- **成败以此为准，不以感觉为准**。

## 关键数字（最新）

| 指标 | 值 | 单位 | 日期 | 来源 | 置信度 |
|---|---|---|---|---|---|
| tests_passed | 272 | count | 2026-10-21 | pytest -q 2026-10-21 | high |
| calibration_records | 8 |  | 2026-10-16 | calibration.py | high |
| open_issues | 1 |  | 2026-10-15 | - | medium |
| a5_top3_hit_rate | 66.7 |  | 2026-10-16 | calibration.review | high |
| a4_post_fix_passes | 2 |  | 2026-10-16 | e2e_test | high |
| a4_runs_current_code | 3 |  | 2026-10-16 | e2e_test | high |
| clonerepo_tests_passed | 238 | count | 2026-10-19 | 外机克隆 PYTHONUTF8=1 pytest 全量 | high |
| content_posts_published | 3 | count | 2026-10-21 | 爱发电/B站/知乎 | high |
| content_interactions | 0 | count | 2026-10-22 | 三平台巡检 | high |
| day1_interactions | 0 | count | 2026-10-21 | B站/知乎/爱发电 15:17 巡检 | high |
| afdian_profile_visits | 32 | count | 2026-10-22 | 爱发电 dashboard | high |
| zhihu_answer_collapsed | 1 | count | 2026-10-22 | 知乎回答页 | high |
| bili_login_ok | 0 | bool | 2026-10-22 | B站 nav API | high |
| zhihu_answer_reads | 12 | count | 2026-10-22 | 知乎创作中心 | high |
| zhihu_pin_views | 3 | count | 2026-10-22 | 知乎创作中心 | high |
| business_dms | 0 | count | 2026-10-22 | 知乎/爱发电私信 | high |
| afdian_profile_visitors | 16 | count | 2026-10-22 | 爱发电 dashboard | high |

- _尚无收支记录。_

## 未闭环问题（1）

- PB-0001 v_voucher 二次拦截（10-17 10:00 直播没人看轮）：fail-close 生产实证 EXIT=1（2026-10-17 . open）

## 开放风险（1）

- RK-0001 #27 apply_fixes canonical 覆盖工作区：改4文件必先同步 generators/fixes

## 最近条目

- 2026-10-22 18:53 [M] afdian_profile_visitors = 16 count
- 2026-10-22 18:52 [M] zhihu_answer_collapsed = 1 count
- 2026-10-22 18:52 [M] bili_login_ok = 0 bool
- 2026-10-22 18:52 [M] business_dms = 0 count
- 2026-10-22 18:52 [M] content_interactions = 0 count
- 2026-10-22 18:52 [M] afdian_profile_visits = 32 count
- 2026-10-22 18:52 [M] zhihu_pin_views = 3 count
- 2026-10-22 18:52 [M] zhihu_answer_reads = 12 count
- 2026-10-22 11:30 [T] GitHub 同步
- 2026-10-22 11:10 [T] 新增《变现路径与工作 SOP（总纲）》v1.0

## 下一步（来自 NEXT-ACTIONS.md）

- **交付规则（2026-10-20 用户指令）**：每次任务完成 → 先更新 `docs/PROGRESS.md`，回复末尾附「进度快照」（总进度 / 当前步骤 / 下一步）
- **每日内容引擎（10-21 起）**：按 `marketing/CONTENT-ENGINE.md` 每天 1 条微内容 + 每周 3 条长内容；Day1 已发 3 条（爱发电/B站/知乎）；**10-22～10-27 B站/知乎只发纯价值、0 CTA**；每日记 `project-journal/metrics/content.csv`
- **升级执行（docs/UPGRADE-PLAN.md）**：T1/T2 ✅、T3 ✅、T4 ✅、T7 ✅（MCP 服务器 + 技能包，含真实 stdio 端到端）、T8 ✅（打印样式 + PDF 一键导出 8 份实测 + 演示版生成器）、T5 ◐（校准页 v1 建好，发布待校准复盘后）、T9 ✅（数据主权导出：打包/校验/恢复实测）——包 A 内除管线化外全部落地；管线化 T1b/T2b 待原机数据。**待用户补：服务页联系方式占位（微信/爱发电/邮箱）②发布决定（G0 后照 `docs/RELEASE-CHECKLIST.md` 执行）**
- **定价：首单用 ¥199 验证价**（前 3–5 单，换反馈+案例授权），成交价记 ledger；每 5 单按 PRICING-VALIDATION.md §4 复盘
- **P6 第三轮终验：A4 补样**：留档已落（`docs/acceptance-2026-10-16.md`：A1/A2/A3 ✅、A5 两轮达标、A6 pending）；A4 **只认当前代码窗口**（f9a11ad 后 3/10，需跨天降频补 ≥7 轮满窗 10 次 ≥9 终判；全历史 7/9 含旧代码样本不凑数）
- 校准记录累计：每轮 record top3（现 8/20，总体 62.5%、top3 66.7%；满 20 条首次回看——求助 67%/期望 67% 为调权候选；成功线 top3 ≥70%）；稳定性重跑的同簇副本不入校准（防灌水，2026-10-16 决策）
- **零费用变现执行计划（10-18 定稿）：`docs/MONETIZATION-EXECUTION.md`**——4 阶段全程 ¥0；
- A4 高频补跑受 v_voucher 风控约束（**10-17 两次拦截 + 10-18 13:23 跨天重试 + 10-18 15:06 扫码后重试仍拦截**（fail-close 生产实证 5 次从未假成功）；**10-18 15:06 认知修正：v_voucher 是 IP 级风控，非 cookie 级**——扫码配 BILI_SESSDATA（已做，长度 222，nav 接口验证 login:True）过不了被标记 IP 的评论 API，真正出路 = 换 IP（等自然冷却 / 换网络出口），非换 cookie；**明晨 10-19 上午**（距 10-17 13:44 >46h）再试，期间不碰 discover（每次尝试都消耗风控额度延长冷却）；.env SESSDATA 保留，IP 解锁后立即生效不用重扫
- #19 CI 验证：**已推送 GitHub**（2026-10-16，lh123aa/pain-to-mvp，远端 master=f9c0ac8）——待 Actions 首跑绿勾销账：https://github.com/lh123aa/pain-to-mvp/actions
- A6 卡片驱动实际动作：只能由用户执行（候选：20261016-001 S 档 112 条证据卡）
- **发布后 24h 跟踪（B站/知乎）**：只回评论不追发；记录阅读/赞同/评论/私信；7 天 0 反馈 → 阶段 2 止损换渠道（截止 10-26）；**10-21 03:20 巡检：两平台均 0 评论/0 赞，无私信线索**；**10-21 07:40 Day1 三平台微内容已发，初始 0 互动（见 `content.csv`）**；**10-21 15:17 巡检：B站专栏 3 浏览、动态 0 互动；知乎想法 2 浏览/0 互动；知乎回答被折叠（AI 创作内容/community）；爱发电 31 次/15 人、0 评论/0 私信**；**10-21 16:10 B站登录态丢失（`isLogin:false`），评论未发出，暂停 B站自动化**
- **B站重新登录（叫用户）**：手动确认是否退出登录、是否有验证/警告；恢复前 B站只做只读巡检，不执行评论/发布/自动化
- **新增分发动作（每日 30 分钟）**：在 2–3 个目标人群聚集的 B站视频/知乎问题下留 1 条真实、具体、无链接的补充评论；B站暂停期间改到知乎/爱发电；只回真实问题，不刷量
- **V2EX / 小红书 / 即刻（待用户登录）**：B站登录丢失 + 知乎折叠后，优先试 V2EX「分享创造」/「程序员」节点；需用户提供账号或扫码登录；未登录前不占排期
- **爱发电发布（2026-10-19 路线 A 已执行）**：2 条公开动态已发（[p/0dfe0652…](https://afdian.com/p/0dfe0652cbd211f1b40252540025c377) / [p/372960d0…](https://afdian.com/p/372960d0cbd211f18e3a52540025c377)）；P1 联系方式已回填；**创作者认证已提交（2026-10-20，审核中 2 工作日）**；**待用户：绑手机（当前受阻，提现前处理）**；**待 G0 复盘后：按 `docs/afdian-launch-kit.md` §2 上架 4 个 SKU**
