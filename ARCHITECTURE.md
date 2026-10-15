# 架构说明

## 一、整体架构

```
┌──────────────────────────────────────────────────────────┐
│                     输入层                                │
│  模糊输入（关键词/领域/账号/话题）                          │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                  工具智能层                                │
│  discover → evaluate → compose → update                  │
│  （不造轮子，先找、再评、再组、最后才写）                    │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                   Pipeline                                │
│  Phase 2: 内容发现（discover_content.py）                  │
│  Phase 3: 内容筛选（pipeline_score.py）                    │
│  Phase 4: 评论爬取（crawl_comments.py + adapters）         │
│  Phase 5: 痛点挖掘（mine_pain_points.py）                  │
│  Phase 6: 机会评分（score_opportunity.py）                 │
│  Phase 7: MVP 设计（design_mvp.py）                        │
│  Phase 8: 卡片导出（export_card.py）                       │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                  记录与自愈                                │
│  Journey Logger：项目历程（可教学、可传承）                  │
│  Self-Healing：Bug 日志 + 每日自愈                          │
│  Self-Improve：执行日志 → 知识库 → 优化建议                 │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                  展示层                                    │
│  Dashboard（HTTP 服务 + 单页 HTML + 3s 轮询）              │
│  http://localhost:8787                                    │
└──────────────────────────────────────────────────────────┘
```

## 二、数据流

```
原始评论（JSONL）
    ↓ preprocess
清洗+分词
    ↓ pain_rules
痛点信号
    ↓ cluster
痛点簇
    ↓ score_opportunity
机会分
    ↓ design_mvp
MVP方案
    ↓ export_card
Markdown卡片 + dashboard.json
    ↓ serve.py
Web 看板
```

## 三、存储结构

| 路径 | 用途 | 格式 |
|---|---|---|
| `data/raw/` | 原始评论 | JSONL |
| `data/discovered/` | 发现的内容 | JSON |
| `data/pains/` | 痛点簇 | JSON |
| `data/scored/` | 评分结果 | JSON |
| `data/cards/` | 机会卡片 | Markdown |
| `data/dashboard.json` | 看板数据源 | JSON |
| `data/journeys/` | 项目历程 | Markdown + JSON |
| `data/bugs/` | Bug 日志 | JSONL |
| `data/executions/` | 执行日志 | JSONL |
| `pain_to_mvp.db` | 评论 SQLite | SQLite |

## 四、工具组合策略

### 发现层
- B站：bilibili-API-collect（直接调 API）
- YouTube：yt-dlp
- Reddit：PRAW
- 小红书/抖音：MediaCrawler / TikTokDownloader（外部依赖）

### 爬取层
- 统一经过 `storage.save_records()`，字段标准化

### 分析层
- 预处理：jieba
- 信号识别：规则引擎（`pain_rules.py`）
- 聚类：BERTopic（主）→ TF-IDF + KMeans（兜底）
- 评分：LLM（主）→ 启发式（兜底）

### 展示层
- 零依赖：Python 标准库 `http.server`
- 前端：单 HTML + 原生 JS，3 秒轮询

## 五、自优化闭环（⚠️ 保留但未接线，不投入 — 见 docs/PRD.md §三）

```
每次任务 → log_execution.py
每日 UTC 02:00 → audit_runner.py（daily-audit.yml，处置中）
    ├─ audit_toolkit.py（巡检工具）
    ├─ sync_toolkit.py（同步文档）
    ├─ update_knowledge.py（提炼经验）
    └─ optimizer.py（生成建议）
```

> 设计上曾判定为"假闭环"（制造系统在工作的错觉），按 PRD 决策保留代码但不接入主流程；
> heal_runner 已改为只读诊断（self-heal.yml 仅手动触发，不自动 commit & push）。

## 六、安全边界（PRD §四.1 / §七）

- 遵守 robots.txt：**fail-close**——读不到 robots.txt 即跳过该平台（落地中，见 OPEN_ISSUES #1）
- 频率限制 ≤ 1 请求/秒
- 作者名 MD5 脱敏
- 数据本地存储，不上云；`data/` 产物全部 gitignore
- 凭证统一走 `.env`（gitignore），模板见 `.env.example`
- 不绕验证码（如 B站 v_voucher）、不破解登录
- Bug 自愈已改为只读诊断：不改代码、不碰 git、不自动推送

## 七、扩展点

| 想加什么 | 在哪加 |
|---|---|
| 新平台 | `scripts/pipeline/adapters/` 新建适配器 |
| 新痛点信号 | `scripts/pipeline/pain_rules.py` 的 SIGNALS |
| 新 MVP 模式 | `references/mvp-patterns.md` |
| 新评分维度 | `scripts/pipeline/score_opportunity.py` 的 WEIGHTS |
| 新工具 | `data/toolkit.json` |
