# Changelog

版本策略（PRD §八）：自 0.1.0 起按 semver 计；生成器时代的 5.x 版本号已废弃，仅作历史留档。
每次合并 master 必须更新本文件。

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
