# Reddit Playbook

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
