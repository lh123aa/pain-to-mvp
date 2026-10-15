# 抖音 Playbook

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
