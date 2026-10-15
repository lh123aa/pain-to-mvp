# OPEN ISSUES — 技术债与风险登记

更新：2026-10-15 ｜ 策略（PRD §九）：**P6 重验前只清 P1**，其余按需。
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
| 9 | `update_progress.py` / `dashboard.json` 落实 PRD §6.1 六阶段状态机 + `schema_version` + 单向流转校验 | PRD 决策（Q7） | 非法状态/回退被拒绝；schema_version 写入顶层 | ✅ 六阶段单向流转 + dropped 终态 + progress 只增不减 + schema_version + 旧枚举自动迁移（0.3.1，test_dashboard_state.py 8 项） |
| 10 | python-dotenv 接线：代码统一从 `.env` 读凭证 | PRD 决策（Q8） | `.env` 可用，文档不再是"计划" | ✅ `env_loader.py` + `pipeline/__init__.py` 零接线全入口覆盖；shell 优先、fail-safe（0.3.1，test_env_loader.py 3 项）；USAGE §五已更新为"已接线" |
| 11 | 评分校准闭环落地：抽检记录格式 + 回看脚本/流程（`data/calibration/` 已有 2 条真实记录） | PRD §五（Q6） | 抽检可记录、累计 20 条可回看命中率 | ✅ `calibration.py` record/review 两命令（0.3.1）：格式契约 SCHEMA_FIELDS、fail-close 校验、信号级/top3 命中率回看、满 20 条提示；真实数据冒烟通过（现 2/20） |
| 12 | SQLite 主键仅 id 与 JSONL 去重键 (platform,source_id,id) 不一致，跨平台同 id 静默丢弃 | deferred | 主键/唯一键与去重键对齐 + 测试 | ✅ 复合主键 `(platform, source_id, id)` + `_migrate_pk` 旧库自动迁移保数（PRAGMA table_info 检测单键旧库→重建表）；fix_storage patch3 防回退；test_storage.py 新增 3 项（跨平台共存/同键仍去重/迁移保数） |
| 13 | serve.py 不解码 %xx，含中文资源名 403 | deferred | 中文资源名可访问 + 测试 | ✅ unquote 进 `resolve_asset`（解码先于边界检查，`%2e%2e%2f` 穿越仍被拦）；fix_serve 补 import patch + resolve_asset patch 同步；test_serve_asset.py 新增 2 项 |
| 14 | daily-audit.yml 处置：仍定时跑且 auto commit&push，与「自优化不投入」决策冲突 | PRD §三（Q3） | 去定时改手动，或删除；二选一留记录 | ✅ 去定时仅留 workflow_dispatch，结果改 artifact 上传不再 auto commit&push（与 self-heal.yml 只读原则一致）；决策注释留 yml 头部；test_workflow_guards.py 守卫 2 项防回退 |
| 15 | heal_runner `load_bugs` 无坏行保护；subprocess 死导入 | deferred | 坏行跳过；死导入清除 | ✅ 坏行 try/except JSONDecodeError 跳过；subprocess 死导入清除（canonical + fixes/ 双改）；test_heal.py 补坏行测试 + `not hasattr(heal_runner, "subprocess")` 守卫 |
| 22 | `--topics` 未从 run_all 接线（mine 支持但入口不传，域内聚焦默认关闭） | 2026-10-14 报告追查 | run_all 透传或显式决策不启用并记录 | ✅ run_all 新增 `--topics` 透传 mine（0.3.1，test_topics_wiring.py 3 项；未给参数行为不变） |
| 23 | `min_cluster=3` 过松：3 条同句式玩梗即可成簇进卡片 | 报告追查 | 阈值提高或加簇内多样性校验 | ✅ 簇内多样性校验 `_is_homogeneous_repetition`：成员两两 bigram Jaccard 全 ≥0.5 判复读簇丢弃（存在一对差异表达即保留，不误杀"同痛点不同说法"）；test_cluster_diversity.py 4 项 |
| 24 | `design_mvp.py` MVP 类型取信号 dict **第一个键**（插入顺序，非主导信号） | 报告第 6 节已标注 | 取频次最高信号 | ✅ sigs 按频次降序 sorted；fix_design_mvp patch 防生成器重建回退；test_design_mvp.py 2 项 |
| 25 | 同日卡片覆盖：`data/cards/` 按日期命名，同日二次跑批覆盖前次 | 报告追查 | 加时间戳或 run id | ✅ `_next_card_id_seq` 同日续接序号（扫描已有 `{date}-NNN` 从最大值继续）；首跑文件保留、id 不重复；test_card_confidence_overwrite.py 覆盖 |
| 26 | `score_confidence` 已写入数据但卡片不显示 | 2026-10-14 修复附带发现 | 卡片展示置信度 | ✅ 机会评分表加「样本置信度」行：有值 `f"{conf:.2f}"`、缺值渲染 `—` 不伪造；canonical export_card 双改（与 fixes/ 字节一致） |

## P3 — 有空再清（已有兜底，风险低）

| # | 事项 | 来源 | 完成标准 |
|---|---|---|---|
| 16 | apply_fixes `fix_run_all` 补丁 marker="import time" 偏通用（幂等测试已兜底） | deferred | marker 换成新代码独有文本 | ✅ marker 改 `crawl_started_at`（0.3.2）；AST 守卫测试断言 fix_run_all 全部 marker 为新代码独有且出现在 run_all.py（test_p3_cleanup.py） |
| 17 | mine tag 运算符优先级别扭（无害） | deferred | 加括号，语义不变 | ✅ 抽 `_output_tag(platform, input_file)` 显式括号固定意图（语义不变：无 input_file 恒 'all'）；canonical + fixes/ 双改；语义测试 4 断言 |

## 工程待办

| # | 事项 | 时机 |
|---|---|---|
| 18 | 合并 `feat/prospecting-fixes` → `master`（前置：P1 清完 + `make test` 全绿） | P6 重验前 |
| 19 | 加 `.github/workflows/test.yml`（push/PR 跑 pytest） | 推 GitHub 后 |
| 27 | **apply_fixes 回退陷阱**：`test_apply_fixes_stays_idempotent_with_exec_report` 在测试内跑 apply_fixes，末尾 `copy_canonical_modules()` 用 canonical 覆盖工作区 —— 改 `score_opportunity.py`/`export_card.py`/`cluster.py`/`mine_pain_points.py` **必须先同步 `generators/fixes/` 再跑全量测试**，否则改动被静默回退 | 改上述 4 文件时必查；长期：测试改用临时目录不污染工作区 |

## 已闭环（原 spec 开放项，留档）

- ✅ B站 WBI：手写 `wbi.py`（混合 key + 排序 md5），未引第三方库
- ✅ heal_runner 处置：改只读诊断，保留未接线
- ✅ 验收关键词：默认 "独立开发者"（可用 --keyword 换）
- ✅ P6 首轮验收已执行（2026-10-13）：工程通过、价值未通过，报告见 `docs/acceptance-2026-10-13.md`
- ✅ **执行报告可解释化**（2026-10-14/15，9af0243/44141fb）：六节自动报告（漏斗/分数拆解/被过滤理由/域自查/异常/规则表），HTML 单文件 + md 成对
- ✅ **排序与可信修复**（2026-10-14，1b1e2d5）：conf 封顶 10→50 条 + 付费量级加成（112 条真实需求簇反超 11 条玩梗簇）；`score_reason` 可核对；标题过滤表情标签与短句
- ✅ **P0 域校验三层防线**（2026-10-15，7893441/cc69f0f）：关键词前置警告 / 成人黑名单清洗层拦截 / 召回域重合度报告；真实数据验证判定与文案一致、全文零 emoji；阈值 0.5（1/3 命中不再判"基本一致"）
- ✅ **crawl 跨 run comment_id 去重**（原 #20，2026-10-15，50e491e）：`save_records` 的 JSONL 侧原本无条件追加（SQLite 才去重）→ 跨 run 重爬导致漏斗 loaded 虚高（703 即累积数）；改为写前读入已有 id + 批内边写边加，JSONL 自身为去重权威（DB 清空也失守不了）；apply_fixes overlay patch2 防生成器重跑回退，测试走模板→patch1→patch2 全链路
- ✅ **证据驱动评分维度**（原 #21 方向A收窄版，2026-10-15，b229b7b）：`竞争空缺` = 簇内对比+失望信号（零证据 None，双证据密度≥15% 加成）、`AI杠杆` = 代表句形态词表（软件词/线下词对向计分，无词 None）、`触达难度` 诚实留空恒 None；报告第 2 节拆解表增两列 + 过期公式 0.04→0.008 修正；真实数据回归：112 簇 85.0 S / 11 簇 59.6 B / 3 簇 43.7 C，反超格局保持；顺带修 fix_scoring marker 丢失（返回值改动弄丢 `'competition': None,` 锚点）

## 外部风险登记（不受本仓库控制，只登记不解决）

| 风险 | 影响 | 应对 |
|---|---|---|
| B站 v_voucher 风控升级（连续请求触发人机验证） | 搜索链路中断 | 已实现检测并明确报错（不绕）；降频/隔天重试/换关键词。**2026-10-13 验收连跑 3 次未触发**。**2026-10-14 起传输层换 Scrapling（TLS/JA3 指纹伪装）进一步降触发概率**（a57dbdc） |
| B站接口 / WBI 算法变动 | 适配器签名失效 | 症状：搜索全部报错；应对：更新 `wbi.py`（参考 bilibili-api-collect） |
| B站免登录额度收紧（无 SESSDATA 时评论变少） | 评论量 < 500 预算 | 可配 `.env` 的 BILI_SESSDATA |
| 视频下架/私密（实测出现 -404） | 单条候选作废 | 已正确跳过不中断（2026-10-13 验证实测） |
| MediaCrawler / TikTokDownloader（外部项目）失效 | 小红书/抖音扩展不可用 | 不在本阶段范围（PRD Won't） |
| LLM API 变更/涨价 | `--llm` 五维不可用 | 启发式兜底路径始终可用 |
