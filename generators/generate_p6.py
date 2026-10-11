
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pain-to-MVP 项目生成器 - P6
端到端测试 + 真实案例验证 + 项目收尾文档 + 自检工具
运行：python generate_p6.py
"""
from pathlib import Path

FILES = {}

# ============================================================
# scripts/doctor.py
# ============================================================
FILES["scripts/doctor.py"] = r'''#!/usr/bin/env python3
"""
系统自检：检查依赖、目录、配置、环境变量。
用法：python scripts/doctor.py
"""
import importlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

REQUIRED_DIRS = [
    "references", "references/platform-playbooks",
    "scripts", "scripts/pipeline", "scripts/pipeline/adapters",
    "scripts/tool_intelligence", "scripts/self_improve",
    "scripts/journey", "scripts/healing", "scripts/dashboard",
    "assets", "assets/dashboard",
    "data", "data/cards", "data/journeys", "data/bugs",
    "data/executions", "data/raw", "data/pains", "data/scored", "data/discovered",
]

REQUIRED_FILES = [
    "SKILL.md", "README.md", "requirements.txt",
    "references/tool-landscape.md",
    "references/scoring-rubric.md",
    "references/mvp-patterns.md",
    "assets/card-template.md",
    "scripts/pipeline/run_all.py",
    "scripts/dashboard/serve.py",
    "data/dashboard.json",
]

OPTIONAL_DEPS = {
    "requests": "HTTP 请求（B站适配器）",
    "jieba": "中文分词（预处理）",
    "sklearn": "TF-IDF 聚类（兜底）",
    "sentence_transformers": "文本向量化（BERTopic 前置）",
    "bertopic": "语义聚类（主）",
    "yt_dlp": "YouTube 搜索",
    "youtube_comment_downloader": "YouTube 评论",
    "praw": "Reddit 适配器",
    "flask": "（可选）Web 服务增强",
}

ENV_VARS = {
    "BILI_SESSDATA": "B站登录 Cookie（可选，爬评论更稳定）",
    "REDDIT_CLIENT_ID": "Reddit API（可选）",
    "REDDIT_CLIENT_SECRET": "Reddit API（可选）",
    "MEDIACRAWLER_PATH": "MediaCrawler 目录（小红书/抖音需要）",
    "TIKTOK_DOWNLOADER_PATH": "TikTokDownloader 目录（抖音需要）",
    "OPENAI_API_KEY": "LLM 评分（可选，无则启发式）",
}

def check_dirs():
    print("📁 目录检查\n")
    ok = True
    for d in REQUIRED_DIRS:
        p = ROOT / d
        if p.exists():
            print(f"  ✅ {d}")
        else:
            print(f"  ❌ {d}（缺失）")
            ok = False
    return ok

def check_files():
    print("\n📄 文件检查\n")
    ok = True
    for f in REQUIRED_FILES:
        p = ROOT / f
        if p.exists():
            size = p.stat().st_size
            print(f"  ✅ {f} ({size} bytes)")
        else:
            print(f"  ❌ {f}（缺失）")
            ok = False
    return ok

def check_deps():
    print("\n📦 依赖检查\n")
    for mod, desc in OPTIONAL_DEPS.items():
        try:
            importlib.import_module(mod)
            print(f"  ✅ {mod} — {desc}")
        except ImportError:
            print(f"  ⚪ {mod}（未装）— {desc}")
    return True

def check_env():
    print("\n🔑 环境变量检查\n")
    for var, desc in ENV_VARS.items():
        val = os.getenv(var)
        if val:
            masked = val[:4] + "***" if len(val) > 4 else "***"
            print(f"  ✅ {var}={masked} — {desc}")
        else:
            print(f"  ⚪ {var}（未设）— {desc}")
    return True

def check_imports():
    print("\n🔗 模块导入检查\n")
    sys.path.insert(0, str(ROOT / "scripts"))
    sys.path.insert(0, str(ROOT / "scripts" / "pipeline"))
    ok = True
    modules = [
        ("pipeline.preprocess", "预处理"),
        ("pipeline.pain_rules", "痛点规则"),
        ("pipeline.cluster", "聚类"),
    ]
    for mod, desc in modules:
        try:
            importlib.import_module(mod)
            print(f"  ✅ {mod} — {desc}")
        except Exception as e:
            print(f"  ❌ {mod} — {desc}：{e}")
            ok = False
    return ok

def main():
    print("=" * 50)
    print("🩺 Pain-to-MVP 系统自检")
    print("=" * 50 + "\n")

    r1 = check_dirs()
    r2 = check_files()
    check_deps()
    check_env()
    r3 = check_imports()

    print("\n" + "=" * 50)
    if r1 and r2 and r3:
        print("✅ 系统健康")
    else:
        print("⚠️ 存在问题，请根据上面提示修复")
    print("=" * 50)

if __name__ == "__main__":
    main()
'''

# ============================================================
# scripts/e2e_test.py
# ============================================================
FILES["scripts/e2e_test.py"] = r'''#!/usr/bin/env python3
"""
端到端测试：用 B站真实数据跑通全流程。
用法：
  python scripts/e2e_test.py                  # 完整跑
  python scripts/e2e_test.py --skip-crawl     # 跳过网络爬取，用已有数据
  python scripts/e2e_test.py --keyword "独立开发者" --platform bilibili
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent
PIPELINE = ROOT / "scripts" / "pipeline"

def run(cmd, desc):
    print(f"\n{'=' * 60}")
    print(f"▶️  {desc}")
    print(f"$ {' '.join(cmd)}")
    print("=" * 60)
    t0 = time.time()
    r = subprocess.run(cmd, text=True)
    dt = time.time() - t0
    status = "✅" if r.returncode == 0 else "❌"
    print(f"{status} 用时 {dt:.1f}s")
    return r.returncode == 0, dt

def latest(folder, pattern):
    files = sorted(Path(folder).glob(pattern), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None

def main(args):
    print("\n🧪 Pain-to-MVP 端到端测试\n")
    t_start = time.time()
    steps = []

    # Step 1: 发现内容
    ok, dt = run(
        [sys.executable, str(PIPELINE / "discover_content.py"),
         "--keyword", args.keyword,
         "--platforms", args.platform,
         "--limit", str(args.limit)],
        "Step 1/6：发现内容"
    )
    steps.append(("discover", ok, dt))
    if not ok:
        return _report(steps, time.time() - t_start)

    discovered = latest(ROOT / "data" / "discovered", f"{args.keyword}_*.json")
    if not discovered:
        print("❌ 未找到发现结果")
        return _report(steps, time.time() - t_start)

    # Step 2: 爬评论
    if args.skip_crawl:
        print("\n⏭️  跳过爬取（--skip-crawl）")
        raw_file = latest(ROOT / "data" / "raw", "*.jsonl")
    else:
        ok, dt = run(
            [sys.executable, str(PIPELINE / "crawl_comments.py"),
             "--input", str(discovered),
             "--limit", str(args.comments)],
            "Step 2/6：爬取评论"
        )
        steps.append(("crawl", ok, dt))
        raw_file = latest(ROOT / "data" / "raw", "*.jsonl")

    if not raw_file:
        print("❌ 未找到评论数据")
        return _report(steps, time.time() - t_start)

    # Step 3: 挖掘痛点
    ok, dt = run(
        [sys.executable, str(PIPELINE / "mine_pain_points.py"),
         "--input", str(raw_file),
         "--min-pain", "3",
         "--min-cluster", "2"],
        "Step 3/6：挖掘痛点"
    )
    steps.append(("mine", ok, dt))
    pains_file = latest(ROOT / "data" / "pains", "*.json")
    if not pains_file:
        print("❌ 未找到痛点结果")
        return _report(steps, time.time() - t_start)

    # Step 4: 机会评分
    ok, dt = run(
        [sys.executable, str(PIPELINE / "score_opportunity.py"),
         "--input", str(pains_file),
         "--no-llm"],  # 测试用启发式，避免依赖 API key
        "Step 4/6：机会评分"
    )
    steps.append(("score", ok, dt))
    scored_file = latest(ROOT / "data" / "scored", "scored_*.json")
    if not scored_file:
        print("❌ 未找到评分结果")
        return _report(steps, time.time() - t_start)

    # Step 5: MVP 设计
    ok, dt = run(
        [sys.executable, str(PIPELINE / "design_mvp.py"),
         "--input", str(scored_file)],
        "Step 5/6：MVP 设计"
    )
    steps.append(("mvp", ok, dt))
    mvp_file = Path(str(scored_file).replace(".json", "_mvp.json"))

    # Step 6: 导出卡片 + 重建看板
    if mvp_file.exists():
        ok, dt = run(
            [sys.executable, str(PIPELINE / "export_card.py"),
             "--input", str(mvp_file), "--top", "5"],
            "Step 6/6：导出卡片 + 更新看板"
        )
        steps.append(("export", ok, dt))

        # 重建看板（以卡片为准，避免重复）
        run(
            [sys.executable, str(ROOT / "scripts" / "dashboard" / "write_dashboard.py")],
            "收尾：重建 dashboard.json"
        )

    _report(steps, time.time() - t_start)
    print("\n🎉 端到端测试完成！")
    print(f"\n查看卡片：{ROOT / 'data' / 'cards'}")
    print(f"启动看板：python scripts/dashboard/serve.py --port 8787")
    print(f"浏览器：http://localhost:8787")

def _report(steps, total):
    print("\n" + "=" * 60)
    print("📊 测试报告")
    print("=" * 60)
    for name, ok, dt in steps:
        print(f"  {'✅' if ok else '❌'} {name:12s} {dt:6.1f}s")
    print(f"  {'⏱️':12s} 总计 {total:.1f}s")
    print("=" * 60)

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--keyword", default="独立开发者")
    p.add_argument("--platform", default="bilibili")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--comments", type=int, default=100)
    p.add_argument("--skip-crawl", action="store_true")
    args = p.parse_args()
    main(args)
'''

# ============================================================
# scripts/demo.py
# ============================================================
FILES["scripts/demo.py"] = r'''#!/usr/bin/env python3
"""
演示脚本：用内置样本数据跑通全流程（无需网络）。
用于快速验证系统是否正常。
用法：python scripts/demo.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SAMPLE_DIR = ROOT / "data" / "demo"
SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

# 内置样本评论（模拟从B站爬到的真实评论）
SAMPLE_COMMENTS = [
    {"id": "c1", "platform": "demo", "source_id": "demo1", "content": "独立开发者太难了，做出来的产品根本没人用", "author": "user_a", "likes": 20, "timestamp": "1700000000"},
    {"id": "c2", "platform": "demo", "source_id": "demo1", "content": "怎么找到第一批用户啊，求教", "author": "user_b", "likes": 15, "timestamp": "1700000001"},
    {"id": "c3", "platform": "demo", "source_id": "demo1", "content": "投放太贵了，学生党根本负担不起", "author": "user_c", "likes": 30, "timestamp": "1700000002"},
    {"id": "c4", "platform": "demo", "source_id": "demo1", "content": "有没有性价比高的获客渠道推荐？", "author": "user_d", "likes": 8, "timestamp": "1700000003"},
    {"id": "c5", "platform": "demo", "source_id": "demo1", "content": "这个工具的价格太高了，有没有平替", "author": "user_e", "likes": 25, "timestamp": "1700000004"},
    {"id": "c6", "platform": "demo", "source_id": "demo1", "content": "为什么我的产品没有流量，是不是SEO有问题", "author": "user_f", "likes": 12, "timestamp": "1700000005"},
    {"id": "c7", "platform": "demo", "source_id": "demo1", "content": "做独立开发半年了，一分钱没赚到，很迷茫", "author": "user_g", "likes": 50, "timestamp": "1700000006"},
    {"id": "c8", "platform": "demo", "source_id": "demo1", "content": "有没有独立开发者的社群，一个人太孤独了", "author": "user_h", "likes": 18, "timestamp": "1700000007"},
    {"id": "c9", "platform": "demo", "source_id": "demo1", "content": "求推荐一个好用的落地页模板，太贵了买不起", "author": "user_i", "likes": 22, "timestamp": "1700000008"},
    {"id": "c10", "platform": "demo", "source_id": "demo1", "content": "独立开发者怎么定价啊，定高了没人买，定低了亏本", "author": "user_j", "likes": 35, "timestamp": "1700000009"},
    {"id": "c11", "platform": "demo", "source_id": "demo1", "content": "求一个能自动生成文案的AI工具，手动写太累了", "author": "user_k", "likes": 28, "timestamp": "1700000010"},
    {"id": "c12", "platform": "demo", "source_id": "demo1", "content": "每次上线新功能都没人用，白做了", "author": "user_l", "likes": 40, "timestamp": "1700000011"},
    {"id": "c13", "platform": "demo", "source_id": "demo1", "content": "产品做出来了，不知道怎么推广，太难了", "author": "user_m", "likes": 33, "timestamp": "1700000012"},
    {"id": "c14", "platform": "demo", "source_id": "demo1", "content": "独立开发者要不要做SEO？求经验", "author": "user_n", "likes": 10, "timestamp": "1700000013"},
    {"id": "c15", "platform": "demo", "source_id": "demo1", "content": "有没有办法低成本验证产品想法，不想白做", "author": "user_o", "likes": 16, "timestamp": "1700000014"},
]

def main():
    print("🎬 Pain-to-MVP 演示（离线样本）\n")

    # 写样本
    sample_file = SAMPLE_DIR / "comments.jsonl"
    with open(sample_file, "w", encoding="utf-8") as f:
        for c in SAMPLE_COMMENTS:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"📝 写入样本：{sample_file}（{len(SAMPLE_COMMENTS)} 条）")

    # 跑痛点挖掘 → 评分 → MVP → 卡片，每步跑完再定位上一步产物（不再预先 glob）
    def latest(directory, pattern):
        files = sorted(directory.glob(pattern), key=lambda p: p.stat().st_mtime)
        if not files:
            print(f"❌ 未找到 {directory}/{pattern}")
            return None
        return files[-1]

    pipeline = ROOT / "scripts" / "pipeline"
    py = sys.executable

    def run(desc, cmd):
        print(f"\n▶️  {desc}")
        r = subprocess.run(cmd, text=True)
        if r.returncode != 0:
            print(f"❌ {desc} 失败")
            return False
        return True

    if not run("痛点挖掘", [py, str(pipeline / "mine_pain_points.py"),
                          "--input", str(sample_file),
                          "--min-pain", "3", "--min-cluster", "2"]):
        return

    pains = latest(ROOT / "data" / "pains", "*.json")
    if not pains:
        return
    if not run("机会评分", [py, str(pipeline / "score_opportunity.py"),
                          "--input", str(pains), "--no-llm"]):
        return

    scored = latest(ROOT / "data" / "scored", "scored_*.json")
    if not scored:
        return
    if not run("MVP 设计", [py, str(pipeline / "design_mvp.py"), "--input", str(scored)]):
        return

    mvp_file = Path(str(scored).replace(".json", "_mvp.json"))
    if not mvp_file.exists():
        print("❌ 未找到 MVP 结果")
        return
    if not run("导出卡片", [py, str(pipeline / "export_card.py"),
                          "--input", str(mvp_file), "--top", "5"]):
        return

    run("重建看板", [py, str(ROOT / "scripts" / "dashboard" / "write_dashboard.py")])

    print("\n🎉 演示完成！")
    print("查看卡片：data/cards/")
    print("启动看板：python scripts/dashboard/serve.py --port 8787")

if __name__ == "__main__":
    main()
'''

# ============================================================
# ARCHITECTURE.md
# ============================================================
FILES["ARCHITECTURE.md"] = r'''# 架构说明

## 一、整体架构

```
┌──────────────────────────────────────────────────────────┐
│                     输入层                                │
│  模糊输入（关键词/领域/账号/话题）                          │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                  工具智能层                                │
│  discover → evaluate → compose → update                  │
│  （不造轮子，先找、再评、再组、最后才写）                    │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                   Pipeline                                │
│  Phase 2: 内容发现（discover_content.py）                  │
│  Phase 3: 内容筛选（pipeline_score.py）                    │
│  Phase 4: 评论爬取（crawl_comments.py + adapters）         │
│  Phase 5: 痛点挖掘（mine_pain_points.py）                  │
│  Phase 6: 机会评分（score_opportunity.py）                 │
│  Phase 7: MVP 设计（design_mvp.py）                        │
│  Phase 8: 卡片导出（export_card.py）                       │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                  记录与自愈                                │
│  Journey Logger：项目历程（可教学、可传承）                  │
│  Self-Healing：Bug 日志 + 每日自愈                          │
│  Self-Improve：执行日志 → 知识库 → 优化建议                 │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│                  展示层                                    │
│  Dashboard（HTTP 服务 + 单页 HTML + 3s 轮询）              │
│  http://localhost:8787                                    │
└──────────────────────────────────────────────────────────┘
```

## 二、数据流

```
原始评论（JSONL）
    ↓ preprocess
清洗+分词
    ↓ pain_rules
痛点信号
    ↓ cluster
痛点簇
    ↓ score_opportunity
机会分
    ↓ design_mvp
MVP方案
    ↓ export_card
Markdown卡片 + dashboard.json
    ↓ serve.py
Web 看板
```

## 三、存储结构

| 路径 | 用途 | 格式 |
|---|---|---|
| `data/raw/` | 原始评论 | JSONL |
| `data/discovered/` | 发现的内容 | JSON |
| `data/pains/` | 痛点簇 | JSON |
| `data/scored/` | 评分结果 | JSON |
| `data/cards/` | 机会卡片 | Markdown |
| `data/dashboard.json` | 看板数据源 | JSON |
| `data/journeys/` | 项目历程 | Markdown + JSON |
| `data/bugs/` | Bug 日志 | JSONL |
| `data/executions/` | 执行日志 | JSONL |
| `pain_to_mvp.db` | 评论 SQLite | SQLite |

## 四、工具组合策略

### 发现层
- B站：bilibili-API-collect（直接调 API）
- YouTube：yt-dlp
- Reddit：PRAW
- 小红书/抖音：MediaCrawler / TikTokDownloader（外部依赖）

### 爬取层
- 统一经过 `storage.save_records()`，字段标准化

### 分析层
- 预处理：jieba
- 信号识别：规则引擎（`pain_rules.py`）
- 聚类：BERTopic（主）→ TF-IDF + KMeans（兜底）
- 评分：LLM（主）→ 启发式（兜底）

### 展示层
- 零依赖：Python 标准库 `http.server`
- 前端：单 HTML + 原生 JS，3 秒轮询

## 五、自优化闭环

```
每次任务 → log_execution.py
每日 UTC 02:00 → audit_runner.py
    ├─ audit_toolkit.py（巡检工具）
    ├─ sync_toolkit.py（同步文档）
    ├─ update_knowledge.py（提炼经验）
    └─ optimizer.py（生成建议）
GitHub Actions 自动 commit & push
```

## 六、安全边界

- 遵守 robots.txt
- 频率限制 ≤ 1 请求/秒
- 作者名 MD5 脱敏
- 数据本地存储，不上云
- Bug 自愈每天最多 3 次，失败自动回滚
- 高风险修复需人工确认

## 七、扩展点

| 想加什么 | 在哪加 |
|---|---|
| 新平台 | `scripts/pipeline/adapters/` 新建适配器 |
| 新痛点信号 | `scripts/pipeline/pain_rules.py` 的 SIGNALS |
| 新 MVP 模式 | `references/mvp-patterns.md` |
| 新评分维度 | `scripts/pipeline/score_opportunity.py` 的 WEIGHTS |
| 新工具 | `data/toolkit.json` |
'''

# ============================================================
# USAGE.md
# ============================================================
FILES["USAGE.md"] = r'''# 使用手册

## 一、安装

```bash
# 1. 生成项目（依序执行 P0-P6）
python generate_p0.py
python generate_p1.py
python generate_p2.py
python generate_p3.py
python generate_p4.py
python generate_p5.py
python generate_p6.py

# 2. 安装依赖
pip install -r requirements.txt

# 3. 自检
python scripts/doctor.py
```

## 二、快速验证（离线）

```bash
# 用内置样本跑通全流程（不需要网络）
python scripts/demo.py

# 启动看板
python scripts/dashboard/serve.py --port 8787
# 浏览器：http://localhost:8787
```

## 三、真实数据（B站，无需 key）

```bash
# 端到端测试
python scripts/e2e_test.py --keyword "独立开发者" --platform bilibili --limit 10 --comments 100
```

## 四、常用命令

### 发现内容
```bash
python scripts/pipeline/discover_content.py --keyword "独立开发者" --platforms bilibili --limit 20
```

### 爬取评论
```bash
python scripts/pipeline/crawl_comments.py --input data/discovered/xxx.json --limit 500
```

### 挖掘痛点
```bash
python scripts/pipeline/mine_pain_points.py --input data/raw/xxx.jsonl
# 或从数据库
python scripts/pipeline/mine_pain_points.py --platform bilibili --limit 1000
```

### 机会评分
```bash
python scripts/pipeline/score_opportunity.py --input data/pains/xxx.json
# 无 API key 时用启发式
python scripts/pipeline/score_opportunity.py --input data/pains/xxx.json --no-llm
```

### MVP 设计
```bash
python scripts/pipeline/design_mvp.py --input data/scored/xxx.json
```

### 导出卡片
```bash
python scripts/pipeline/export_card.py --input data/scored/xxx_mvp.json --top 5
```

### 一键跑通
```bash
python scripts/pipeline/run_all.py --keyword "独立开发者" --platforms bilibili --limit 20 --comments 200
```

### 看板
```bash
# 从卡片重建数据
python scripts/dashboard/write_dashboard.py
# 启动服务
python scripts/dashboard/serve.py --port 8787
# 手动更新某条需求
python scripts/dashboard/update_progress.py --id 20261011-001 --status analyzing --progress 45 --stage "痛点提炼完成" --next "机会评分"
```

## 五、平台配置

### 小红书 / 抖音
需要 MediaCrawler 或 TikTokDownloader：
```bash
export MEDIACRAWLER_PATH=/path/to/MediaCrawler
export TIKTOK_DOWNLOADER_PATH=/path/to/TikTokDownloader
```

### Reddit
```bash
export REDDIT_CLIENT_ID=xxx
export REDDIT_CLIENT_SECRET=xxx
```

### B站（可选，爬更多评论）
```bash
export BILI_SESSDATA=xxx
```

### LLM 评分（可选）
```bash
export OPENAI_API_KEY=sk-xxx
```

## 六、自优化

```bash
# 记录一次执行
python scripts/self_improve/log_execution.py --task "独立开发者" --phases 9 --duration 300 --outcome success --tools "MediaCrawler,BERTopic"

# 提炼经验
python scripts/self_improve/update_knowledge.py

# 生成优化建议
python scripts/self_improve/optimizer.py

# 工具巡检
python scripts/tool_intelligence/audit_toolkit.py

# 全部一起跑
python scripts/self_improve/audit_runner.py
```

## 七、Bug 自愈

```bash
# 手动记录 Bug
python scripts/healing/capture_bug.py --phase "Phase 4" --tool "MediaCrawler" --severity high --error "登录态失效"

# 触发自愈（读取 Bug 日志 → 生成修复 → 提交）
python scripts/healing/heal_runner.py
```

## 八、项目历程

```bash
# 启动历程
python scripts/journey/start_journey.py --project-id req-001 --title "独立开发者获客"

# 记录阶段
python scripts/journey/log_stage.py --project-id req-001 --phase "Phase 4" --actions "爬取B站评论" --tools "MediaCrawler" --problems "登录态失效" --solutions "重新登录" --outputs "342条评论"
```

## 九、GitHub Actions

把项目推到 GitHub 后，会自动启用：
- **self-heal.yml**：每天 08:00 / 20:00 触发 Bug 自愈
- **daily-audit.yml**：每天 UTC 02:00 触发工具巡检 + 知识库更新

需在仓库 Settings → Actions → General 开启 **Read and write** 权限。

## 十、故障排查

| 问题 | 排查 |
|---|---|
| B站爬取失败 | 检查网络，或设置 BILI_SESSDATA |
| BERTopic 装不上 | 不影响，自动退化为 TF-IDF |
| 看板打不开 | 检查 8787 端口是否被占用 |
| 卡片为空 | 检查 data/scored/ 是否有数据 |
| 爬取被限流 | 降低频率，或设置代理 |

## 十一、目录结构

见 `ARCHITECTURE.md`。
'''

# ============================================================
# CONTRIBUTING.md
# ============================================================
FILES["CONTRIBUTING.md"] = r'''# 贡献指南

## 一、扩展新平台

1. 在 `scripts/pipeline/adapters/` 新建 `<platform>.py`
2. 继承 `BaseAdapter`，实现 `discover()` 和 `crawl_comments()`
3. 在 `adapters/__init__.py` 注册
4. 在 `references/platform-playbooks/` 添加手册
5. 在 `data/toolkit.json` 加入工具

## 二、扩展新痛点信号

编辑 `scripts/pipeline/pain_rules.py` 的 `SIGNALS` 字典：

```python
SIGNALS = {
    "your_signal": {
        "words": ["关键词1", "关键词2"],
        "weight": 3,  # 1-5
        "label": "信号名",
    },
    ...
}
```

## 三、扩展新 MVP 模式

编辑 `references/mvp-patterns.md`，添加新模式。

## 四、扩展评分维度

编辑 `scripts/pipeline/score_opportunity.py` 的 `WEIGHTS`：

```python
WEIGHTS = {
    "demand": 0.30,
    "competition": 0.20,
    # 新维度
    "your_dim": 0.10,
}
```

同时更新 `references/scoring-rubric.md`。

## 五、提交规范

- 提交前跑：`python scripts/doctor.py` 和 `python scripts/e2e_test.py`
- Commit message：`feat:` / `fix:` / `docs:` / `chore:`
- 新增工具必须更新 `data/toolkit.json`

## 六、代码风格

- Python：PEP 8，docstring 用中文
- 所有网络请求必须经过 `compliance.py` 检查
- 所有输出必须经过 `storage.py` 标准化

## 七、自愈系统

如果自愈系统自动提交了修复，请人工 review 后再合并。
'''

# ============================================================
# Makefile（可选，Linux/macOS）
# ============================================================
FILES["Makefile"] = r'''.PHONY: help demo test doctor serve clean

help:
	@echo "Pain-to-MVP 常用命令："
	@echo "  make doctor    - 系统自检"
	@echo "  make demo      - 离线演示"
	@echo "  make test      - 端到端测试（B站）"
	@echo "  make serve     - 启动看板"
	@echo "  make clean     - 清理缓存"

doctor:
	python scripts/doctor.py

demo:
	python scripts/demo.py

test:
	python scripts/e2e_test.py --keyword "独立开发者" --platform bilibili --limit 10 --comments 100

serve:
	python scripts/dashboard/serve.py --port 8787

clean:
	rm -rf data/cache/* data/raw/*.jsonl data/discovered/* data/pains/* data/scored/* __pycache__ scripts/**/__pycache__
	@echo "✅ 已清理"
'''

# ============================================================
# run.sh（一键启动脚本）
# ============================================================
FILES["run.sh"] = r'''#!/usr/bin/env bash
# 一键启动：自检 → 后台跑 pipeline → 前台起看板
# 用法：bash run.sh "独立开发者" bilibili

set -e
KEYWORD="${1:-独立开发者}"
PLATFORM="${2:-bilibili}"

echo "🩺 自检"
python scripts/doctor.py

echo ""
echo "🚀 启动 Dashboard（后台）"
python scripts/dashboard/serve.py --port 8787 &
DASH_PID=$!

sleep 1
echo ""
echo "🔍 开始挖掘：$KEYWORD（平台：$PLATFORM）"
python scripts/pipeline/run_all.py --keyword "$KEYWORD" --platforms "$PLATFORM" --limit 20 --comments 200 || true

echo ""
echo "📊 重建看板"
python scripts/dashboard/write_dashboard.py

echo ""
echo "✅ 完成！访问：http://localhost:8787"
echo "   按 Ctrl+C 停止看板"
wait $DASH_PID
'''

# ============================================================
# data/demo/.gitkeep
# ============================================================
FILES["data/demo/.gitkeep"] = r'''# demo 目录
'''


def generate():
    root = Path.cwd()
    print(f"📁 生成 P6 文件到：{root}\n")
    for rel_path, content in FILES.items():
        p = root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"✅ {rel_path}")

    # 建 data/demo
    (root / "data" / "demo").mkdir(parents=True, exist_ok=True)

    # 给 shell 脚本加执行权限
    for sh in ["run.sh", "scripts/dashboard/run_pipeline_with_dashboard.sh"]:
        p = root / sh
        if p.exists():
            try:
                p.chmod(0o755)
            except Exception:
                pass

    print("\n🎉 P6 生成完成！项目完整！")
    print("\n本次生成：")
    print("  - scripts/doctor.py：系统自检")
    print("  - scripts/e2e_test.py：端到端测试（真实数据）")
    print("  - scripts/demo.py：离线演示（样本数据）")
    print("  - ARCHITECTURE.md：架构说明")
    print("  - USAGE.md：使用手册")
    print("  - CONTRIBUTING.md：贡献指南")
    print("  - Makefile：常用命令")
    print("  - run.sh：一键启动")
    print("\n" + "=" * 60)
    print("🚀 完整跑通方式")
    print("=" * 60)
    print("\n【第一次使用】")
    print("  python scripts/doctor.py              # 自检")
    print("  python scripts/demo.py                # 离线演示（推荐先跑这个）")
    print("  python scripts/dashboard/serve.py --port 8787")
    print("  # 浏览器打开 http://localhost:8787")
    print("\n【真实数据（B站）】")
    print("  python scripts/e2e_test.py --keyword '独立开发者' --platform bilibili --limit 10 --comments 100")
    print("  python scripts/dashboard/serve.py --port 8787")
    print("\n【一键启动】")
    print("  bash run.sh '独立开发者' bilibili")
    print("\n【Makefile】")
    print("  make doctor | make demo | make test | make serve | make clean")
    print("\n" + "=" * 60)
    print("📖 详细文档：")
    print("  README.md        - 项目总览")
    print("  USAGE.md         - 使用手册")
    print("  ARCHITECTURE.md  - 架构说明")
    print("  CONTRIBUTING.md  - 贡献指南")
    print("=" * 60)


if __name__ == "__main__":
    generate()
