"""pytest 全局路径配置：生成的 pipeline 脚本使用"脚本直跑式"导入
（`from adapters import ...`、`from preprocess import ...`），测试中需要
把脚本目录加入 sys.path 才能 import 它们。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
for p in (str(ROOT / "scripts"), str(ROOT / "scripts" / "pipeline")):
    if p not in sys.path:
        sys.path.insert(0, p)
