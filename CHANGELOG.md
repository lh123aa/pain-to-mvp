# Changelog

版本策略（PRD §八）：自 0.1.0 起按 semver 计；生成器时代的 5.x 版本号已废弃，仅作历史留档。
每次合并 master 必须更新本文件。

## [0.2.0] - 2026-10-14

iteration-1：工具全链路跑通 + 最终结果价值有效性（分支内发布，待合并 master）。

### Added
- `pain_summary`：mine 为每个痛点簇生成一句话摘要（"N条评论集中反映「信号」：代表句"），卡片 description 优先使用（T7）
- `score_confidence`：小簇置信惩罚 `min(1.0, 0.6+0.04*size)`，3 条样本的簇最多 6 折，不再与 200 条同档（T8 / OPEN_ISSUES #8）
- `mine --topics`：主题聚焦过滤，多视频混合评论源剔除领域外闲聊（T10）
- `mine --output`：显式输出路径（e2e 测试与脚本编排依赖）
- `_cluster_fallback`：sklearn/scipy 环境损坏时纯 Python 字符二元组兜底聚类，管线不崩（T6）
- `generators/fixes/` 权威副本：T6-T10 修复同步进 apply_fixes 末步覆盖，生成器重跑不丢失修复（T11）

### Changed
- 噪音过滤：话题标签串（"独立开发，知识付费，…"）与灌水短句不进痛点簇（T6 / OPEN_ISSUES #6）
- 代表句选取：相似度×痛点乘性打分（离群高分句出局）+ MMR 去冗余（top3 覆盖簇内不同侧面）（T9/T10）
- 跨视频重复评论文本级去重，簇规模不再虚高（T9）
- `_build_card` 从 export 抽出，卡片构造可单测（T7）

### Fixed
- OPEN_ISSUES P1 全清：robots fail-close（#1）、mine 坏行保护（#2）、run_all UnboundLocalError+fail-fast+旧产物防护（#21/#3）、export scores 容错+WEIGHTS 死代码（#4）、data 出索引（#5）

### Verification
- 全量 pytest 65 passed / 0 failed（含新增 test_cluster_noise/test_pain_summary/test_score_confidence/test_dedup_text/test_topic_filter/test_pipeline_e2e）
- 真实数据全周期 mine→score→export 重生成 3/3 稳定；A5 复检 top 簇主题纯度 19/21，代表句覆盖真实痛点侧面

## [0.1.0] - 2026-10-13

需求定稿与文档对齐（本版本待随 feat/prospecting-fixes 合并 master 发布）。

### Added
- `docs/PRD.md`：需求文档（用户/验收标准/范围表/NFR/评分校准/状态机契约/密钥规范/工程流程）
- `docs/OPEN_ISSUES.md`：技术债（10 项 deferred minors）+ 外部风险登记，P1-P3 分级
- `.env.example`：凭证模板

### Changed
- README/USAGE/SKILL/ARCHITECTURE 全面对齐实现现状（自愈改只读、生成器路径、Actions 实际行为）
- 版本号 5.0.0 → 0.1.0，SKILL.md 工作流标注未接线模块
- `.gitignore`：data/ 产物不入库（PRD §4.1）

## [0.0.x 实现期] - 2026-10-11（feat/prospecting-fixes 分支）

实现大改（详见 `docs/superpowers/ledger-2026-10-11-fix-and-first-run.md`）：

### Fixed
- B站 WBI 签名 + 游标分页 + v_voucher 风控检测（不绕验证码）
- 入口 UTF-8 稳定化（Windows 兼容）
- raw 全量合并去重 + 文件名安全（safe_filename 接线）
- 评分去伪：启发式只输出有效维度，总分归一化
- Dashboard 路径穿越修复（resolve_asset 校验）
- 自愈系统处置：heal_runner 改只读诊断，self-heal.yml 去定时去推送
- Final review：修复 overlay 机制（apply_fixes 权威化 + 护栏测试）、storage 虚报行数、测试隔离

### Tested
- 32 个测试全绿；端到端真实数据验收（B站 10 候选 → 36 评论 → 6/6 步骤）

## [5.0.0] - 2026-10-11（已废弃版本号，历史留档）

### Added
- 项目骨架与目录结构
- SKILL.md 主工作流
- 项目历程记录系统（Journey Logger）
- Bug 自愈系统（Self-Healing）
- 机会卡片模板
- Journey / Bug 模板
- GitHub Actions 定时自愈
