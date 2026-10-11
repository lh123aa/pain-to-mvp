# YouTube Playbook

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
