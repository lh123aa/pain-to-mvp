#!/usr/bin/env python3
"""stdout/stderr UTF-8 稳定化。

Windows 默认控制台代码页（cp936/gbk）无法编码 emoji，直接 print 会抛
UnicodeEncodeError。所有入口脚本顶部调用 ensure_utf8() 即可规避。
"""

import sys


def ensure_utf8() -> None:
    """把 stdout/stderr 重配置为 UTF-8；老版本 Python 或异常流上静默降级。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass  # 无 reconfigure 的旧解释器 / 已替换的流：忽略，保持原有行为
