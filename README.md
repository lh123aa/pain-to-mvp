# Pain-to-MVP

从模糊输入出发，自主发现内容、爬取评论、挖掘痛点、设计最小商业闭环，并动态展示进度。

## 快速开始

```bash
# 1. 生成项目（P0）
python generate_p0.py

# 2. 启动看板（P5 完成后可用）
python scripts/dashboard/serve.py --port 8787

# 3. 浏览器访问
http://localhost:8787
```

## 目录结构

```
pain-to-mvp/
├── SKILL.md
├── README.md
├── CHANGELOG.md
├── requirements.txt
├── references/
│   ├── tool-landscape.md
│   ├── tool-compatibility.md
│   ├── platform-playbooks/
│   ├── anti-crawl-notes.md
│   ├── keyword-expansion.md
│   ├── mvp-patterns.md
│   └── scoring-rubric.md
├── scripts/
│   ├── tool_intelligence/
│   ├── pipeline/
│   ├── self_improve/
│   ├── journey/
│   ├── healing/
│   └── dashboard/
├── assets/
│   ├── card-template.md
│   ├── journey-template.md
│   ├── bug-template.md
│   ├── crawl-config.yaml
│   └── dashboard/
├── data/
│   ├── dashboard.json
│   ├── cards/
│   ├── journeys/
│   ├── bugs/
│   ├── executions/
│   └── cache/
└── .github/
    └── workflows/
        └── self-heal.yml
```

## 分阶段

- P0：骨架 + 模板 + 记录系统
- P1：平台手册 + 工具全景 + 关键词策略
- P2：内容发现 + 评论爬取
- P3：痛点聚类 + 机会评分
- P4：工具智能层 + 自优化
- P5：Dashboard 展示端
- P6：真实案例验证
