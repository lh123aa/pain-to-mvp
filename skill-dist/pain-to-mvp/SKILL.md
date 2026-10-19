---
name: pain-to-mvp
description: 中文独立开发者的需求验证工具包：查询机会报告、搜索已被挖过的需求、获取服务与定价、按关键词生成需求验证落地页。内置零依赖 MCP 服务器（存量数据演示版）。当用户提到"找需求 / 验证点子 / 机会报告 / 需求验证落地页 / 该做什么方向"时使用。
version: 0.1.0
tags: [需求验证, 机会挖掘, 独立开发, MCP]
---

# pain-to-mvp · 需求验证工具包

## 这是什么

从 B 站公开评论区挖真实需求、用「证据链 + 校准」做中文需求验证的开源工具。
本包是它的 **AI 助手接入层**：让助手直接查询报告、搜索需求、生成验证落地页。

- 仓库：https://github.com/lh123aa/pain-to-mvp
- 数据边界：本技能包为**存量数据演示版**——只读取仓库内已发布的报告/服务页；实时挖掘需运行完整管线（受数据源合规约束）

## 能做什么（工具列表）

| 工具 | 用途 |
|---|---|
| `list_reports` | 列出公开机会报告（标题/评分/评论数/一句话结论） |
| `get_report` | 读取指定报告全文（Markdown，含证据分布/原话/WTP/缺口/评分/SOP） |
| `search_reports` | 在全部报告中搜索关键词 |
| `get_service_info` | 服务说明（权益矩阵/价格/流程/FAQ） |
| `generate_landing_page` | 生成需求验证落地页（单文件 HTML，可直接部署） |

## 接入方式一：MCP（推荐）

把下面的配置加进 AI 助手的 MCP 配置（把 `<REPO>` 换成本仓库的实际路径）：

```json
{
  "mcpServers": {
    "pain-to-mvp": {
      "command": "python",
      "args": ["<REPO>/scripts/mcp_server.py"]
    }
  }
}
```

- 零依赖：服务器纯标准库实现（stdio JSON-RPC），无需安装任何包
- 也支持其他 stdio MCP 客户端：任何能启动 `python <REPO>/scripts/mcp_server.py` 的环境均可

## 接入方式二：直接运行（无 MCP 环境）

- 报告原文：`<REPO>/docs/exec-report-00*.md`
- 生成验证落地页：`python <REPO>/scripts/generate_landing_page.py --demo -o demo.html`
- 报告网页版重建：`python <REPO>/scripts/generate_reports_html.py`

## 示例对话

- 「有没有关于'推广难'的需求报告？」→ `search_reports` / `list_reports`
- 「把 001 号报告的付费意愿部分给我看看」→ `get_report`（slug=001-backend-miniprogram）
- 「帮我生成一个'后端转全栈小程序工具'的验证落地页，按钮写'预约内测'」→ `generate_landing_page`
- 「这个服务多少钱、交付什么？」→ `get_service_info`

## 合规与边界

- 全部内容来自公开评论且匿名化；不绕风控、不采集隐私——合规写进项目代码与测试
- 评分与结论为证据驱动（无 LLM 拍脑袋）；样本量不足时报告会显式标注低置信
- 用途：合法需求研究与自有产品验证

## 版本

0.1.0 · 演示数据版（报告快照 2026-10）
