#!/usr/bin/env python3
"""
定时巡检入口：工具巡检 + 知识库更新 + 自优化建议。
由 GitHub Actions 每天触发。
用法：python audit_runner.py
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
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent

def run(script, *args):
    cmd = [sys.executable, str(script), *args]
    print(f"\n$ {' '.join(cmd)}")
    r = subprocess.run(cmd)
    return r.returncode == 0

def main():
    print("=" * 50)
    print("🔄 开始每日巡检")
    print("=" * 50)

    run(BASE / "tool_intelligence" / "audit_toolkit.py")
    run(BASE / "tool_intelligence" / "sync_toolkit.py")
    run(BASE / "self_improve" / "update_knowledge.py")
    run(BASE / "self_improve" / "optimizer.py")

    print("\n✅ 巡检完成")

if __name__ == "__main__":
    main()
