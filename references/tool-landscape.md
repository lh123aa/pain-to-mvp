# 工具全景

> 本文件由 Skill 自动维护。每次执行任务后，Agent 会更新工具状态。
> 工具分为两类：**已验证**（实际用过、可用）和 **候选**（待验证）。

---

## 一、内容发现工具

### 多平台聚合

| 工具 | 平台 | 语言 | 状态 | 说明 |
|---|---|---|---|---|
| **TrendRadar** | 35+ 平台（微博/抖音/知乎/B站等） | Python | 候选 | 热点聚合 + 关键词筛选 + MCP 架构 |
| **MediaCrawler** | 小红书/抖音/B站/微博/知乎/贴吧 | Python | 已验证 | Playwright 登录，无需 JS 逆向 |

### 单平台

| 工具 | 平台 | 状态 | 说明 |
|---|---|---|---|
| **bilibili-API-collect** | B站 | 已验证 | API 文档集合，社区维护 |
| **yt-dlp** | YouTube | 已验证 | 视频/元数据/字幕下载，支持搜索 |
| **TikTokDownloader** | 抖音/TikTok | 已验证 | 视频+评论，支持批量 |
| **Spider_XHS** | 小红书 | 候选 | 笔记+评论爬取 |
| **PRAW** | Reddit | 已验证 | 官方 API 封装 |
| **snscrape** | Twitter/Reddit 等 | 候选 | 维护不活跃，慎用 |

---

## 二、评论爬取工具

| 工具 | 平台 | 状态 | 登录 | 说明 |
|---|---|---|---|---|
| **MediaCrawler** | 小红书/抖音/B站/微博/知乎/贴吧 | 已验证 | Playwright | 主力工具，多平台评论 |
| **TikTokDownloader** | 抖音/TikTok | 已验证 | Cookie | 评论+回复 |
| **youtube-comment-downloader** | YouTube | 已验证 | 无需 | 轻量，无需 API key |
| **Spider_XHS** | 小红书 | 候选 | Cookie | 笔记详情+评论 |
| **PRAW** | Reddit | 已验证 | OAuth | 官方 API，稳定 |
| **easy-amazon-voc** | Amazon | 候选 | 无需 | 评论多维度分析 |

---

## 三、文本分析与聚类

| 工具 | 能力 | 状态 | 说明 |
|---|---|---|---|
| **Sentence Transformers** | 文本向量化 | 已验证 | 多语言模型，本地跑 |
| **BERTopic** | 语义聚类 | 已验证 | 基于 embedding，可调参 |
| **scikit-learn** | 通用聚类/分类 | 已验证 | KMeans/DBSCAN 等 |
| **jieba** | 中文分词 | 已验证 | 中文预处理必备 |
| **SnowNLP** | 中文情感分析 | 候选 | 轻量，准确率一般 |

---

## 四、浏览器自动化

| 工具 | 能力 | 状态 | 说明 |
|---|---|---|---|
| **Playwright** | 浏览器自动化 | 已验证 | 支持 Chromium/Firefox/WebKit |
| **Selenium** | 浏览器自动化 | 候选 | 老牌，配置繁琐 |
| **DrissionPage** | 浏览器自动化 | 候选 | 国产，轻量 |

---

## 五、存储与数据

| 工具 | 能力 | 状态 | 说明 |
|---|---|---|---|
| **SQLite** | 本地数据库 | 已验证 | 零配置 |
| **sqlite-utils** | SQLite 操作 | 已验证 | 命令行友好 |
| **pandas** | 数据处理 | 已验证 | 通用 |
| **JSONL** | 流式存储 | 已验证 | 追加友好 |

---

## 六、Web 展示

| 工具 | 能力 | 状态 | 说明 |
|---|---|---|---|
| **Flask** | Web 服务 | 已验证 | 轻量 |
| **http.server** | 标准库 Web | 已验证 | 零依赖 |
| **Chart.js** | 前端图表 | 已验证 | 单文件引入 |

---

## 七、AI / LLM

| 工具 | 能力 | 状态 | 说明 |
|---|---|---|---|
| **OpenAI API** | 文本生成/分析 | 已验证 | 需 API key |
| **Anthropic API** | 文本生成/分析 | 已验证 | 需 API key |
| **Ollama** | 本地 LLM | 候选 | 零成本，需硬件 |
| **sentence-transformers** | 本地 embedding | 已验证 | 零成本 |

---

## 八、工具更新记录

| 日期 | 工具 | 变更 |
|---|---|---|
| 2026-10-11 | - | 初始化 |

---

## 九、工具发现清单（待验证）

以下是 Agent 在 GitHub/PyPI 搜索到的候选工具，待实际使用后更新状态：

- 各平台最新爬虫（搜索关键词：`{platform} scraper`、`{platform} API`）
- 各平台数据导出工具
- 新的聚类/分析工具
- 新的 LLM 应用框架
