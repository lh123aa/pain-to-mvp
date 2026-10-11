# SDD ledger — plan: docs/superpowers/plans/2026-10-11-pain-to-mvp-fix-and-first-run.md

执行方式：原生执行（用户选定）。分支：feat/prospecting-fixes（master 基线 7d271f9）。

## 任务清单
- [x] Task 1: 项目落地与测试脚手架
- [x] Task 2: 入口 UTF-8 稳定化
- [x] Task 3: B站 WBI 签名 + 游标分页
- [x] Task 4: raw 全量合并去重与文件名安全
- [x] Task 5: 评分去伪与卡片可读性
- [x] Task 6: Dashboard 路径穿越修复
- [x] Task 7: 处置"假闭环"（自愈系统）
- [x] Task 8: 端到端验收（真实数据）

## Pre-flight: 共享接口扫描
- Row 1: Tasks 2-7 全部消费 Task 1 的生成骨架（scripts/pipeline/*.py、adapters、serve.py、heal_runner.py）。若 Task 1 产物结构不符，后续全部失败。无冲突——各任务只碰自己名下文件。
- Row 2: Task 8 消费 Tasks 2-7 全部产出；Review Focus #5（重新生成后修复仍在）跨 Task 1/2/8。
- Ruling: git init 从 Task 1 Step 5 提前到 setup 执行（工作区/台账依赖 git 仓库存在；master 基线含 spec+plan 文档，实现全部在 feat 分支）。
- Ruling: sdd-workspace 脚本用 Git bash 显式路径执行（系统默认 bash 是 WSL，路径解析失败）。

## 计划缺陷处置（写代码前发现，先改计划）
- Plan-fix 1: Task 4 测试 `test_mine_empty_input_returns_empty` 期望 `mine([]) == []`，但现版 `cluster_comments` 在空输入时返回 1 个 size=0 的伪簇 → mine 会产出 1 条空痛点卡片。按 Spec"输出可信"：Task 4 Step 3 追加 `if not texts: return []` 守卫。否则测试永远红。
- Plan-fix 2: Task 5 `test_format_title` 的期望字符串需手数 30 字，计划里写死了一个带省略号的期望值但样本只有 20 字（不会触发截断）→ 改为断 `len(title) <= 31 and title.endswith("…")`，样本用 >30 字字符串。
- Plan-fix 3: Task 3 `test_enc_wbi_sorted_and_adds_signature` 中 `enc_wbi({"keyword":"test","mid":1}, ...)` 的 w_rid 由实现决定，两个字典字面量顺序不同但内容相同 → 排序无关性断言成立，无缺陷（记录备查）。

## Task 1: complete (commits 7d271f9..a473dac, tests: python -m pytest tests/test_demo.py → 1 passed)
- 提取 7 个生成器（含补回 __main__ 守卫的修正）、P0-P6 生成 79 文件、doctor ✅ 系统健康、demo 全流程出卡（74 分 A 档）
- Task 1 Ruling: demo.py 的 eager glob bug（构造 steps 列表时就 sorted(glob)[-1]，上一步还没跑→IndexError）→ 改为人话版顺序执行；补 tests/test_demo.py RED(IndexError)→GREEN(pass)。成本：若漏判错在 demo 而非 pytest 配置，会白改一处代码（已通过单跑 mine 排除）。

## Task 2: complete (commits a473dac..fc6b347, tests: python -m pytest tests/ → 3 passed)
- scripts/pipeline/encoding.py::ensure_utf8 + generators/fix_utf8.py 幂等补丁（32 个入口）；RED 实证：PYTHONIOENCODING=cp936 下 doctor.py 崩在 🩺（U+1FA7A）gbk 编码 → GREEN
- Task 2 Ruling: 重新生成会覆盖 demo.py 修复与补丁 → 把 demo 修复同步进 generators/generate_p6.py 模板（单一事实源），重跑 P0-P6 + 补丁后 3/3 仍绿。成本：generate_p6.py 与官方版的差异需在后续维护生成器时保留。

## Task 3: complete (commits fc6b347..3dd39ee, tests: python -m pytest tests/ → 7 passed)
- wbi.py（混合 key + 排序 md5 签名）、bilibili.py 重写（wbi/search/type + /x/v2/reply/main 游标分页 + 业务错误码检查）
- Task 3 Ruling A: 生成代码存在比 WBI 更底层的 P0 bug——discover_content.py 直接运行即 ImportError（入口用 flat 导入 `from adapters import`，adapters 内用 `from ..compliance` 包相对导入，flat 化后越界）→ 5 个适配器统一改 flat `from compliance import`。成本：若将来重构为包式运行需再统一一次。
- Task 3 Ruling B: conftest.py 误写进 tests/ 导致 ROOT 算错、sys.path 全错 → 移到仓库根。成本：无。
- Task 3 Ruling C: crawl_comments 按 limit 截断（30/35）是正确语义，测试预期写错 → 改测试为 30。成本：无。
- Task 3 Ruling D: 同步 bilibili.py 进 generate_p2.py 模板的自写脚本吃掉闭合 `'''`，且 PowerShell Set-Content -Encoding utf8 引入 BOM+CRLF 污染模板 → 补回闭合引号、全仓 .py 归一 LF 无 BOM。教训：后续写文件一律用 python/edit 工具，不用 PowerShell Set-Content。成本：重生成一次全流程验证（已过）。

## Task 4: complete (commits 3dd39ee..3daeab4, tests: python -m pytest tests/ → 14 passed)
- run_inputs.py（collect_raw_files/merge_jsonl_records/safe_filename）、cluster 空输入守卫、mine --inputs、run_all/e2e 全量 raw 合并（since 过滤只取本次 run 产出）
- Task 4 Ruling A: 建立 generators/apply_fixes.py 作为唯一后处理入口（新模块 + 全部文本补丁 + fix_utf8），重新生成后一条命令恢复全部修复；终验：P0-P6 重生成 → apply_fixes → 14/14 绿。
- Task 4 Ruling B: apply_fixes 的"签名加 inputs"补丁标记 `inputs=None):` 误命中 _load_input 补丁结果，导致 mine 签名漏打、CLI --inputs 一调就 TypeError（13/14 测试全绿但 CLI 崩——单元测试覆盖不到 CLI 接线）→ 标记改唯一字符串 `min_cluster=3, inputs=None`，并补 CLI 级回归测试 test_mine_cli_inputs_flag_works。教训：补丁标记必须取自"新代码独有"文本，不能用新代码通用片段。

## Task 5: complete (commits 3daeab4..8c6aa76, tests: python -m pytest tests/ → 19 passed)
- _heuristic_scores 只输出 demand/feasibility；_compose_total 仅对有效维度求均值×20；export_card 标题 format_title + format_dim（None→—）
- Task 5 Ruling A: Task 3 的 bilibili.py 修复进了 generate_p2.py 模板，其余修复走 apply_fixes.py overlay——两种机制并存（台账备查）。成本：维护者需知道 bilibili 的源在生成器、其他的源在 apply_fixes。
- Task 5 Ruling B: apply_fixes 需要 TDD 保护——本轮编辑工具误把两行粘连致 SyntaxError，靠全周期终验（重生成→apply_fixes→19 测试）抓住。今后每次改 apply_fixes 必须跑全周期。

## Task 6: complete (commits 8c6aa76..0a58f72, tests: python -m pytest tests/ → 21 passed)
- serve.py resolve_asset（resolve+relative_to 校验）+ do_GET 403 接线；全周期终验 + apply_fixes 同步

## Task 7: 进行中

## Task 7: complete (commits 0a58f72..e438dc5, tests: python -m pytest tests/ → 23 passed)
- heal_runner.py 重写为只读诊断（分类+报告，不碰 git/不改状态）；self-heal.yml 去定时去推送，report 转 artifact
- Task 7 Ruling: copy_new_modules 曾盲拷 fixes/*.py 到 scripts/pipeline/ 导致 heal_runner 落错目录 → 改白名单（encoding/wbi/run_inputs），heal_runner 由 fix_heal 显式落位 scripts/healing/

## Task 8: complete (commits e438dc5..62d7dc7, tests: python -m pytest tests/ → 25 passed)
- 真实链路首次全程跑通：B站 10 条真实候选 → 36 条真实评论 → 6/6 e2e 步骤；验收文档落盘 docs/superpowers/acceptance-2026-10-11.md
- Task 8 Ruling A: B站搜索触发 v_voucher 风控（连续请求后人机验证票据，非代码缺陷）→ TDD 加检测明确抛错（不绕验证码，合规红线）；评论接口实测仍可用。记录于验收文档第四节。
- Task 8 Ruling B: v_voucher 修复改在 generate_p2.py 模板源头（b站适配器的家），重新生成验证后提交，未走 apply_fixes overlay（该适配器 Task 3 起就在模板里）。

## Final review: 待执行

## Final review: 完成（dispatch code-reviewer subagent，fresh context，diff 7d271f9..62d7dc7）
评审发现 1 Critical + 3 Important + 10 Minor。全部 Critical/Important 已 ONE fix pass 修复（TDD）：

- Final: fixed C1（extract 会把模板修复打回原形，验收文档复现路径不可复现）→ bilibili/demo 修复移入 apply_fixes overlay（权威）+ extract 覆盖警告 + 护栏测试 tests/test_fix_overlay_guards.py（4 tests RED→GREEN）。实测：extract → P0-P6 → apply_fixes → 32/32 绿（修复前 23 过 2 挂）。
- Final: fixed I1（safe_filename 死代码，`--keyword "获客/增长"` 裸 traceback）→ discover/run_all/e2e 三处接线 + CLI 回归测试（RED: rc≠0 traceback → GREEN: rc=0 产出净化文件名）。
- Final: fixed I2（storage `conn.total_changes` 连接级累计值虚报入库数）→ 改 `cursor.rowcount` + tests/test_storage.py（RED: 报 3 实 2 → GREEN: 报 2）。
- Final: fixed I3（测试污染真实产出：跑 pytest 覆盖用户当天卡片）→ conftest session 级快照还原 fixture；实测跑完 32 测试后 `git status data/` clean。
- Final Ruling A: 三次补丁标记写错（`inputs=None):` 误命中 / `collect_raw_files` 撞 import / f-string `}` 遗漏）→ 新增 tests/test_apply_fixes_idempotent.py（已修复树上重跑 apply_fixes 必须零改动零 SystemExit）。成本：多 1 个测试文件；收益：此类回归以后当场炸。
- Final Ruling B: 评审 Minor 4（run_all 取旧 discovered 文件）与 Minor 9（%xx 不解码）等 10 项 Minor 全部 deferred，不进 fix pass，清单见下。
- Final: minor (deferred): mine 单文件分支 json.loads 无坏行保护（与 --inputs 不一致）
- Final: minor (deferred): SQLite 主键仅 id 与 JSONL 去重键 (platform,source_id,id) 不一致，跨平台同 id 会静默丢弃
- Final: minor (deferred): fix_run_all 第一补丁 marker="import time" 偏通用（已由幂等测试兜底，暂不改）
- Final: minor (deferred): run_all discover 硬崩时可能取到上轮 discovered 旧文件
- Final: minor (deferred): heal_runner load_bugs 无坏行保护；subprocess 死导入
- Final: minor (deferred): compliance robots fail-open（读不到默认放行）
- Final: minor (deferred): score_opportunity WEIGHTS 成死代码；export_card p["scores"] 直取键旧格式 KeyError
- Final: minor (deferred): pain_to_mvp.db 等 data 产物入库 git，建议 gitignore
- Final: minor (deferred): serve.py 不解码 %xx，含中文资源名 403
- Final: minor (deferred): mine tag 运算符优先级别扭（无害）
- Final Ruling C: P0 生成器会把 data/dashboard.json 重置为出厂空版（全周期重新生成的预期行为，非缺陷）——已 git checkout 还原并记录。


