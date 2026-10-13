# 使用手册

> 需求与验收标准见 `docs/PRD.md`；技术债跟踪见 `docs/OPEN_ISSUES.md`。

## 一、安装

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 自检
python scripts/doctor.py
```

代码已生成在仓库内，无需重新生成。**仅维护者**在修改生成器或 overlay 后需要：

```bash
python generators/generate_p0.py   # …依次到 generate_p6.py（会覆盖 scripts/）
python generators/apply_fixes.py  # 必跑：恢复全部修复
python -m pytest tests/ -q        # 必须 32 全绿
```

## 二、快速验证（离线）

```bash
# 用内置样本跑通全流程（不需要网络）
python scripts/demo.py

# 启动看板
python scripts/dashboard/serve.py --port 8787
# 浏览器：http://localhost:8787
```

## 三、真实数据（B站，无需 key）

```bash
# 端到端测试
python scripts/e2e_test.py --keyword "独立开发者" --platform bilibili --limit 10 --comments 100
```

## 四、常用命令

### 发现内容
```bash
python scripts/pipeline/discover_content.py --keyword "独立开发者" --platforms bilibili --limit 20
```

### 爬取评论
```bash
python scripts/pipeline/crawl_comments.py --input data/discovered/xxx.json --limit 500
```

### 挖掘痛点
```bash
python scripts/pipeline/mine_pain_points.py --input data/raw/xxx.jsonl
# 或从数据库
python scripts/pipeline/mine_pain_points.py --platform bilibili --limit 1000
```

### 机会评分
```bash
python scripts/pipeline/score_opportunity.py --input data/pains/xxx.json
# 无 API key 时用启发式
python scripts/pipeline/score_opportunity.py --input data/pains/xxx.json --no-llm
```

### MVP 设计
```bash
python scripts/pipeline/design_mvp.py --input data/scored/xxx.json
```

### 导出卡片
```bash
python scripts/pipeline/export_card.py --input data/scored/xxx_mvp.json --top 5
```

### 一键跑通
```bash
python scripts/pipeline/run_all.py --keyword "独立开发者" --platforms bilibili --limit 20 --comments 200
```

### 看板
```bash
# 从卡片重建数据
python scripts/dashboard/write_dashboard.py
# 启动服务
python scripts/dashboard/serve.py --port 8787
# 手动更新某条需求
python scripts/dashboard/update_progress.py --id 20261011-001 --status analyzing --progress 45 --stage "痛点提炼完成" --next "机会评分"
```

## 五、平台配置

> 规范（PRD §七）：所有凭证统一写仓库根 `.env`（已 gitignore，模板见 `.env.example`），不要写进脚本或截图。
> 当前代码读取 shell 环境变量；`.env` 自动读取接线见 `docs/OPEN_ISSUES.md` #10。

### 小红书 / 抖音
需要 MediaCrawler 或 TikTokDownloader（当前阶段未接入，见 PRD 范围表）：
```bash
export MEDIACRAWLER_PATH=/path/to/MediaCrawler
export TIKTOK_DOWNLOADER_PATH=/path/to/TikTokDownloader
```

### Reddit
```bash
export REDDIT_CLIENT_ID=xxx
export REDDIT_CLIENT_SECRET=xxx
```

### B站（可选，爬更多评论）
```bash
export BILI_SESSDATA=xxx
```

### LLM 评分（可选）
```bash
export OPENAI_API_KEY=sk-xxx
```

## 六、自优化

```bash
# 记录一次执行
python scripts/self_improve/log_execution.py --task "独立开发者" --phases 9 --duration 300 --outcome success --tools "MediaCrawler,BERTopic"

# 提炼经验
python scripts/self_improve/update_knowledge.py

# 生成优化建议
python scripts/self_improve/optimizer.py

# 工具巡检
python scripts/tool_intelligence/audit_toolkit.py

# 全部一起跑
python scripts/self_improve/audit_runner.py
```

## 七、Bug 诊断（只读，未接线）

> 原"自愈系统"已废弃自动修复模式（曾制造假闭环）。当前 `heal_runner.py` 只做**只读诊断**：分类 Bug、生成报告，不改代码、不碰 git。

```bash
# 手动记录 Bug
python scripts/healing/capture_bug.py --phase "Phase 4" --tool "MediaCrawler" --severity high --error "登录态失效"

# 只读诊断（读取 Bug 日志 → 分类 → 输出 data/bugs/heal-report.md）
python scripts/healing/heal_runner.py
```

真正的修复由人执行。该模块按 PRD 范围表标注"保留但不投入"。

## 八、项目历程

```bash
# 启动历程
python scripts/journey/start_journey.py --project-id req-001 --title "独立开发者获客"

# 记录阶段
python scripts/journey/log_stage.py --project-id req-001 --phase "Phase 4" --actions "爬取B站评论" --tools "MediaCrawler" --problems "登录态失效" --solutions "重新登录" --outputs "342条评论"
```

## 九、GitHub Actions

仓库含两个 workflow：

- **self-heal.yml**：已改为**手动触发**的只读诊断（原每天 08:00/20:00 定时自愈已废弃），产出报告 artifact
- **daily-audit.yml**：每天 UTC 02:00 跑工具巡检并自动 commit & push —— 与 PRD"自优化不投入"决策冲突，处置中（见 `docs/OPEN_ISSUES.md` #14）

若推到 GitHub 且需手动触发 self-heal，需在 Settings → Actions → General 开启 **Read and write** 权限。
后续将补 `test.yml`（push/PR 跑 pytest，见 OPEN_ISSUES #19）。

## 十、故障排查

| 问题 | 排查 |
|---|---|
| B站爬取失败 | 检查网络，或设置 BILI_SESSDATA |
| BERTopic 装不上 | 不影响，自动退化为 TF-IDF |
| 看板打不开 | 检查 8787 端口是否被占用 |
| 卡片为空 | 检查 data/scored/ 是否有数据 |
| 爬取被限流 | 降低频率，或设置代理 |

## 十一、目录结构

见 `ARCHITECTURE.md`。
