#!/usr/bin/env python3
"""
把 data/toolkit.json 同步到 references/tool-landscape.md。
用法：python sync_toolkit.py
"""
import json
from datetime import datetime
from pathlib import Path

TOOLKIT = Path("data/toolkit.json")
LANDSCAPE = Path("references/tool-landscape.md")
MARKER = "<!-- AUTO-SYNCED -->"

def sync():
    if not TOOLKIT.exists():
        print(f"⚠️ 未找到 {TOOLKIT}")
        return
    tk = json.loads(TOOLKIT.read_text(encoding="utf-8"))

    lines = [MARKER, f"\n## 自动同步的工具库（{datetime.now().strftime('%Y-%m-%d')}）\n"]
    lines.append("| 工具 | 平台 | 用途 | 状态 | 最后巡检 |")
    lines.append("|---|---|---|---|---|")
    for t in tk.get("tools", []):
        lines.append(
            f"| [{t.get('name')}]({t.get('repo') or ''}) | {t.get('platform') or '-'} | "
            f"{t.get('purpose') or '-'} | {t.get('status', 'ok')} | {t.get('last_audit') or '-'} |"
        )
    content = "\n".join(lines) + "\n"

    existing = LANDSCAPE.read_text(encoding="utf-8") if LANDSCAPE.exists() else ""
    if MARKER in existing:
        before = existing.split(MARKER)[0]
        existing = before + content
    else:
        existing = existing + "\n" + content

    LANDSCAPE.write_text(existing, encoding="utf-8")
    print(f"✅ 已同步 → {LANDSCAPE}")

if __name__ == "__main__":
    sync()
