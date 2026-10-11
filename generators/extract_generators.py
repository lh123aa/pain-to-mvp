#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从上级目录的 MVP.md 提取 P0-P6 共 7 个生成器脚本，存放于 generators/。
用法：python generators/extract_generators.py
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent.parent / "MVP.md"

def extract() -> dict:
    text = SRC.read_text(encoding="utf-8")
    blocks = {}
    for i in range(7):
        marker = f"Pain-to-MVP 项目生成器 - P{i}"
        m = re.search(re.escape(marker), text)
        if not m:
            raise SystemExit(f"未找到 P{i} 标记：{marker}")
        # 向前找最近的 ```python 围栏起点
        start = text.rfind("```python", 0, m.start())
        if start == -1:
            raise SystemExit(f"P{i} 未找到围栏起点")
        code_start = start + len("```python")
        # 结束点：生成器主体末尾的 `if __name__ == "__main__":\n    generate()\n```
        end_pat = 'if __name__ == "__main__":\n    generate()\n```'
        end = text.find(end_pat, m.start())
        if end == -1:
            raise SystemExit(f"P{i} 未找到结束围栏")
        code = text[code_start:end].rstrip() + "\n"
        # 结束围栏本身被排除，补回可执行入口，否则生成器只 import 不执行
        if not re.search(r'if __name__ == ["\']__main__["\']:\s*\n\s*generate\(\)', code):
            code += '\n\nif __name__ == "__main__":\n    generate()\n'
        p = HERE / f"generate_p{i}.py"
        # 模板级修复保护：若旧版生成器含我们的模板修复而新版（MVP.md）不含，
        # 警告覆盖将丢失修复（bilibili/demo 的权威修复在 generators/fixes/ overlay）
        if p.exists():
            old = p.read_text(encoding="utf-8")
            lost = [m for m in ("wbi/search/type", "v_voucher", "def latest(")
                    if m in old and m not in code]
            if lost:
                print(f"⚠️ 覆盖 generate_p{i}.py：MVP.md 版本缺少模板修复标记 {lost}，"
                      f"请运行 python generators/apply_fixes.py 恢复 overlay 修复")
        p.write_text(code, encoding="utf-8")
        compile(code, str(p), "exec")  # 语法校验
        blocks[i] = p
    return blocks

if __name__ == "__main__":
    blocks = extract()
    print(f"✅ 提取 {len(blocks)} 个生成器：")
    for i, p in blocks.items():
        print(f"  - {p.name} ({p.stat().st_size} bytes)")
