# 工具兼容性表

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
