# Pain-to-MVP

从模糊输入出发，自主发现内容、爬取评论、挖掘痛点、设计最小商业闭环，并动态展示进度。

> 当前版本：0.1.0（收敛阶段）｜ 需求见 `docs/PRD.md` ｜ 技术债见 `docs/OPEN_ISSUES.md`

## 快速开始

```bash
# 0. 安装依赖
pip install -r requirements.txt

# 1. 离线自检（内置样本，无需网络）
python scripts/doctor.py
python scripts/demo.py

# 2. 真实数据端到端（B站，无需 key）
python scripts/e2e_test.py --keyword "独立开发者" --platform bilibili --limit 10 --comments 100

# 3. 启动看板
python scripts/dashboard/serve.py --port 8787
# 浏览器访问 http://localhost:8787
```

## 目录结构

```
pain-to-mvp/
├── docs/
│   ├── PRD.md              # 需求文档（用户/验收标准/范围/NFR/契约）
│   └── OPEN_ISSUES.md      # 技术债 + 风险登记
├── generators/             # P0-P6 生成器 + apply_fixes 修复 overlay
│   ├── generate_p0.py … generate_p6.py
│   └── apply_fixes.py      # 重新生成后必跑的唯一后处理入口
├── scripts/
│   ├── pipeline/           # discover → crawl → mine → score → design → export
│   ├── dashboard/          # serve.py 看板
│   ├── healing/            # 只读诊断（未接线，不投入）
│   ├── journey/            # 历程记录（未接线，不投入）
│   ├── self_improve/       # 自优化（未接线，不投入）
│   └── tool_intelligence/  # 工具发现/评估
├── references/             # 平台手册、评分标准、MVP 模式库
├── tests/                  # 32 个测试（make test）
└── data/                   # 运行产物，全部 gitignore
```

## 重新生成代码（维护者须知）

本仓库代码由 `MVP.md`（原始规格，只读）经生成器产出，修复以 overlay 形式维护：

```bash
python generators/generate_p0.py   # …依次到 generate_p6.py
python generators/apply_fixes.py  # 必跑：恢复全部修复，缺修复会主动报错
python -m pytest tests/ -q        # 必须 32 全绿
```

⚠️ 直接改 `scripts/` 下生成代码会被重新生成覆盖——修改要么进生成器模板（`generators/generate_p*.py`），要么进 `apply_fixes.py` overlay。

## 分阶段

- P0：骨架 + 模板 + 记录系统 ✅
- P1：平台手册 + 工具全景 + 关键词策略 ✅
- P2：内容发现 + 评论爬取 ✅（B站已验证）
- P3：痛点聚类 + 机会评分 ✅
- P4：工具智能层 + 自优化 ⚠️（自优化保留但未接线）
- P5：Dashboard 展示端 ✅
- P6：真实案例验证 ⏳（验收标准见 `docs/PRD.md` §二）
