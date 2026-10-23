---
id: PB-0003
type: problem
project: pain-to-mvp
title: B站评论区组件 A/B 变体卡死：UI 无法评论，改用官方 reply/add 接口
date: 2026-10-23
status: open
tags: []
links: []
confidence: high
---

# B站评论区组件 A/B 变体卡死：UI 无法评论，改用官方 reply/add 接口

- **现象**：10-23 多个 B站视频页的 `bili-comments` 持续显示 spinner（shadow DOM 内只有「评论 + spinner」），无评论编辑器；页面实验参数 `comment_version_hash: bee9afe43a`；无 JS 报错；`reply/main` 读接口正常
- **判断**：B站前端 A/B 实验变体导致评论组件不加载，不是账号限制（登录 true、消息中心无警告、读接口正常）
- **处理**：在视频页内用同一登录态调用官方 `POST /x/v2/reply/add`（form: oid/type/message/plat=1/csrf=bili_jct），2 条均 code 0、success_toast=发送成功；rpid 317907625969 / 317907640897；API 复查存在、未折叠
- **约束**：接口兜底仅在 UI 不可用时使用；每次发布后必须 API 复查；若出现 -412、验证码、删除或折叠，立即停止并叫用户
- **状态**：open（UI 问题未修复，观察是否恢复）
