# 反爬应对笔记

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
