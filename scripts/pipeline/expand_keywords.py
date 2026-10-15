#!/usr/bin/env python3
"""
关键词扩展：规则扩展 + 可选 LLM 扩展。
用法：python expand_keywords.py --input "独立开发者获客"
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
import os
from pathlib import Path

# 规则扩展词表
PREFIXES = ["怎么", "如何", "为什么", "有没有", "求"]
SUFFIXES = ["难", "方法", "工具", "案例", "经验", "教程"]
EMOTIONS = ["焦虑", "迷茫", "踩坑", "后悔", "求助"]
PLATFORMS = ["小红书", "抖音", "B站", "知乎", "Reddit"]

def rule_expand(keyword):
    results = []
    for p in PREFIXES:
        results.append(f"{p}{keyword}")
    for s in SUFFIXES:
        results.append(f"{keyword}{s}")
    for e in EMOTIONS:
        results.append(f"{keyword} {e}")
    for p in PLATFORMS:
        results.append(f"{keyword} {p}")
    return list(set(results))

def llm_expand(keyword):
    """如果有 API key，用 LLM 扩展"""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return []
    try:
        import urllib.request
        prompt = f"""你是关键词研究专家。给定主题，生成20个相关搜索词。
要求：覆盖同义词、长尾词、问题词、场景词、情绪词，中英各10个。
输出JSON：{{"keywords": [{{"word": "...", "intent": "找方案/找工具/找案例/发泄情绪"}}]}}
主题：{keyword}"""
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            data=json.dumps({
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"}
            }).encode()
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
        content = data["choices"][0]["message"]["content"]
        return json.loads(content).get("keywords", [])
    except Exception as e:
        print(f"⚠️ LLM 扩展失败：{e}")
        return []

def expand(keyword):
    rule_kws = rule_expand(keyword)
    llm_kws = llm_expand(keyword)
    result = {
        "input": keyword,
        "rule_expanded": rule_kws,
        "llm_expanded": llm_kws,
        "total": len(rule_kws) + len(llm_kws)
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    expand(args.input)
