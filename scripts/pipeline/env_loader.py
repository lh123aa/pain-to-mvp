#!/usr/bin/env python3
"""
.env 统一加载入口（OPEN_ISSUES #10 / PRD §七）。

PRD §七 规定所有凭证统一写仓库根 `.env`（已 gitignore）；此前代码只读 shell
环境变量，文档停留在"计划"。本模块接线：

- 仓库根 `.env` 存在即加载（python-dotenv；缺失依赖时静默跳过——凭证可继续走 shell 变量）
- shell 已设置的环境变量优先，`.env` 不覆盖（12-factor：环境优先）
- 各入口脚本在读凭证前调用 `load_env()` 即可（幂等）
"""
# --- UTF-8 入口稳定化（fix_utf8.py 自动插入） ---
import os as _os
import sys as _sys

_here = _os.path.dirname(_os.path.abspath(__file__))
for _cand in (_here, _os.path.dirname(_here), _os.path.join(_os.path.dirname(_here), "scripts")):
    if _os.path.isdir(_os.path.join(_cand, "pipeline")) and _cand not in _sys.path:
        _sys.path.insert(0, _cand)
        break
try:
    from pipeline.encoding import ensure_utf8

    ensure_utf8()
except Exception:
    pass
# --- 结束 UTF-8 入口稳定化 ---
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_env(root=None, override=False) -> bool:
    """加载 `<root 或仓库根>/.env` 到 os.environ；返回是否加载了文件。

    - 文件不存在：返回 False，不报错（fail-safe，shell 变量路径始终可用）
    - override=False（默认）：已设置的环境变量不被覆盖（12-factor：环境优先）
    - override=True：.env 值强制覆盖 os.environ（测试隔离用，写可预测值）
    """
    env_file = Path(root) if root else REPO_ROOT
    env_file = env_file / ".env" if env_file.is_dir() else env_file
    if not env_file.is_file():
        return False
    try:
        from dotenv import load_dotenv as _ld
    except ImportError:
        print("⚠️ python-dotenv 未安装，跳过 .env 加载（凭证请走 shell 环境变量）")
        return False
    _ld(env_file, override=override)
    return True


if __name__ == "__main__":
    # 自检：python env_loader.py → 报告 .env 加载状态与已见凭证键（不打印值）
    ok = load_env()
    print(f"{'✅ 已加载' if ok else '⚠️ 未找到'} .env")
    for key in ("BILI_SESSDATA", "OPENAI_API_KEY", "REDDIT_CLIENT_ID",
                "REDDIT_CLIENT_SECRET", "MEDIACRAWLER_PATH", "TIKTOK_DOWNLOADER_PATH"):
        if _os.getenv(key):
            print(f"   {key}: 已设置")
