# Changelog

版本策略（PRD §八）：自 0.1.0 起按 semver 计；生成器时代的 5.x 版本号已废弃，仅作历史留档。
每次合并 master 必须更新本文件。

## [0.3.4] - 2026-10-15

P6 重验期间发现并修复的 fail-close 缺口（OPEN_ISSUES #28）。

### Fixed
- **discover fail-close**（NFR 4.1 补全）：全部平台失败（如 B站 v_voucher 风控）时旧代码捕获异常后仍 exit 0 + 写空 `[]` 文件，e2e Step 1 据 returncode 判 ✅ 假成功，失败被推到 crawl 步误报"未找到评论数据"。现零发现即 `sys.exit(1)` 并点名失败/不可用平台；空文件照写防下游 `latest()` 复用上轮旧产物

### Added
- `generators/apply_fixes.py` 新增 `fix_discover_failclose`（5 段锚点 patch，注册于 `fix_safe_filename_wiring` 之后），防 extract 重新提取模板打回
- `tests/test_discover_failclose.py`：7 测试——全平台失败退出非 0 / 报错点名平台 / 有产出不中断 / 一成一败不中断 / 全部不可用也算 fail-close / 模板恢复 + 重跑幂等 / 工作区 marker 守卫

### Changed
- `test_wbi.py::test_discover_failure_does_not_break_pipeline` 契约升级：旧断言"失败返回 `[]` 继续"正是被证伪的假成功路径，改为断言 `SystemExit(非0)`——"不能崩"的本意保留（不抛裸 RuntimeError），失败改由退出码说话

## [0.3.3] - 2026-10-15

阶段 6 工程收尾：CI + 回退陷阱长期解（OPEN_ISSUES #19/#27），合并 master 后首批。

### Added
- **CI** `.github/workflows/test.yml`（OPEN_ISSUES #19）：master push + PR 触发 pytest 单元套件（Python 3.12）；不跑 Makefile 的 `make test`（那是 B 站端到端爬取，需网络凭证且有风控暴露）
- **canonical 同步字节级护栏** `test_canonical_four_match_fixes_overlays`（OPEN_ISSUES #27）：断言 cluster/mine_pain_points/score_opportunity/export_card 与 `generators/fixes/` 逐字节一致——忘同步在测试红并直指 RK-0001，而非测试跑完静默丢工作（已做故意不同步 RED→GREEN 验证）

### Changed
- **apply_fixes 幂等测试改工作区副本**（OPEN_ISSUES #27 长期解）：conftest 新增 `workspace_clone` fixture（复制工作区剔除 .git/vendor/data/docs/project-journal），`test_apply_fixes_idempotent` 与 `test_exec_report` 的 apply_fixes 重跑测试改为在副本上执行——真实工作区零写入，RK-0001 陷阱从"跑测试前必须手动同步"降级为"字节断言守门"

## [0.3.2] - 2026-10-15

iteration-3 前半：P2 技术债清账（OPEN_ISSUES #12-#15、#23-#26 全部闭环）。

### Fixed
- **SQLite 复合主键**（OPEN_ISSUES #12）：comments 主键 `id` → `(platform, source_id, id)`，跨平台同 id（bilibili '1' vs reddit '1'）不再被 `INSERT OR IGNORE` 静默互覆；`_migrate_pk` 检测旧单键库自动重建表保数；`fix_storage` patch3 防生成器重建回退；+3 测试（test_storage.py）
- **serve %xx 解码**（OPEN_ISSUES #13）：`unquote` 进 `resolve_asset`，解码先于边界检查（`%2e%2e%2f` 穿越仍被拦），中文资源名不再 403；fix_serve 补 import patch；+2 测试（test_serve_asset.py）
- **heal_runner 坏行跳过 + 死导入清除**（OPEN_ISSUES #15）：`load_bugs` 坏行 try/except JSONDecodeError 跳过不炸整份诊断；`import subprocess` 死导入清除（canonical + fixes/ 双改）；test_heal.py 改全局 subprocess patch + `not hasattr` 守卫；+1 测试
- **design_mvp 主导信号**（OPEN_ISSUES #24）：sigs 按频次降序而非 dict 插入顺序，首推与 deliverable_hint 跟随票数最高信号；新增 `fix_design_mvp` patch 防回退；+2 测试（test_design_mvp.py）
- **卡片置信度上卡**（OPEN_ISSUES #26）：机会评分表加「样本置信度」行，有值 `:.2f`、缺值 `—` 不伪造；canonical export_card 与 fixes/ 字节一致
- **同日卡片不覆盖**（OPEN_ISSUES #25）：`_next_card_id_seq` 扫描已有 `{date}-NNN` 续接序号，同日二次跑批保留首跑文件、id 不重复
- **簇内多样性校验**（OPEN_ISSUES #23）：`_is_homogeneous_repetition` 成员两两 bigram Jaccard 全 ≥0.5 判同句式复读簇丢弃，存在一对差异表达即保留（不误杀同痛点不同说法）；canonical cluster 与 fixes/ 双改；+4 测试（test_cluster_diversity.py）

### Changed
- **daily-audit.yml 去定时**（OPEN_ISSUES #14 / PRD §三 Q3「自优化不投入」）：仅留 workflow_dispatch，审计结果改 artifact 上传不再 auto commit&push（与 self-heal.yml 只读原则一致）；决策注释留 yml；+2 守卫测试（test_workflow_guards.py）防定时回退
- **P3 清账**（OPEN_ISSUES #16/#17）：fix_run_all marker "import time" → "crawl_started_at"（新代码独有文本，AST 守卫测试断言全部 marker 独有）；mine tag 计算抽 `_output_tag` 显式括号固定优先级语义（语义不变，canonical + fixes/ 双改）；+3 测试（test_p3_cleanup.py）

## [0.3.1] - 2026-10-15

### Added
- **评分校准闭环** `calibration.py`（OPEN_ISSUES #11 / PRD §五）：`record` 记录 top 卡片抽检（verdict 仅 real/fake、note 必填、同卡重复拒绝——fail-close 不写脏数据；signals 自动从卡片 md 抽取），`review` 回看命中率（总体 + top3 成功线口径 + 信号级命中率，低命中信号即调权候选），满 20 条提示达回看线；坏行跳过不崩溃；10 项测试（test_calibration.py）
- **dashboard 状态机**（OPEN_ISSUES #9 / PRD §6.1）：`update_progress.py` 落实六阶段单向流转（pending→discovering→crawling→mining→scoring→designing→done + dropped 终态），非法状态/回退/终态流转一律拒绝不写盘；progress 只增不减；`schema_version` 写入顶层；旧枚举（discovered/analyzing/mvp_design/validating/completed/in_progress）加载时自动迁移；`add_requirement` 从 pending 起步；CLI 失败退出码非 0；8 项测试（test_dashboard_state.py）
- **.env 接线**（OPEN_ISSUES #10 / PRD §七）：`env_loader.py` 统一加载仓库根 `.env`（python-dotenv，shell 环境变量优先不覆盖，缺文件/缺依赖 fail-safe 跳过）；经 `pipeline/__init__.py` 零接线覆盖全部 CLI 入口（凡带 UTF-8 稳定化块的脚本必经 pipeline 包导入）；`python env_loader.py` 自检打印已设置凭证键（不打印值）；3 项测试（test_env_loader.py）

### Changed
- `run_all.py` 新增 `--topics` 透传至 mine（OPEN_ISSUES #22）：域内聚焦从"mine 支持但入口不传"变为可用；未给参数行为不变，旧调用方无 `topics` 属性不崩（getattr 兜底）；3 项测试（test_topics_wiring.py）

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
- **证据驱动评分维度**（OPEN_ISSUES #21 方向A收窄版）：评分从 2/5 维参与升级 —— `竞争空缺` = 簇内对比+失望信号（零证据 `None` 不伪造，双证据且密度 ≥15% 加成，单证据中档 3）；`AI杠杆` = 代表句形态词表（软件词加分 / 线下词减分，类内 ≥2 词权重翻倍，无词 `None`）；`触达难度` 诚实留空恒 `None`；reason 逐维交代证据来源（b229b7b）

### Changed
- 评分置信度封顶延后：`0.6+0.04*size`（10 条即封顶）→ `0.6+0.008*size`（50 条封顶）+ 付费量级加成，112 条真实需求簇不再被 11 条玩梗簇压过（1b1e2d5）
- 卡片标题：过滤 `[表情]` 标签与 <8 字候选，取最长合格句，全不合格退 `_topic_title`（1b1e2d5）
- 报告第 4 节说明句随 verdict 分支（判"通过"不再同页写"跑偏"）；第 6 节规则表列入域校验三层位置；漏斗清洗层说明补"成人擦边"（8657ab7 / 2b80de8 / cc69f0f）
- 报告第 2 节拆解表增 `竞争` / `AI杠杆` 列（进了均值不上表 = 不可核对）；"只有 X/5 参与、三维恒 None"旧口径改为"证据驱动"说明；第 6 节规则行 md+html 同步（b229b7b）

### Fixed
- 报告第 2 节过期公式文案 `0.6+0.04×size` → `0.6+0.008×size`（1b1e2d5 改斜率时漏改文案，报告展示的公式与真实计算各说各话）（b229b7b）
- `apply_fixes.fix_scoring` marker `'competition': None,` 被证据驱动返回值弄丢 → 丢失即抛"未找到锚点"；改锚 `'reach': None`（模板态缺席 → 打补丁，工作区命中 → 跳过，最终 copy_canonical 兜底）（b229b7b）
- `exec_report.breakdown` 与评分共用 `_confidence_factor`（第二处硬编码公式消除）（1b1e2d5）
- `_topic_title` 空信号拼成"痛点痛点"；长度阈值 12→8（12 误伤"预算有限投不起广告"9 字真实诉求）（1b1e2d5）
- 报告 emoji 红线：✅(U+2705) 从旧码位范围洞漏过 → 测试范围补 0x2600-0x27BF / 0x2B00-0x2BFF / FE0F；旧测试用 unknown 关键词不渲染 verdict 行属假绿，改用触发 domain_match 的数据（8657ab7）
- **crawl JSONL 跨 run comment_id 去重**（OPEN_ISSUES #20）：`save_records` 的 SQLite 侧 `INSERT OR IGNORE` 去重而 JSONL 无条件追加 → 同视频反复爬 raw 每轮长一截，漏斗 loaded=703 是累积数（下游 608 文本去重兜住产出，但报告口径失真）；改写前读入已有 id + 批内边写边加，JSONL 自身为去重权威（DB 被清也失守不了）；apply_fixes overlay patch2 防生成器重跑回退，测试走模板→patch1→patch2 全链路断言与权威版逐字节一致（50e491e）

### Verification
- 全量 pytest **143 passed / 0 failed**（0.2.0 的 65 → 91 → 105 → 126 → 130 → 143）
- 真实数据端到端：问题域「独立开发者怎么接单」703 载入 → 147 痛点（23.6%）；112 条真实需求簇 70.0 A(第2) → 80.0 A(第1)，11 条玩梗簇 80.0 A → 55.0 B
- 证据驱动评分真实数据回归（问题域 20:30 真实三簇）：112 簇 85.0 **S**（真实代表句 7 个软件形态词 → ai=5，四维均值过 S 线）/ 11 簇 59.6 B（competition=5 但 conf 0.688 压住）/ 3 簇 43.7 C（无证据留 None），112 反超格局保持，触达全员 None（b229b7b）
- 域校验真实数据验证：娱乐域 discovered 80% 判定/文案一致、全文零 emoji（8657ab7 附报告样例）

### Known Issues（未修，诚实清单见 docs/OPEN_ISSUES.md）
- `触达难度` 无数据来源恒 None（方向A收窄版有意留空）；`--topics` 未从 run_all 接线；`min_cluster=3` 过松；MVP 取 dict 首键；同日卡片覆盖
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
