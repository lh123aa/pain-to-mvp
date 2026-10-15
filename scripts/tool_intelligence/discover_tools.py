#!/usr/bin/env python3
"""
工具发现：在 GitHub / PyPI 搜索候选工具。
用法：python discover_tools.py --need "xiaohongshu comment scraper"
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
import argparse
import json
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path

OUTPUT = Path("data/tool_discovery.jsonl")

def search_github(query, limit=10):
    """搜索 GitHub 仓库（无需 token，有速率限制）"""
    url = f"https://api.github.com/search/repositories?q={urllib.parse.quote(query)}&sort=stars&order=desc&per_page={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "pain-to-mvp"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        results = []
        for item in data.get("items", []):
            results.append({
                "name": item["full_name"],
                "url": item["html_url"],
                "stars": item["stargazers_count"],
                "updated": item["updated_at"],
                "description": item.get("description", ""),
                "language": item.get("language", ""),
                "source": "github"
            })
        return results
    except Exception as e:
        print(f"⚠️ GitHub 搜索失败：{e}")
        return []

def search_pypi(query, limit=10):
    """搜索 PyPI 包"""
    url = f"https://pypi.org/search/?q={urllib.parse.quote(query)}"
    # PyPI 没有官方搜索 API，这里用简单 HTML 解析
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pain-to-mvp"})
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode()
        import re
        packages = re.findall(r'<a class="package-snippet" href="([^"]+)"', html)
        results = []
        for pkg in packages[:limit]:
            results.append({
                "name": pkg.strip("/").split("/")[-1],
                "url": f"https://pypi.org{pkg}",
                "source": "pypi"
            })
        return results
    except Exception as e:
        print(f"⚠️ PyPI 搜索失败：{e}")
        return []

def discover(need):
    print(f"🔍 搜索：{need}\n")
    results = []
    results.extend(search_github(need))
    results.extend(search_pypi(need))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "a", encoding="utf-8") as f:
        for r in results:
            r["query"] = need
            r["discovered_at"] = datetime.now().isoformat()
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"✅ 发现 {len(results)} 个候选工具，已写入 {OUTPUT}")
    for r in results[:5]:
        print(f"  - {r['name']} ({r.get('stars', '?')} stars)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--need", required=True, help="能力需求描述")
    args = parser.parse_args()
    discover(args.need)
