# NEXT-ACTIONS · 未完成事项

> 手工维护（脚本不会覆盖本文件）。`STATE.md` 会自动引用这里的未勾选项。
> 规则：只保留"下一步真的要做的"；已完成的勾掉或删除；空的分区保留标题即可，不要留空 checkbox。

## 进行中（按优先级）
- [ ] **交付规则（2026-10-20 用户指令）**：每次任务完成 → 先更新 `docs/PROGRESS.md`，回复末尾附「进度快照」（总进度 / 当前步骤 / 下一步）
- [ ] **升级执行（docs/UPGRADE-PLAN.md）**：T1/T2 ✅、T3 ✅、T4 ✅、T7 ✅（MCP 服务器 + 技能包，含真实 stdio 端到端）、T8 ✅（打印样式 + PDF 一键导出 8 份实测 + 演示版生成器）、T5 ◐（校准页 v1 建好，发布待校准复盘后）、T9 ✅（数据主权导出：打包/校验/恢复实测）——包 A 内除管线化外全部落地；管线化 T1b/T2b 待原机数据。**待用户补：服务页联系方式占位（微信/爱发电/邮箱）②发布决定（G0 后照 `docs/RELEASE-CHECKLIST.md` 执行）**
- [ ] **定价：首单用 ¥199 验证价**（前 3–5 单，换反馈+案例授权），成交价记 ledger；每 5 单按 PRICING-VALIDATION.md §4 复盘
- [x] 2026-10-18 **test_env_loader 隔离修复 + 全量 238 全绿确认**：`env_loader.load_env` 增加 `override` 参数；测试用 `delenv + override=True`；全量 238/0 通过；requirements-dev / Makefile test-unit 待提交
- [ ] **P6 第三轮终验：A4 补样**：留档已落（`docs/acceptance-2026-10-16.md`：A1/A2/A3 ✅、A5 两轮达标、A6 pending）；A4 **只认当前代码窗口**（f9a11ad 后 3/10，需跨天降频补 ≥7 轮满窗 10 次 ≥9 终判；全历史 7/9 含旧代码样本不凑数）
- [ ] 校准记录累计：每轮 record top3（现 8/20，总体 62.5%、top3 66.7%；满 20 条首次回看——求助 67%/期望 67% 为调权候选；成功线 top3 ≥70%）；稳定性重跑的同簇副本不入校准（防灌水，2026-10-16 决策）
- [x] 2026-10-18 **test_run_inputs mock 化 + requirements == 锁定已提交推送**（0644e38）：根因是 mock patch 对象错（scripts.pipeline.* 独立模块 vs adapters 包注册类，conftest 双 sys.path 双注册）；全量 **238 passed 全绿**；远端 master=0644e38

## 等待中（被外部阻塞）
- [ ] **零费用变现执行计划（10-18 定稿）：`docs/MONETIZATION-EXECUTION.md`**——4 阶段全程 ¥0；
  阶段 1 草案已备（4 份报告 md+html，未发布）；当前卡点 = 阶段 0（风控解锁）：
- [ ] A4 高频补跑受 v_voucher 风控约束（**10-17 两次拦截 + 10-18 13:23 跨天重试 + 10-18 15:06 扫码后重试仍拦截**（fail-close 生产实证 5 次从未假成功）；**10-18 15:06 认知修正：v_voucher 是 IP 级风控，非 cookie 级**——扫码配 BILI_SESSDATA（已做，长度 222，nav 接口验证 login:True）过不了被标记 IP 的评论 API，真正出路 = 换 IP（等自然冷却 / 换网络出口），非换 cookie；**明晨 10-19 上午**（距 10-17 13:44 >46h）再试，期间不碰 discover（每次尝试都消耗风控额度延长冷却）；.env SESSDATA 保留，IP 解锁后立即生效不用重扫
- [ ] #19 CI 验证：**已推送 GitHub**（2026-10-16，lh123aa/pain-to-mvp，远端 master=f9c0ac8）——待 Actions 首跑绿勾销账：https://github.com/lh123aa/pain-to-mvp/actions
- [ ] A6 卡片驱动实际动作：只能由用户执行（候选：20261016-001 S 档 112 条证据卡）
- [x] **软传播素材（2026-10-20 已发布）**：B站专栏 ✅ https://www.bilibili.com/opus/1261197853541269508 ｜ 知乎回答 ✅ https://www.zhihu.com/question/306778682/answer/2095916123820668030 —— 零外链/零价格；台账见 `marketing/PUBLISHED.md`
- [ ] **发布后 24h 跟踪（B站/知乎）**：只回评论不追发；记录阅读/赞同/评论/私信；7 天 0 反馈 → 阶段 2 止损换渠道（截止 10-26）
- [ ] **爱发电发布（2026-10-19 路线 A 已执行）**：2 条公开动态已发（[p/0dfe0652…](https://afdian.com/p/0dfe0652cbd211f1b40252540025c377) / [p/372960d0…](https://afdian.com/p/372960d0cbd211f18e3a52540025c377)）；P1 联系方式已回填；**创作者认证已提交（2026-10-20，审核中 2 工作日）**；**待用户：绑手机（当前受阻，提现前处理）**；**待 G0 复盘后：按 `docs/afdian-launch-kit.md` §2 上架 4 个 SKU**

## 已完成（本周期，保留 2 周便于复盘）
- [x] 2026-10-19 **定价验证 + 升级方案 + 报告资产升级**：`docs/PRICING-VALIDATION.md`（阶梯 v1：免费/199/499/999+，首单验证价 199）+ `docs/UPGRADE-PLAN.md`（T1–T11 任务卡+监督机制）；4 份公开报告+深度交付版新增 WTP+缺口模块（存量证据，无编造）；`generate_reports_html.py` 行内加粗/h3/引语判定升级；238 全绿
- [x] 2026-10-17 **变现策略初稿入库**：`docs/MONETIZATION.md`（9779aca 已推）——验收报告盘点确认已含 4 份；变现策略从"一句话假设"补成文（候选形态/验证顺序/合规前提/报告索引，定价待确认不编造）
- [x] 2026-10-16 **推 GitHub**：`lh123aa/pain-to-mvp`（Private），remote origin 就绪，master=f9c0ac8 已推平；test.yml 随 push 触发（绿勾观察中）
- [x] 2026-10-16 **#30/#31 双缺陷发现即修**：A4 第 2 轮实锤 e2e 假成功退出码（断链仍 exit 0）+ #20 跨轮去重 × since 过滤断链（0 新写入→误判无数据）；crawl 本轮清单 + collect 新鲜回退 + _report 布尔传播；17 新测试 RED→GREEN，222 passed，清单回退生产实证（0 新写入轮 6/6 步 50.0s），f9a11ad，MS-0007
- [x] 2026-10-16 **A5 针对性修复 #29 + 第二轮重验**：描述句强信号 only + 极小簇(<5)不出卡；重跑出 2 卡 + 跳过日志，抽检 2/2=100%（本轮达标），累计 top3 60%，205 passed，MS-0006，2efd912
- [x] 2026-10-15 P6 重验首轮：A2 ✅ / A3-A4 风控阻塞 pending / A5=33% 未过；顺带发现并修复 #28 discover fail-close（195 passed，c67b0d9，MS-0005）
- [x] 2026-10-15 阶段 6 工程收尾：#19 CI test.yml + #27 回退陷阱长期解（workspace_clone 副本隔离 + canonical 4 字节断言护栏，188 passed，SL-0003，162b6be）
- [x] 2026-10-15 **#18 合并 master**：feat/prospecting-fixes → master（3c214be --no-ff，50 提交，0.3.0/0.3.1/0.3.2 全部成果进入主线，MS-0004）
- [x] 2026-10-15 阶段 6 前置：P3 #16/#17 清零 + 真实数据全链验证（1124 条迁移零丢失 / 卡片续号 / 置信度上卡 / 主导信号正确，187 passed，MS-0003）
- [x] 2026-10-15 阶段 5 全部清账：P2 剩余 8 项 #12-#15/#23-#26（048a6f9 / 36d5b32 / 95e11a6 / c67052d，**184 passed**，OPEN_ISSUES P2 表清零）
- [x] 2026-10-15 阶段 5 首批：#9 状态机 + #10 .env 接线 + #22 topics 透传（9ba0c6f，167 passed）
- [x] 2026-10-15 阶段 4：#11 校准闭环机制落地（calibration.py record/review，7660a67，153 passed；记录累计是持续动作非阻塞）
- [x] 2026-10-15 建立项目记录目录（BOOTSTRAP：CHARTER 三标尺 + 锚点 + 首批 6 档案）
- [x] 2026-10-15 阶段 3：#21 证据驱动评分维度方向 A 收窄版（b229b7b / 1687931，143 passed）
- [x] 2026-10-15 阶段 2：#20 crawl comment_id 跨 run 去重（50e491e / f8535f9）
- [x] 2026-10-14~15 阶段 1：P0 域校验三层防线（7893441 → cc69f0f，真实数据验证）

## 想法池（尚未决定要不要做）
- [ ] **变现路径裁决（2026-10-19 两份评估已出）**：读 `docs/MONETIZATION-5Q-ASSESSMENT.md`（五问·价值真相，加权 5.7/10）与 `docs/WEB-MONETIZATION-ASSESSMENT.md`（网页路线）——建议 G1 = 报告站 + 服务单先行（网页不做在线跑批）；在「服务优先 / 报告站 / 工具授权 / 维持 MONETIZATION-EXECUTION 原序」中拍板；定价基线已出：`docs/PRICING-VALIDATION.md`（10-19）
- [ ] 阶段 6 工程收尾：#18 合并 master、#19 CI、#27 canonical 长期解（测试用临时目录）
