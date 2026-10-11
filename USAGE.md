# 使用手册

## 一、安装

```bash
# 1. 生成项目（依序执行 P0-P6）
python generate_p0.py
python generate_p1.py
python generate_p2.py
python generate_p3.py
python generate_p4.py
python generate_p5.py
python generate_p6.py

# 2. 安装依赖
pip install -r requirements.txt

# 3. 自检
python scripts/doctor.py
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

### 小红书 / 抖音
需要 MediaCrawler 或 TikTokDownloader：
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

## 七、Bug 自愈

```bash
# 手动记录 Bug
python scripts/healing/capture_bug.py --phase "Phase 4" --tool "MediaCrawler" --severity high --error "登录态失效"

# 触发自愈（读取 Bug 日志 → 生成修复 → 提交）
python scripts/healing/heal_runner.py
```

## 八、项目历程

```bash
# 启动历程
python scripts/journey/start_journey.py --project-id req-001 --title "独立开发者获客"

# 记录阶段
python scripts/journey/log_stage.py --project-id req-001 --phase "Phase 4" --actions "爬取B站评论" --tools "MediaCrawler" --problems "登录态失效" --solutions "重新登录" --outputs "342条评论"
```

## 九、GitHub Actions

把项目推到 GitHub 后，会自动启用：
- **self-heal.yml**：每天 08:00 / 20:00 触发 Bug 自愈
- **daily-audit.yml**：每天 UTC 02:00 触发工具巡检 + 知识库更新

需在仓库 Settings → Actions → General 开启 **Read and write** 权限。

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
