# 每项目归档功能 完成报告（2026-10-18）

用户需求：每个项目（关键词）生成的文件放在一个子文件夹，好管理查看。

## 交付物

| 项 | 内容 | 状态 |
|---|---|---|
| `scripts/pipeline/organize_project.py` | 归档模块（--migrate 历史 / --run 本轮，幂等） | ✅ |
| `tests/test_organize_project.py` | 10 测试（归属/复制/幂等/待认领/README） | ✅ GREEN |
| `tests/test_organize_readers.py` | 6 测试（校准 find_card + 看板 glob 扩展 + 去重） | ✅ GREEN |
| `scripts/pipeline/calibration.py` | find_card：projects/*/cards 优先，data/cards 回退 | ✅ |
| `scripts/dashboard/write_dashboard.py` | 卡片源 = data/cards + data/projects/*/cards（同 id 去重） | ✅ |
| `scripts/e2e_test.py` | 收尾加 organize 步骤（steps.append，失败即整体失败） | ✅ |
| `generators/apply_fixes.py` | fix_e2e_organize overlay（锚点=看板重建块，marker=organize_project.py） | ✅ |
| `SKILL.md` | 新增 §八 产物归档规则 | ✅ |

## 设计决策（诚实记录）

- **raw 只复制不移动**：jsonl_path_for 是写入单一权威（#31 决策），跨轮去重
  （#20）依赖 data/raw/ 原件；移动会导致同关键词重跑全量重爬 → 加重 v_voucher
  风控（10-17 两次拦截的现实约束）。项目夹里的 raw/ 是复制件 + README 说明。
- **无归属历史文件 → `data/projects/_待认领/`**：不硬安给任何项目（不许骗人）。
- **文件夹名 = safe_filename(关键词)**：与 discovered 文件命名同源（内部空格保留，
  是既有权威行为，不在本需求范围）。
- **归档失败 = e2e 整体失败**（steps.append + #30 退出码纪律），不做静默降级。
- 看板重建在归档**之前**跑（--no-dashboard 防重复）；归档后看板 glob 已扩展可
  读到项目夹卡片，下次跑自动刷新。

## 验证

- 定向 47 passed（overlay 护栏 + e2e 退出码 + 归档 16 + 校准/看板 18）
- 全量套件 237 passed + 1 failed：
  - `test_run_inputs.py::test_discover_keyword_with_path_chars` 失败原因是
    **B 站 v_voucher 风控**（子进程真调 API 被拦），非本次改动引起
  - 该测试已被本地改为 in-process mock（防风控，CI 可复现），但改动**未提交**
    （非本次任务产物，单独一笔）
  - requirements.txt 版本锁定改动也是上一会话遗留未提交

## 下次继续

1. 提交本次归档功能（organizer + 测试 + 读者改造 + e2e 接线 + overlay + SKILL.md）
2. 提交 test_run_inputs mock 化 + requirements 锁定（单独一笔）
3. 实跑 `--migrate`（真数据 43 discovered / 76 pains / 84 scored / 18 cards / 35 raw）
4. 重建看板 + 展示目录结构给用户
5. 全量 222+ 基线恢复绿（等风控冷却后补 test_run_inputs）
