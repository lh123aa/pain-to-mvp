# Changelog

版本策略（PRD §八）：自 0.1.0 起按 semver 计；生成器时代的 5.x 版本号已废弃，仅作历史留档。
每次合并 master 必须更新本文件。

## [0.3.0] - 2026-10-15

iteration-2：产出可信化 —— 排序正确、评分理由可核对、标题不误导、域错可见（分支内发布，待合并 master）。

### Added
- **执行报告 HTML 单文件**：`exec_report.py` 内部同产 `.md`（git 存档）+ `.html`（浏览器直开、可分享、断网可用），同名成对；版式单一青灰强调、等宽数字、无 emoji 图标、全插值转义（44141fb / 31a38af）
- **自动执行报告**：每次 run_all 跑批产出「决策漏斗 + 分数拆解 + 被过滤评论词级理由 + 召回视频域自查 + 异常 + 规则清单」六节报告，过程可见是"系统学会筛选"的前置（9af0243 / 7f5fbbb）
- **`score_reason`**：每张卡写入算式 + 样本置信度；`_fallback_reason` 取代"启发式评分"空话（1b1e2d5）
- **P0 域校验三层防线** `domain_check.py`（词表规则，实测依据：问题域痛点率 23.6% vs 娱乐域 4.5%，5.2 倍杠杆）：
  - Layer 1 `classify_keyword` + `run_all.domain_precheck`：娱乐域关键词爬取前警告（不阻断，合规红线）（7893441 / cd56a5a）
  - Layer 2 `is_adult`：成人擦边黑名单在 `preprocess.is_valid` 清洗层硬拦截（7893441）
  - Layer 3 `domain_overlap`：召回标题域重合度 < 50% 判 `domain_mismatch`，报告第 4 节展示（7893441 / 2f7cdb3）

### Changed
- 评分置信度封顶延后：`0.6+0.04*size`（10 条即封顶）→ `0.6+0.008*size`（50 条封顶）+ 付费量级加成，112 条真实需求簇不再被 11 条玩梗簇压过（1b1e2d5）
- 卡片标题：过滤 `[表情]` 标签与 <8 字候选，取最长合格句，全不合格退 `_topic_title`（1b1e2d5）
- 报告第 4 节说明句随 verdict 分支（判"通过"不再同页写"跑偏"）；第 6 节规则表列入域校验三层位置；漏斗清洗层说明补"成人擦边"（8657ab7 / 2b80de8 / cc69f0f）

### Fixed
- `exec_report.breakdown` 与评分共用 `_confidence_factor`（第二处硬编码公式消除）（1b1e2d5）
- `_topic_title` 空信号拼成"痛点痛点"；长度阈值 12→8（12 误伤"预算有限投不起广告"9 字真实诉求）（1b1e2d5）
- 报告 emoji 红线：✅(U+2705) 从旧码位范围洞漏过 → 测试范围补 0x2600-0x27BF / 0x2B00-0x2BFF / FE0F；旧测试用 unknown 关键词不渲染 verdict 行属假绿，改用触发 domain_match 的数据（8657ab7）
- **crawl JSONL 跨 run comment_id 去重**（OPEN_ISSUES #20）：`save_records` 的 SQLite 侧 `INSERT OR IGNORE` 去重而 JSONL 无条件追加 → 同视频反复爬 raw 每轮长一截，漏斗 loaded=703 是累积数（下游 608 文本去重兜住产出，但报告口径失真）；改写前读入已有 id + 批内边写边加，JSONL 自身为去重权威（DB 被清也失守不了）；apply_fixes overlay patch2 防生成器重跑回退，测试走模板→patch1→patch2 全链路断言与权威版逐字节一致（50e491e）

### Verification
- 全量 pytest **130 passed / 0 failed**（0.2.0 的 65 → 91 → 105 → 126 → 130）
- 真实数据端到端：问题域「独立开发者怎么接单」703 载入 → 147 痛点（23.6%）；112 条真实需求簇 70.0 A(第2) → 80.0 A(第1)，11 条玩梗簇 80.0 A → 55.0 B
- 域校验真实数据验证：娱乐域 discovered 80% 判定/文案一致、全文零 emoji（8657ab7 附报告样例）

### Known Issues（未修，诚实清单见 docs/OPEN_ISSUES.md）
- 评分 3 维恒 None（2/5 维参与）；`--topics` 未从 run_all 接线；`min_cluster=3` 过松；MVP 取 dict 首键；同日卡片覆盖
- **apply_fixes 回退陷阱**：改 `score_opportunity.py` / `export_card.py` / `cluster.py` / `mine_pain_points.py` 必须先同步 `generators/fixes/` 权威副本再跑全量测试（测试内 apply_fixes 会用 canonical 覆盖工作区，改动被静默回退）

## [0.2.0] - 2026-10-14

iteration-1：工具全链路跑通 + 最终结果价值有效性（分支内发布，待合并 master）。

### Added
- B站适配器传输层接入 **Scrapling 0.4.15**（TLS/JA3 指纹伪装，降低 v_voucher 风控概率），缺失时回退 requests；源码副本存 `vendor/Scrapling/`（不进运行路径）（a57dbdc）
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
