# OPEN ISSUES — 技术债与风险登记

更新：2026-10-13 ｜ 策略（PRD §九）：**P6 重验前只清 P1**，其余按需。
来源：`docs/superpowers/ledger-2026-10-11-fix-and-first-run.md` 的 10 项 deferred minors + PRD 决策新增 + `docs/acceptance-2026-10-13.md` 验收发现。

---

## P1 — P6 重验前必须清（阻塞或污染验证结果）→ **iteration-1（2026-10-14）全部闭环，见各表状态列**

### 原有 5 项（2026-10-11 评审 deferred）

| # | 事项 | 完成标准 | 状态 |
|---|---|---|---|
| 1 | robots.txt fail-open → **fail-close**（读不到即跳过平台） | 单测：无 robots 时适配器拒绝爬取 | ✅ a7156c8 |
| 2 | mine 单文件分支 `json.loads` 无坏行保护（与 `--inputs` 行为不一致） | 坏行跳过+警告，测试覆盖 | ✅ 418fe9e |
| 3 | run_all discover 硬崩时可能取到上轮旧 discovered 文件 | discover 失败即终止，绝不读旧产物；测试覆盖 | ✅ 4ff77f5（mtime 过滤 + fail-fast） |
| 4 | export_card 直取 `p["scores"]` 旧格式裸 KeyError；score_opportunity WEIGHTS 死代码 | 缺字段明确报错（禁止裸 KeyError）；死代码清除 | ✅ eb0e491 |
| 5 | `data/` 产物 gitignore + 移出 git 索引 | `.gitignore` 已覆盖；`git rm --cached` 清索引后 `git status data/` clean | ✅ 6ef3670 |

### 2026-10-13 验收新发现 3 项（A5 可信率 50% < 70% 的直接原因）→ **2026-10-14 iteration-1 已闭环**

| # | 事项 | 完成标准 | 状态 |
|---|---|---|---|
| 6 | 代表原话含无关段子，无噪音过滤（"超市菜价""减了个寂寞"进了机会卡） | 代表句选取过滤离题评论；抽检 top3 不再出现段子引用 | ✅ `_is_noise` 噪音判定 + 代表句乘性打分（相似度×痛点加成）+ MMR 去冗余；`--topics` 主题聚焦过滤；A5 复检 top3 无段子（d3cb2c2/891a0ed/cdf150f） |
| 7 | 痛点描述/标题 = 关键词堆叠，不可读、无法据卡行动 | 痛点摘要用完整句子；标题可读 | ✅ mine 产出 `pain_summary`（"N条评论集中反映「信号」：代表句"）；卡片 description 优先级 pain_summary→title→quote（9a27ea6） |
| 8 | 小簇虚高：3 条评论得 80 分 A 档，证据强度与分数不符 | 评分对样本量加惩罚项；测试覆盖 | ✅ `_confidence_factor = min(1.0, 0.6+0.04*size)` 写入 `score_confidence`；3 条样本最多 6 折（d729e89） |

附带闭环（同批次）：跨视频重复评论文本级去重（891a0ed）；sklearn 环境损坏时纯 Python 兜底聚类（d3cb2c2）；T6-T10 修复落 `generators/fixes/` 权威副本防生成器重跑丢失（3b76a03）。

## P2 — 重验后尽快（不阻塞，影响长期质量）

| # | 事项 | 来源 | 完成标准 |
|---|---|---|---|
| 9 | `update_progress.py` / `dashboard.json` 落实 PRD §6.1 六阶段状态机 + `schema_version` + 单向流转校验 | PRD 决策（Q7） | 非法状态/回退被拒绝；schema_version 写入顶层 |
| 10 | python-dotenv 接线：代码统一从 `.env` 读凭证 | PRD 决策（Q8） | `.env` 可用，文档不再是"计划" |
| 11 | 评分校准闭环落地：抽检记录格式 + 回看脚本/流程（`data/calibration/` 已有 2 条真实记录） | PRD §五（Q6） | 抽检可记录、累计 20 条可回看命中率 |
| 12 | SQLite 主键仅 id 与 JSONL 去重键 (platform,source_id,id) 不一致，跨平台同 id 静默丢弃 | deferred | 主键/唯一键与去重键对齐 + 测试 |
| 13 | serve.py 不解码 %xx，含中文资源名 403 | deferred | 中文资源名可访问 + 测试 |
| 14 | daily-audit.yml 处置：仍定时跑且 auto commit&push，与「自优化不投入」决策冲突 | PRD §三（Q3） | 去定时改手动，或删除；二选一留记录 |
| 15 | heal_runner `load_bugs` 无坏行保护；subprocess 死导入 | deferred | 坏行跳过；死导入清除 |

## P3 — 有空再清（已有兜底，风险低）

| # | 事项 | 来源 | 完成标准 |
|---|---|---|---|
| 16 | apply_fixes `fix_run_all` 补丁 marker="import time" 偏通用（幂等测试已兜底） | deferred | marker 换成新代码独有文本 |
| 17 | mine tag 运算符优先级别扭（无害） | deferred | 加括号，语义不变 |

## 工程待办

| # | 事项 | 时机 |
|---|---|---|
| 18 | 合并 `feat/prospecting-fixes` → `master`（前置：P1 清完 + `make test` 全绿） | P6 重验前 |
| 19 | 加 `.github/workflows/test.yml`（push/PR 跑 pytest） | 推 GitHub 后 |

## 已闭环（原 spec 开放项，留档）

- ✅ B站 WBI：手写 `wbi.py`（混合 key + 排序 md5），未引第三方库
- ✅ heal_runner 处置：改只读诊断，保留未接线
- ✅ 验收关键词：默认 "独立开发者"（可用 --keyword 换）
- ✅ P6 首轮验收已执行（2026-10-13）：工程通过、价值未通过，报告见 `docs/acceptance-2026-10-13.md`

## 外部风险登记（不受本仓库控制，只登记不解决）

| 风险 | 影响 | 应对 |
|---|---|---|
| B站 v_voucher 风控升级（连续请求触发人机验证） | 搜索链路中断 | 已实现检测并明确报错（不绕）；降频/隔天重试/换关键词。**2026-10-13 验收连跑 3 次未触发**。**2026-10-14 起传输层换 Scrapling（TLS/JA3 指纹伪装）进一步降触发概率**（a57dbdc） |
| B站接口 / WBI 算法变动 | 适配器签名失效 | 症状：搜索全部报错；应对：更新 `wbi.py`（参考 bilibili-api-collect） |
| B站免登录额度收紧（无 SESSDATA 时评论变少） | 评论量 < 500 预算 | 可配 `.env` 的 BILI_SESSDATA |
| 视频下架/私密（实测出现 -404） | 单条候选作废 | 已正确跳过不中断（2026-10-13 验证实测） |
| MediaCrawler / TikTokDownloader（外部项目）失效 | 小红书/抖音扩展不可用 | 不在本阶段范围（PRD Won't） |
| LLM API 变更/涨价 | `--llm` 五维不可用 | 启发式兜底路径始终可用 |
