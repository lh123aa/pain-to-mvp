#!/usr/bin/env python3
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
