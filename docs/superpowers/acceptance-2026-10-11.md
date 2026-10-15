# Pain-to-MVP 修复与首跑 — 验收记录

日期：2026-10-11
执行方式：原生执行（用户选定）
分支：feat/prospecting-fixes（基线 master 7d271f9）

## 一、验收结论

**通过。** 项目从"一份 6703 行的生成器说明书"落地为可运行系统；核心探矿链路
（关键词 → B站真实评论 → 痛点 → 评分 → 卡片 → 看板）端到端验证成功；
25 个自动化测试全绿；全部修复可复现（重新生成 P0-P6 后一条 apply_fixes 命令恢复）。

## 二、自动化测试（25 passed）

| 测试文件 | 数量 | 覆盖 |
|---|---|---|
| tests/test_demo.py | 1 | 离线全流程 exit 0 + 出卡片 |
| tests/test_encoding.py | 2 | UTF-8 reconfigure；cp936 控制台入口不崩 |
| tests/test_wbi.py | 5 | 混合 key/签名/游标分页/风控不崩/v_voucher 明确报错 |
| tests/test_run_inputs.py | 8 | 多文件合并去重/坏行跳过/since 过滤/文件名安全/空输入/CLI --inputs/接线护栏 |
| tests/test_scoring.py | 5 | 启发式不伪造维度/总分仅有效维度/全 None 为 0/标题/— 渲染 |
| tests/test_serve_asset.py | 2 | 路径穿越拒绝/正常资产放行 |
| tests/test_heal.py | 2 | 自愈不碰 git/不伪造 fixed 状态 |

## 三、真实数据链路验证（关键证据）

16:40–16:41 首次真实运行全部成功：

1. `discover_content.py --keyword "独立开发" --platforms bilibili` → **10 条真实候选**
   （如 "iOS 独立开发从 0 到 1" 评论 0、"8 个品类 2614 款新游数据…" 等）
2. `e2e_test.py` 6/6 步骤通过：discover 2.0s → crawl 27.2s（**36 条真实评论入库**，
   2 个视频返回 -404 被优雅跳过）→ mine → score → mvp → export
3. `demo.py` 离线链路：样本 → 痛点簇 → 卡片（80.0/A 档，仅 demand+feasibility 两维，
   其余维度诚实显示 —）→ dashboard.json 正确聚合

## 四、真实世界约束记录（非代码缺陷）

- **B站搜索风控（v_voucher）**：连续请求后搜索接口返回 `code=0, data={v_voucher:...}`
  （人机验证票据）。已按合规红线处理：明确抛错告知“IP 被风控，稍后重试或配置
  BILI_SESSDATA”，**不绕过验证码**。评论接口在搜索被风控后仍可用（实测拿到 5 条真实评论）。
- 建议实际使用时间隔运行，或配置 BILI_SESSDATA 登录态降低风控概率。

## 五、修复清单（对应初始评估）

| 初始评估问题 | 处置 |
|---|---|
| B站 WBI 签名缺失（P0） | 手写 WBI 签名 + wbi/search/type 端点，实测可用 |
| 评论分页用页码非游标（P0） | 改 data.cursor.next 游标翻页 |
| run_all 只分析最后一个视频（P0） | collect_raw_files + merge_jsonl_records 全量合并（since 过滤只取本次 run） |
| Windows cp936 emoji 崩溃（P0） | ensure_utf8 + fix_utf8 补丁（32 个入口），cp936 子进程测试实证 |
| discover_content 导入即崩（评估后新发现 P0） | 5 适配器统一 flat 导入 |
| demo.py eager glob 崩溃（新发现 P0） | 顺序执行 + 冒烟测试 |
| 评分恒定假冒维度（P1） | 启发式只输出有数据维度；None 渲染 — |
| serve.py 路径穿越（P1） | resolve_asset + 403 |
| 自愈假修复+自动 push（P1） | 只读诊断报告模式，workflow 去定时去推送 |
| apply_fixes 补丁标记撞车（过程中新发现） | 标记改唯一新代码文本 + CLI 接线护栏测试 |

## 六、复现方式

```bash
# 从 MVP.md 重新生成全部（单一事实源 generate_p*.py + overlay 权威）
cd pain-to-mvp
python generators/extract_generators.py      # 首次冷启动：从 ../MVP.md 提取 P0-P6
                                             # ⚠️ 会警告模板修复被覆盖（正常，overlay 会恢复）
for i in 0 1 2 3 4 5 6; do python generators/generate_p$i.py; done
python generators/apply_fixes.py             # 恢复全部修复（bilibili/demo 为 overlay 权威）
python -m pytest tests/                      # 32 passed
python scripts/demo.py                       # 离线演示
python scripts/e2e_test.py --keyword "独立开发" --platform bilibili --limit 10 --comments 100
python scripts/dashboard/serve.py --port 8787  # 看板
```

## 五补、终审修复（whole-branch review 后，32 tests）

| 评审发现 | 处置 |
|---|---|
| C1 extract 覆盖模板修复致复现路径失效 | bilibili/demo 修复移入 apply_fixes overlay + extract 覆盖警告 + 4 个护栏测试；实测 extract→生成→修复→32/32 绿 |
| I1 safe_filename 未接线（`/` 关键词 traceback） | discover/run_all/e2e 三处接线 + CLI 回归测试 |
| I2 storage 入库数虚报（total_changes 语义） | 改 cursor.rowcount + 测试（RED: 报 3 实 2） |
| I3 测试污染用户真实产出 | conftest session 快照还原；实测 pytest 后 data/ 零改动 |
| 补丁标记三次写错 | apply_fixes 幂等冒烟测试（重跑必须零改动） |

## 七、遗留与建议（下轮候选）

1. B站搜索风控后的可用性策略：分批关键词、SESSDATA 配置指引写入 USAGE.md
2. rank_score 时效权重（30）与评论量（50）比例导致零评论新视频排前——建议调权
3. 小红书/抖音适配器仍是纸面实现（MediaCrawler/TikTokDownloader 需实测对接）
4. 卡片 ID 同日多次运行会互相覆盖（`{日期}-{i:03d}` 序号每次从 001 起）——建议加时间戳
5. write_dashboard 重建不保留 timeline/next_action（与 export_card 双写路径竞争）
