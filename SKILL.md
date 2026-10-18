---
name: pain-to-mvp
description: 从模糊输入出发，自主发现内容、爬取评论、挖掘痛点、设计最小商业闭环，并动态展示进度。工具智能、Bug 诊断已可用；自优化与项目历程记录保留但未接线（不投入）。
version: 0.1.0
tags: [机会挖掘, 痛点分析, MVP设计]
---

# Pain-to-MVP Skill

## 一、这个 Skill 做什么

输入一个模糊的起点（关键词、领域、账号、话题），Agent 自主完成：

1. 发现相关内容源（视频/帖子/讨论）
2. 筛选高价值内容
3. 爬取评论/讨论
4. 聚类痛点、提取证据
5. 机会评分
6. 设计最小商业闭环
7. 输出机会卡片
8. 动态展示在看板上
9. 记录项目历程（⚠️ 未接线，不投入）
10. Bug 只读诊断（⚠️ 不再自动修复）

## 二、触发条件

当用户提到以下内容时激活：

- "帮我分析这个视频的槽点"
- "从这些评论里找商机"
- "有什么隐形需求可以做成产品"
- "帮我验证一个想法"
- "最小商业闭环"
- "挖掘痛点"
- 任何涉及"从用户声音到产品机会"的任务

## 三、核心工作流

```
用户输入（模糊）
    ↓
[Phase 0] 解析输入 + 扩展关键词 + 选择平台
    ↓
[Phase 1] 工具智能层：查库 → 评估 → 组合 → 生成计划
    ↓
[Phase 2] 内容发现 → 更新 dashboard.json
    ↓
[Phase 3] 内容筛选
    ↓
[Phase 4] 评论爬取（合规检查 + 反爬降级）
    ↓
[Phase 5] 痛点挖掘 → 更新 dashboard.json
    ↓
[Phase 6] 机会评分 → 更新 dashboard.json
    ↓
[Phase 7] MVP 设计 → 更新 dashboard.json
    ↓
[Phase 8] 输出机会卡片
    ↓
[Phase 9] 项目历程记录（Journey Logger）
    ↓
[Phase 10] 自优化循环
```

## 四、工具智能层原则

决策树：

```
需要某能力
    ↓
① 查本地工具库
    ↓ 没有
② 查 GitHub / PyPI / npm
    ↓ 没有
③ 查 SaaS / API / 浏览器插件
    ↓ 没有
④ 用现有工具组合
    ↓ 不能
⑤ 最后才写最小脚本（≤100行，必须可复用）
```

关键原则：不造轮子，先找、再评、再组、最后才写。

## 五、记录系统（⚠️ 本节整体按 PRD 范围表标注：保留但未接线、不投入）

### 5.1 项目历程（Journey Logger）— 未接线

按设计保留于 `scripts/journey/`，每个项目可创建 `data/journeys/{project_id}/`：

- `journey.md`：人类可读的工作日志
- `journey.json`：结构化数据

### 5.2 Bug 诊断（只读）— 已可用

运行中异常可写入 `data/bugs/bug-log.jsonl`，`heal_runner.py` 做**只读诊断**：

1. 读取日志
2. 分类 Bug
3. 输出诊断报告（`data/bugs/heal-report.md`）

不改代码、不碰 git、不自动推送。真正的修复由人执行。

## 六、展示层

```bash
python scripts/dashboard/serve.py --port 8787
```

访问：`http://localhost:8787`

看板每 3 秒轮询 `dashboard.json`，实时展示需求列表和进度。

## 八、产物归档规则（2026-10-17 用户需求）

每个项目（关键词）的生成产物归档到独立子文件夹：

```
data/projects/{关键词}/
├── discovered/   # 发现列表（文件名 = safe_filename(关键词)_YYYYMMDD_HHMM.json）
├── pains/        # 痛点簇
├── scored/       # 评分结果
├── cards/        # 机会卡
├── raw/          # 爬取的评论（**复制件**——原件在 data/raw/，
│                 # 服务跨轮去重 #20 与本轮清单 #31，移动会导致重跑全量重爬→风控加重）
└── README.md     # 归档索引（自动刷新）
```

- e2e 收尾自动执行归档（`organize_project.py --run`，归档失败即整体失败）
- 历史归位：`python scripts/pipeline/organize_project.py --migrate`（一次性；
  无归属文件进 `data/projects/_待认领/`，不硬安给任何项目）
- 看板/校准读取路径：`data/cards/`（迁移前）+ `data/projects/*/cards/`（归档后），两者都读
- `data/dashboard.json` 留在根目录（全局看板，不按项目分）
- 幂等：重复执行不重复搬移、不覆盖

## 九、合规与安全（PRD §七）

- 遵守 robots.txt 和平台条款：**fail-close**（读不到 robots.txt 即跳过该平台）
- 只爬公开内容
- 频率限制 ≤1 请求/秒
- 数据本地处理，不上云；`data/` 产物不入库
- 用户身份脱敏
- 凭证统一走 `.env`，不绕验证码、不破解登录
- 支持一键清除本地数据
