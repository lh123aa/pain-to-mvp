# 小红书 Playbook

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
