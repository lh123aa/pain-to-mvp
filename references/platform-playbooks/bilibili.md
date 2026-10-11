# B站 Playbook

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
