
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pain-to-MVP 项目生成器 - P1
平台手册 + 工具全景 + 关键词策略 + 工具智能层
运行：python generate_p1.py
"""
from pathlib import Path

FILES = {}

# ============================================================
# references/tool-landscape.md
# ============================================================
FILES["references/tool-landscape.md"] = r'''# 工具全景

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
'''

# ============================================================
# references/tool-compatibility.md
# ============================================================
FILES["references/tool-compatibility.md"] = r'''# 工具兼容性表

> 记录哪些工具能无缝衔接。Agent 组合工具时参考此表。

---

## 一、标准数据格式

所有工具的输出应统一为以下 JSONL 格式：

```json
{
  "id": "唯一ID",
  "platform": "bilibili",
  "source_id": "视频/帖子ID",
  "source_title": "标题",
  "content": "评论/帖子内容",
  "author": "脱敏后作者",
  "likes": 0,
  "replies": 0,
  "timestamp": "ISO时间",
  "url": "原始链接"
}
```

---

## 二、工具组合流水线

### 流水线 A：B站视频 → 机会卡片

```
bilibili-API-collect（搜索）
    ↓ JSONL
MediaCrawler（爬评论）
    ↓ JSONL
jieba（分词）+ Sentence Transformers（向量化）
    ↓ 向量
BERTopic（聚类）
    ↓ 聚类结果
scoring（评分）
    ↓
card-template（卡片）
```

### 流水线 B：小红书笔记 → 机会卡片

```
Spider_XHS / MediaCrawler（搜索+爬取）
    ↓ JSONL
jieba + Sentence Transformers
    ↓
BERTopic
    ↓
scoring
    ↓
card
```

### 流水线 C：Reddit 讨论 → 机会卡片

```
PRAW（搜索+爬取）
    ↓ JSONL
Sentence Transformers
    ↓
BERTopic
    ↓
scoring
    ↓
card
```

### 流水线 D：YouTube 视频 → 机会卡片

```
yt-dlp（搜索视频）
    ↓
youtube-comment-downloader（爬评论）
    ↓ JSONL
分析流水线
```

---

## 三、兼容性矩阵

| 上游工具 | 下游工具 | 兼容性 | 备注 |
|---|---|---|---|
| MediaCrawler | BERTopic | ✅ | 输出 JSONL，需清洗 |
| yt-dlp | youtube-comment-downloader | ✅ | 共享 video_id |
| PRAW | BERTopic | ✅ | 需转为标准格式 |
| TikTokDownloader | BERTopic | ✅ | 需字段映射 |
| BERTopic | scoring | ✅ | 聚类结果直接消费 |

---

## 四、字段映射表

不同工具的字段名不同，需要映射到标准格式：

| 标准字段 | MediaCrawler | PRAW | yt-comment-dl | TikTokDownloader |
|---|---|---|---|---|
| id | comment_id | id | cid | cid |
| content | content | body | text | text |
| author | nickname | author | author | user |
| likes | like_count | score | votes | digg_count |
| timestamp | create_time | created_utc | time | create_time |
| url | - | permalink | - | - |

---

## 五、更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-11 | 初始化 |
'''

# ============================================================
# references/platform-playbooks/douyin.md
# ============================================================
FILES["references/platform-playbooks/douyin.md"] = r'''# 抖音 Playbook

## 一、内容发现

### 搜索入口
- 关键词搜索：`https://www.douyin.com/search/{keyword}`
- 话题页：`https://www.douyin.com/hashtag/{tag}`
- 达人主页：`https://www.douyin.com/user/{sec_uid}`

### 筛选标准
- 评论数 > 100
- 点赞/评论比异常（争议度高）
- 发布时间 < 6 个月
- 评论区出现"求""怎么""有没有"高频

### 工具
- TikTokDownloader（主力）
- MediaCrawler（备用）

---

## 二、评论爬取

### 字段
- cid、text、user、digg_count、create_time、reply_count

### 反爬要点
- 需要 Cookie（登录态）
- 请求频率 ≤ 1/秒
- 使用随机 User-Agent
- 分页用 cursor，不用 offset

### 降级策略
1. TikTokDownloader 失败 → MediaCrawler
2. MediaCrawler 失败 → Playwright 手动模拟
3. 全部失败 → 提示用户提供 Cookie

---

## 三、痛点信号

高频词：
- "怎么""求""有没有""为什么"
- "太贵了""不好用""找不到"
- "有没有人知道"

---

## 四、合规

- 只爬公开内容
- 不爬私密账号
- 遵守 robots.txt
- 频率限制
'''

# ============================================================
# references/platform-playbooks/xiaohongshu.md
# ============================================================
FILES["references/platform-playbooks/xiaohongshu.md"] = r'''# 小红书 Playbook

## 一、内容发现

### 搜索入口
- 关键词搜索：`https://www.xiaohongshu.com/search_result?keyword={kw}`
- 话题页：`https://www.xiaohongshu.com/page/topics/{topic}`
- 用户主页：`https://www.xiaohongshu.com/user/profile/{user_id}`

### 筛选标准
- 点赞 > 500 或评论 > 50
- 笔记类型：求助/吐槽/对比/测评
- 发布时间 < 6 个月

### 工具
- MediaCrawler（主力）
- Spider_XHS（备用）

---

## 二、评论爬取

### 字段
- comment_id、content、nickname、like_count、create_time、sub_comments

### 反爬要点
- 必须登录（Playwright 扫码）
- 登录态约 2 小时失效，需刷新
- 请求频率 ≤ 1/秒
- 注意 `x-s` / `x-t` 签名（MediaCrawler 已处理）

### 降级策略
1. MediaCrawler 失败 → Spider_XHS
2. 登录失效 → 重新扫码
3. 全部失败 → 提示用户

---

## 三、痛点信号

小红书用户表达更情绪化，注意识别：
- "姐妹们""求助""踩雷"
- "有没有平替""求推荐"
- "后悔""踩坑""避雷"

---

## 四、合规

- 只爬公开笔记
- 不爬私密内容
- 遵守平台条款
'''

# ============================================================
# references/platform-playbooks/bilibili.md
# ============================================================
FILES["references/platform-playbooks/bilibili.md"] = r'''# B站 Playbook

## 一、内容发现

### 搜索入口
- 关键词搜索：`https://search.bilibili.com/all?keyword={kw}`
- 分区排行：`https://www.bilibili.com/v/popular/rank/{zone}`
- UP主主页：`https://space.bilibili.com/{mid}`

### 筛选标准
- 评论 > 100
- 弹幕密度高
- 发布时间 < 6 个月

### 工具
- bilibili-API-collect（API 文档）
- MediaCrawler（爬取）

---

## 二、评论爬取

### 字段
- rpid、content、uname、like、ctime、rcount

### 反爬要点
- 需要 Cookie（SESSDATA）
- 评论分页用 next 游标
- 请求频率 ≤ 1/秒
- 注意 WBI 签名（MediaCrawler 已处理）

### 降级策略
1. MediaCrawler → 直接调用 API
2. API 失败 → Playwright 模拟
3. 全部失败 → 提示用户提供 SESSDATA

---

## 三、痛点信号

B站用户偏技术/学习/娱乐：
- "有没有教程""求源码"
- "为什么""原理是什么"
- "踩坑""报错"

---

## 四、合规

- 只爬公开评论
- 遵守 robots.txt
'''

# ============================================================
# references/platform-playbooks/youtube.md
# ============================================================
FILES["references/platform-playbooks/youtube.md"] = r'''# YouTube Playbook

## 一、内容发现

### 搜索入口
- 关键词搜索：`https://www.youtube.com/results?search_query={kw}`
- 频道页：`https://www.youtube.com/@{channel}`
- 趋势：`https://www.youtube.com/feed/trending`

### 筛选标准
- 评论 > 100
- 点赞/评论比异常
- 发布时间 < 12 个月

### 工具
- yt-dlp（搜索+元数据）
- youtube-comment-downloader（评论）

---

## 二、评论爬取

### 字段
- cid、text、author、votes、time、reply_count

### 反爬要点
- youtube-comment-downloader 无需 API key
- 大量爬取可能触发限流
- 请求频率 ≤ 2/秒

### 降级策略
1. youtube-comment-downloader → yt-dlp 提取评论
2. 限流 → 延迟重试
3. 全部失败 → YouTube Data API v3（需 key）

---

## 三、痛点信号

英文用户：
- "how do I""anyone know""why doesn't"
- "too expensive""doesn't work""frustrating"

---

## 四、合规

- 遵守 YouTube ToS
- 不爬私密视频
'''

# ============================================================
# references/platform-playbooks/reddit.md
# ============================================================
FILES["references/platform-playbooks/reddit.md"] = r'''# Reddit Playbook

## 一、内容发现

### 搜索入口
- 全站搜索：`https://www.reddit.com/search/?q={kw}`
- Subreddit：`https://www.reddit.com/r/{sub}`
- 热榜：`https://www.reddit.com/r/{sub}/hot`

### 筛选标准
- upvotes > 50 或 comments > 20
- 时间 < 12 个月
- 排除广告/推广

### 工具
- PRAW（主力，官方 API）
- pushshift（已关闭公共访问，慎用）

---

## 二、评论爬取

### 字段
- id、body、author、score、created_utc、permalink

### 反爬要点
- PRAW 需 OAuth（client_id/secret）
- 免费额度：100 QPM
- 遵守 Reddit API 条款

### 降级策略
1. PRAW → 官方 API 直接调用
2. 限流 → 延迟重试
3. 全部失败 → 提示用户配置

---

## 三、痛点信号

英文用户，技术/产品/生活类：
- "I wish""why is there no""how do you"
- "frustrating""annoying""hate"

---

## 四、合规

- 遵守 Reddit API ToS
- 不爬私密 subreddit
- 不存储用户身份
'''

# ============================================================
# references/platform-playbooks/amazon.md
# ============================================================
FILES["references/platform-playbooks/amazon.md"] = r'''# Amazon Playbook

## 一、内容发现

### 搜索入口
- 关键词搜索：`https://www.amazon.com/s?k={kw}`
- 类目 Best Sellers
- 竞品 ASIN 页

### 筛选标准
- 评论 > 100
- 评分 < 4.0（差评多）
- 近期评论多

### 工具
- easy-amazon-voc（候选）
- 自建爬虫（Playwright）

---

## 二、评论爬取

### 字段
- review_id、title、body、rating、author、date、verified

### 反爬要点
- Amazon 反爬严格
- 需要住宅代理
- 频率 ≤ 0.5/秒
- 建议使用官方 Product Advertising API

### 降级策略
1. easy-amazon-voc → 自建爬虫
2. 被限流 → 换代理
3. 全部失败 → 提示用户

---

## 三、痛点信号

- "broke after""doesn't work""waste of money"
- "wish it had""missing""disappointed"

---

## 四、合规

- 遵守 Amazon ToS
- 不爬私密数据
'''

# ============================================================
# references/anti-crawl-notes.md
# ============================================================
FILES["references/anti-crawl-notes.md"] = r'''# 反爬应对笔记

> 本文件由 Agent 自动维护。每次遇到新的反爬策略，更新此文件。

---

## 一、通用策略

| 策略 | 做法 |
|---|---|
| 请求频率 | ≤ 1 请求/秒，随机延迟 0.5-2s |
| User-Agent | 轮换真实 UA |
| Cookie | 优先用官方 API，其次用登录态 |
| 代理 | 住宅代理 > 数据中心代理 |
| 重试 | 指数退避（1s, 2s, 4s, 8s） |
| 分页 | 用游标，不用 offset |

---

## 二、平台特定

### 抖音
- 需要 Cookie
- 签名参数：`X-Bogus`、`_signature`（TikTokDownloader 已处理）
- 频繁请求会触发验证码

### 小红书
- 需要登录（Playwright 扫码）
- 签名：`x-s`、`x-t`（MediaCrawler 已处理）
- 登录态约 2 小时失效

### B站
- 需要 SESSDATA
- WBI 签名（MediaCrawler 已处理）
- 评论 API：`/x/v2/reply/wbi/main`

### YouTube
- 无需登录
- 大量请求会限流
- 建议用 youtube-comment-downloader

### Reddit
- 官方 API 100 QPM
- 需 OAuth
- User-Agent 必须唯一

### Amazon
- 反爬最严
- 建议住宅代理
- 频率 ≤ 0.5/秒

---

## 三、降级策略

```
正常爬取
    ↓ 被限流
降低频率 + 延迟
    ↓ 仍失败
切换代理
    ↓ 仍失败
换平台/换工具
    ↓ 仍失败
提示用户提供 Cookie 或人工介入
```

**绝不**：绕过验证码、破解登录、使用黑产代理。

---

## 四、更新记录

| 日期 | 平台 | 新策略 |
|---|---|---|
| 2026-10-11 | - | 初始化 |
'''

# ============================================================
# references/keyword-expansion.md
# ============================================================
FILES["references/keyword-expansion.md"] = r'''# 关键词扩展策略

## 一、扩展维度

| 维度 | 示例（输入："独立开发者获客"） |
|---|---|
| 同义词 | 独立开发者 / 独立创业 / 一人公司 / 个人开发者 |
| 长尾词 | 独立开发者怎么获客 / 独立开发者第一批用户 |
| 问题词 | 独立开发者获客难 / 独立开发者没有用户 |
| 场景词 | 独立开发者 Product Hunt / 独立开发者 SEO |
| 情绪词 | 独立开发者焦虑 / 独立开发者迷茫 |
| 竞品词 | 独立开发者 Indie Hackers / 独立开发者 即刻 |
| 平台词 | 独立开发者 小红书 / 独立开发者 B站 |
| 英文词 | indie hacker marketing / solo founder acquisition |

---

## 二、扩展方法

### 方法 A：规则扩展（无需 LLM）
- 加前缀："怎么""如何""为什么""有没有"
- 加后缀："难""方法""工具""案例"
- 组合词：输入词 × 平台词 × 情绪词

### 方法 B：LLM 扩展（有 API key 时）
调用 LLM，提示词：

```
你是关键词研究专家。给定一个主题，生成 20 个相关搜索词。
要求：
1. 覆盖同义词、长尾词、问题词、场景词、情绪词
2. 中文 10 个，英文 10 个
3. 每个词标注意图：找方案 / 找工具 / 找案例 / 发泄情绪
4. 输出 JSON 格式

主题：{input}
```

### 方法 C：平台联想（爬取时）
- 抖音/小红书搜索框的下拉联想
- B站搜索的"大家还在搜"
- YouTube 搜索的自动补全
- Google 的 "People also ask"

---

## 三、关键词优先级

| 优先级 | 类型 | 理由 |
|---|---|---|
| P0 | 问题词 + 情绪词 | 痛点最密集 |
| P1 | 长尾词 + 场景词 | 人群精准 |
| P2 | 同义词 + 竞品词 | 扩大覆盖 |
| P3 | 平台词 + 英文词 | 补充 |

---

## 四、更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-11 | 初始化 |
'''

# ============================================================
# references/scoring-rubric.md
# ============================================================
FILES["references/scoring-rubric.md"] = r'''# 机会评分标准

## 一、五维评分

### 1. 需求强度（Demand）1-5

| 分 | 判断标准 |
|---|---|
| 5 | 用户明确说"我愿意付费"，或已有付费替代品 |
| 4 | 用户反复抱怨，情绪强烈 |
| 3 | 用户提到但情绪一般 |
| 2 | 用户偶尔提及 |
| 1 | 只是好奇，不是真需求 |

### 2. 竞争空缺（Competition）1-5

| 分 | 判断标准 |
|---|---|
| 5 | 没有现成方案，或现有方案极差 |
| 4 | 有方案但贵/难用/不精准 |
| 3 | 有方案，但还有改进空间 |
| 2 | 竞争激烈，但有差异化空间 |
| 1 | 红海，无明显空缺 |

### 3. 个人可行性（Feasibility）1-5

| 分 | 判断标准 |
|---|---|
| 5 | 一个人 + AI，1 周内可做出 MVP |
| 4 | 1 个月内可做出 |
| 3 | 需要 2-3 个月 |
| 2 | 需要团队或资金 |
| 1 | 需要重资产 |

### 4. 触达难度（Reach）1-5

| 分 | 判断标准 |
|---|---|
| 5 | 用户聚集在明确渠道，可低成本触达 |
| 4 | 有明确渠道，需一定成本 |
| 3 | 渠道分散，需投入 |
| 2 | 触达成本高 |
| 1 | 找不到用户 |

### 5. AI 杠杆（AI Leverage）1-5

| 分 | 判断标准 |
|---|---|
| 5 | AI 能把成本降低 10 倍以上 |
| 4 | AI 能降低 5-10 倍 |
| 3 | AI 能降低 2-5 倍 |
| 2 | AI 帮助有限 |
| 1 | AI 几乎无帮助 |

---

## 二、综合分计算

```
总分 = 需求强度 × 30
     + 竞争空缺 × 20
     + 个人可行性 × 20
     + 触达难度 × 15
     + AI杠杆 × 15
```

满分 500，归一化到 100。

### 分档

| 分数 | 档位 | 行动 |
|---|---|---|
| 85-100 | S | 立即验证 |
| 70-84 | A | 优先验证 |
| 55-69 | B | 观察 |
| 40-54 | C | 记录，暂不行动 |
| < 40 | D | 放弃 |

---

## 三、加分项 / 减分项

### 加分
- 用户已在为类似方案付费：+10
- 有明确的社群/渠道：+5
- 你能持续做 3 年：+5

### 减分
- 依赖单一平台：-10
- 需要大量人工交付：-10
- 法律/合规风险：-20

---

## 四、更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-11 | 初始化 |
'''

# ============================================================
# references/mvp-patterns.md
# ============================================================
FILES["references/mvp-patterns.md"] = r'''# 最小商业闭环模式库

## 一、个人可做的 MVP 类型

| 类型 | 交付物 | 成本 | 周期 | 适合 |
|---|---|---|---|---|
| **咨询** | 1对1 通话 | ¥0 | 1天 | 有经验的人 |
| **模板** | Notion/Excel/PPT | ¥0 | 3天 | 有方法论的人 |
| **提示词库** | Markdown/PDF | ¥0 | 3天 | 懂 AI 的人 |
| **小工具** | 单文件 HTML | ¥0 | 1周 | 会编程的人 |
| **课程** | 视频/图文 | ¥0 | 2周 | 有体系的人 |
| **社群** | 微信群/Discord | ¥0 | 1周 | 有影响力的人 |
| **代做服务** | 人工+AI | ¥0 | 即时 | 有时间的人 |
| **导航站** | 静态网页 | ¥0 | 3天 | 会整理的人 |
| **数据报告** | PDF | ¥0 | 1周 | 会分析的人 |

---

## 二、收入层设计

### 杠铃策略

```
底层：现金流服务（咨询/代做/陪跑）→ 养活自己
中层：可复用产品（模板/课程/工具）→ 积累复利
顶层：社群/订阅/数据/品牌 → 探索期权
```

### 三三制

- 1/3 时间：服务，换洞察和现金
- 1/3 时间：内容，换流量和信任
- 1/3 时间：产品，换可扩展收入

---

## 三、验证路径模板

### 7 天验证

| 天 | 动作 | 目标 |
|---|---|---|
| Day 1 | 找 10 个目标用户 | 建立联系 |
| Day 2 | 访谈 3 个 | 确认痛点 |
| Day 3 | 做最小交付物 | 一页文档/一次咨询 |
| Day 4 | 尝试收 100 元 | 验证付费意愿 |
| Day 5 | 交付 + 收集反馈 | 迭代 |
| Day 6 | 再找 5 个 | 验证可复制性 |
| Day 7 | 复盘 | 决定继续/放弃 |

### 判断标准

- 客户能在 1 天内理解价值吗？
- 你能在 1 周内交付吗？
- 毛利能超过 50% 吗？
- 交付能模板化或 AI 化吗？
- 有复购或转介绍吗？
- 你愿意做 3 年吗？

---

## 四、技术栈推荐

| 需求 | 推荐 | 理由 |
|---|---|---|
| 落地页 | GitHub Pages + 单 HTML | 零成本 |
| 支付 | Stripe / 爱发电 / 小报童 | 无需备案 |
| 邮件 | Buttondown / Substack | 免费 |
| 社群 | 微信群 / Discord | 零成本 |
| 表单 | Tally / 金数据 | 免费 |
| 数据 | SQLite / JSONL | 本地 |
| 部署 | Vercel / Cloudflare Pages | 免费 |

---

## 五、更新记录

| 日期 | 变更 |
|---|---|
| 2026-10-11 | 初始化 |
'''

# ============================================================
# scripts/tool_intelligence/discover_tools.py
# ============================================================
FILES["scripts/tool_intelligence/discover_tools.py"] = r'''#!/usr/bin/env python3
"""
工具发现：在 GitHub / PyPI 搜索候选工具。
用法：python discover_tools.py --need "xiaohongshu comment scraper"
"""
import argparse
import json
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path

OUTPUT = Path("data/tool_discovery.jsonl")

def search_github(query, limit=10):
    """搜索 GitHub 仓库（无需 token，有速率限制）"""
    url = f"https://api.github.com/search/repositories?q={urllib.parse.quote(query)}&sort=stars&order=desc&per_page={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "pain-to-mvp"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        results = []
        for item in data.get("items", []):
            results.append({
                "name": item["full_name"],
                "url": item["html_url"],
                "stars": item["stargazers_count"],
                "updated": item["updated_at"],
                "description": item.get("description", ""),
                "language": item.get("language", ""),
                "source": "github"
            })
        return results
    except Exception as e:
        print(f"⚠️ GitHub 搜索失败：{e}")
        return []

def search_pypi(query, limit=10):
    """搜索 PyPI 包"""
    url = f"https://pypi.org/search/?q={urllib.parse.quote(query)}"
    # PyPI 没有官方搜索 API，这里用简单 HTML 解析
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pain-to-mvp"})
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode()
        import re
        packages = re.findall(r'<a class="package-snippet" href="([^"]+)"', html)
        results = []
        for pkg in packages[:limit]:
            results.append({
                "name": pkg.strip("/").split("/")[-1],
                "url": f"https://pypi.org{pkg}",
                "source": "pypi"
            })
        return results
    except Exception as e:
        print(f"⚠️ PyPI 搜索失败：{e}")
        return []

def discover(need):
    print(f"🔍 搜索：{need}\n")
    results = []
    results.extend(search_github(need))
    results.extend(search_pypi(need))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "a", encoding="utf-8") as f:
        for r in results:
            r["query"] = need
            r["discovered_at"] = datetime.now().isoformat()
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"✅ 发现 {len(results)} 个候选工具，已写入 {OUTPUT}")
    for r in results[:5]:
        print(f"  - {r['name']} ({r.get('stars', '?')} stars)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--need", required=True, help="能力需求描述")
    args = parser.parse_args()
    discover(args.need)
'''

# ============================================================
# scripts/tool_intelligence/evaluate_tools.py
# ============================================================
FILES["scripts/tool_intelligence/evaluate_tools.py"] = r'''#!/usr/bin/env python3
"""
工具评估：按六维矩阵打分。
用法：python evaluate_tools.py --input data/tool_discovery.jsonl --output data/tool_eval.json
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

WEIGHTS = {
    "function": 0.30,
    "maintenance": 0.20,
    "install": 0.15,
    "compliance": 0.15,
    "community": 0.10,
    "composability": 0.10
}

def score_tool(tool):
    """根据工具元数据估算分数（0-100）"""
    scores = {}

    # 功能匹配度：暂用描述长度估算
    desc = tool.get("description", "") or ""
    scores["function"] = min(100, len(desc) * 2) if desc else 50

    # 维护活跃度：根据 updated 时间
    updated = tool.get("updated", "")
    if updated:
        try:
            dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            days = (datetime.now(dt.tzinfo) - dt).days
            scores["maintenance"] = max(0, 100 - days)
        except Exception:
            scores["maintenance"] = 50
    else:
        scores["maintenance"] = 50

    # 安装复杂度：默认 70（未知）
    scores["install"] = 70

    # 合规安全：默认 70
    scores["compliance"] = 70

    # 社区验证：根据 stars
    stars = tool.get("stars", 0) or 0
    scores["community"] = min(100, stars / 10)

    # 可组合性：默认 70
    scores["composability"] = 70

    total = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)
    return {"total": round(total, 1), "dimensions": scores}

def evaluate(input_file, output_file):
    tools = []
    with open(input_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                tools.append(json.loads(line))

    for tool in tools:
        tool["evaluation"] = score_tool(tool)

    tools.sort(key=lambda x: x["evaluation"]["total"], reverse=True)

    Path(output_file).parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(tools, f, ensure_ascii=False, indent=2)

    print(f"✅ 评估完成：{len(tools)} 个工具")
    for t in tools[:5]:
        print(f"  - {t['name']}: {t['evaluation']['total']}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/tool_discovery.jsonl")
    parser.add_argument("--output", default="data/tool_eval.json")
    args = parser.parse_args()
    evaluate(args.input, args.output)
'''

# ============================================================
# scripts/tool_intelligence/compose_tools.py
# ============================================================
FILES["scripts/tool_intelligence/compose_tools.py"] = r'''#!/usr/bin/env python3
"""
工具组合：根据任务阶段推荐工具组合。
用法：python compose_tools.py --stage crawl --platform xiaohongshu
"""
import argparse
import json
from pathlib import Path

# 内置组合表（可由 Agent 动态更新）
COMPOSITIONS = {
    ("discover", "xiaohongshu"): ["MediaCrawler", "Spider_XHS"],
    ("discover", "douyin"): ["TikTokDownloader", "MediaCrawler"],
    ("discover", "bilibili"): ["MediaCrawler", "bilibili-API-collect"],
    ("discover", "youtube"): ["yt-dlp"],
    ("discover", "reddit"): ["PRAW"],
    ("discover", "amazon"): ["easy-amazon-voc"],
    ("crawl", "xiaohongshu"): ["MediaCrawler"],
    ("crawl", "douyin"): ["TikTokDownloader"],
    ("crawl", "bilibili"): ["MediaCrawler"],
    ("crawl", "youtube"): ["youtube-comment-downloader"],
    ("crawl", "reddit"): ["PRAW"],
    ("crawl", "amazon"): ["easy-amazon-voc"],
    ("analyze", "*"): ["jieba", "Sentence Transformers", "BERTopic"],
    ("score", "*"): ["scoring-rubric"],
    ("output", "*"): ["card-template"],
}

def compose(stage, platform):
    key = (stage, platform)
    if key in COMPOSITIONS:
        return COMPOSITIONS[key]
    key = (stage, "*")
    if key in COMPOSITIONS:
        return COMPOSITIONS[key]
    return []

def main(stage, platform):
    tools = compose(stage, platform)
    result = {
        "stage": stage,
        "platform": platform,
        "tools": tools
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True)
    parser.add_argument("--platform", default="*")
    args = parser.parse_args()
    main(args.stage, args.platform)
'''

# ============================================================
# scripts/tool_intelligence/update_toolkit.py
# ============================================================
FILES["scripts/tool_intelligence/update_toolkit.py"] = r'''#!/usr/bin/env python3
"""
工具库更新：把评估后的工具合并进 tool-landscape.md。
用法：python update_toolkit.py --eval data/tool_eval.json
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

LANDSCAPE = Path("references/tool-landscape.md")

def update(eval_file):
    with open(eval_file, "r", encoding="utf-8") as f:
        tools = json.load(f)

    if not LANDSCAPE.exists():
        print(f"⚠️ 未找到 {LANDSCAPE}")
        return

    content = LANDSCAPE.read_text(encoding="utf-8")
    record = f"\n\n### 自动发现（{datetime.now().strftime('%Y-%m-%d')}）\n\n"
    record += "| 工具 | 分数 | 来源 | 说明 |\n|---|---|---|---|\n"
    for t in tools[:10]:
        record += f"| [{t['name']}]({t.get('url', '')}) | {t['evaluation']['total']} | {t.get('source', '')} | {t.get('description', '')[:50]} |\n"

    content += record
    LANDSCAPE.write_text(content, encoding="utf-8")
    print(f"✅ 已更新 {LANDSCAPE}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--eval", default="data/tool_eval.json")
    args = parser.parse_args()
    update(args.eval)
'''

# ============================================================
# scripts/pipeline/expand_keywords.py
# ============================================================
FILES["scripts/pipeline/expand_keywords.py"] = r'''#!/usr/bin/env python3
"""
关键词扩展：规则扩展 + 可选 LLM 扩展。
用法：python expand_keywords.py --input "独立开发者获客"
"""
import argparse
import json
import os
from pathlib import Path

# 规则扩展词表
PREFIXES = ["怎么", "如何", "为什么", "有没有", "求"]
SUFFIXES = ["难", "方法", "工具", "案例", "经验", "教程"]
EMOTIONS = ["焦虑", "迷茫", "踩坑", "后悔", "求助"]
PLATFORMS = ["小红书", "抖音", "B站", "知乎", "Reddit"]

def rule_expand(keyword):
    results = []
    for p in PREFIXES:
        results.append(f"{p}{keyword}")
    for s in SUFFIXES:
        results.append(f"{keyword}{s}")
    for e in EMOTIONS:
        results.append(f"{keyword} {e}")
    for p in PLATFORMS:
        results.append(f"{keyword} {p}")
    return list(set(results))

def llm_expand(keyword):
    """如果有 API key，用 LLM 扩展"""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return []
    try:
        import urllib.request
        prompt = f"""你是关键词研究专家。给定主题，生成20个相关搜索词。
要求：覆盖同义词、长尾词、问题词、场景词、情绪词，中英各10个。
输出JSON：{{"keywords": [{{"word": "...", "intent": "找方案/找工具/找案例/发泄情绪"}}]}}
主题：{keyword}"""
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            data=json.dumps({
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"}
            }).encode()
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
        content = data["choices"][0]["message"]["content"]
        return json.loads(content).get("keywords", [])
    except Exception as e:
        print(f"⚠️ LLM 扩展失败：{e}")
        return []

def expand(keyword):
    rule_kws = rule_expand(keyword)
    llm_kws = llm_expand(keyword)
    result = {
        "input": keyword,
        "rule_expanded": rule_kws,
        "llm_expanded": llm_kws,
        "total": len(rule_kws) + len(llm_kws)
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    expand(args.input)
'''


def generate():
    root = Path.cwd()
    print(f"📁 生成 P1 文件到：{root}\n")
    for rel_path, content in FILES.items():
        p = root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"✅ {rel_path}")

    print("\n🎉 P1 生成完成！")
    print("\n本次生成：")
    print("  - references/：工具全景、兼容性表、6 个平台手册、反爬笔记、关键词策略、评分标准、MVP 模式库")
    print("  - scripts/tool_intelligence/：工具发现、评估、组合、更新")
    print("  - scripts/pipeline/expand_keywords.py：关键词扩展")
    print("\n验证：")
    print("  python scripts/tool_intelligence/compose_tools.py --stage crawl --platform xiaohongshu")
    print("  python scripts/pipeline/expand_keywords.py --input '独立开发者获客'")
    print("\n下一步：等待 P2（内容发现 + 评论爬取）")


if __name__ == "__main__":
    generate()
