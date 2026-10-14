#!/usr/bin/env python3
"""
文本预处理：清洗、去噪、分词、过滤。
评论 → 干净文本 → 分词 → 可聚类
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
import re
from typing import List, Dict

from domain_check import is_adult

# 广告/无意义关键词
AD_PATTERNS = [
    r"加微信", r"加v", r"私信", r"代购", r"免费领", r"点击链接",
    r"扫码", r"关注我", r"优惠券", r"限时", r"下单"
]
AD_RE = re.compile("|".join(AD_PATTERNS), re.IGNORECASE)

# 无意义短评
MEANINGLESS = {"哈哈", "哈哈哈", "顶", "赞", "好", "嗯", "哦", "6", "1", "第一", "沙发", "感谢分享"}

def clean(text: str) -> str:
    if not text:
        return ""
    # 去 HTML
    text = re.sub(r"<[^>]+>", "", text)
    # 去 URL
    text = re.sub(r"https?://\S+", "", text)
    # 去 @提及
    text = re.sub(r"@\S+", "", text)
    # 去多余空白
    text = re.sub(r"\s+", " ", text).strip()
    return text

def is_valid(text: str) -> bool:
    if not text or len(text) < 4:
        return False
    if text in MEANINGLESS:
        return False
    if AD_RE.search(text):
        return False
    if is_adult(text):
        return False
    # 纯表情/符号
    if not re.search(r"[\u4e00-\u9fa5a-zA-Z]", text):
        return False
    return True

def tokenize(text: str) -> List[str]:
    """中文分词，失败则退化为字符切分"""
    try:
        import jieba
        return [w for w in jieba.cut(text) if len(w.strip()) > 1]
    except ImportError:
        return [w for w in re.findall(r"[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}", text)]

def preprocess_comments(comments: List[Dict]) -> List[Dict]:
    """输入原始评论列表，输出去噪后的评论（含 tokens）"""
    cleaned = []
    for c in comments:
        text = clean(c.get("content") or c.get("text") or "")
        if not is_valid(text):
            continue
        c["clean_content"] = text
        c["tokens"] = tokenize(text)
        cleaned.append(c)
    return cleaned

if __name__ == "__main__":
    import json
    sample = [
        {"content": "这个工具怎么用啊，求教程"},
        {"content": "加微信领取资料"},
        {"content": "哈哈"},
        {"content": "为什么我的报错啊，找不到解决方法，太难受了"},
    ]
    print(json.dumps(preprocess_comments(sample), ensure_ascii=False, indent=2))
