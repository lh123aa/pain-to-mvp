---
name: pain-to-mvp
description: 从模糊输入出发，自主发现内容、爬取评论、挖掘痛点、设计最小商业闭环，并动态展示进度。具备工具智能、自优化、项目历程记录和 Bug 自愈能力。
version: 5.0.0
tags: [机会挖掘, 痛点分析, MVP设计, 自优化, 自愈系统]
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
9. 记录项目历程
10. 自动修复系统 Bug

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

## 五、记录系统

### 5.1 项目历程（Journey Logger）

每个项目开启时，自动创建 `data/journeys/{project_id}/`，记录：

- `journey.md`：人类可读的工作日志
- `journey.json`：结构化数据
- `decisions.md`：关键决策
- `lessons.md`：反思与经验
- `course-outline.md`：自动生成的课程大纲

每个 Phase 结束时调用 `log_stage.py` 追加记录。

### 5.2 Bug 自愈（Self-Healing）

运行中任何异常自动写入 `data/bugs/bug-log.jsonl`。

每天 08:00 / 20:00 触发 `heal_runner.py`：

1. 读取日志
2. 分类 Bug
3. 生成修复方案
4. 备份 → 应用 → 测试
5. 通过则提交 GitHub，失败则回滚
6. 更新 CHANGELOG 和知识库

安全边界：备份优先、高风险人工确认、失败回滚、每天最多 3 次。

## 六、展示层

```bash
python scripts/dashboard/serve.py --port 8787
```

访问：`http://localhost:8787`

看板每 3 秒轮询 `dashboard.json`，实时展示需求列表和进度。

## 七、合规与安全

- 遵守 robots.txt 和平台条款
- 只爬公开内容
- 频率限制 ≤1 请求/秒
- 数据本地处理，不上云
- 用户身份脱敏
- 支持一键清除本地数据
