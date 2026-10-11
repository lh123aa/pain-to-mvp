# Amazon Playbook

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
