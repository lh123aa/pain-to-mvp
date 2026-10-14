#!/usr/bin/env python3
"""
P0 域校验三层防线（词表规则，不用语义模型）：
1. 关键词类型前置判定（classify_keyword）—— 搜索前判 domain，跑偏即警告
2. 成人擦边黑名单硬拦截（is_adult）—— 清洗层丢弃，合规红线不绕过
3. 召回后域重合度（domain_overlap）—— 报告第 4 节展示，跑偏可见

实测依据（docs/exec-report-20261014-2105-独立开发者怎么接单.md）：
- 问题域「独立开发者怎么接单」痛点率 23.6%
- 娱乐域「女孩喜欢的物件」痛点率 4.5%
差距 5.2 倍 —— 域错是唯一被实测证明的 5 倍杠杆。
"""
# --- UTF-8 入口稳定化（与 pipeline 其余脚本一致） ---
import os as _os
import sys as _sys

_here = _os.path.dirname(_os.path.abspath(__file__))
for _cand in (_here, _os.path.dirname(_here), _os.path.join(_os.path.dirname(_here), "pipeline")):
    if _os.path.isdir(_os.path.join(_cand, "pipeline")) and _cand not in _sys.path:
        _sys.path.insert(0, _cand)
        break
try:
    from pipeline.encoding import ensure_utf8

    ensure_utf8()
except Exception:
    pass
# --- 结束 UTF-8 入口稳定化 ---


# ---------------- Layer 1: 关键词类型前置判定 ----------------

# 问题域指示词（求助 / 工作 / 学习 / 技术 / 职业）
PROBLEM_INDICATORS = {
    # 求助
    "求", "怎么", "如何", "请问", "谁知道", "求教", "教教", "求助", "求推荐",
    # 难点 / 抱怨
    "太难", "好难", "麻烦", "繁琐", "复杂", "坑", "踩坑", "吐槽", "烦",
    # 商业 / 接单
    "接单", "获客", "变现", "赚钱", "副业", "创业", "收入", "客户", "报价", "项目",
    # 学习 / 技术
    "学习", "教程", "入门", "教学", "培训", "开发", "编程", "代码", "技术",
    "工具", "软件", "独立开发", "程序员",
    # 职业
    "工作", "职业", "面试", "简历", "转行",
}

# 娱乐域指示词（外貌 / 穿搭 / 美食 / 旅行 / 情感 / 追星）
ENTERTAINMENT_INDICATORS = {
    # 外貌
    "女孩", "美女", "帅哥", "颜值", "长得", "好看", "漂亮",
    # 穿搭
    "穿搭", "衣服", "时尚", "搭配", "风格",
    # 美食
    "美食", "餐厅", "小吃", "好吃", "美味",
    # 旅行
    "旅行", "旅游", "景点", "打卡", "探店",
    # 情感 / 氛围
    "萌", "可爱", "治愈", "暖心", "小清新",
    # 追星 / 娱乐
    "游戏", "动漫", "小说", "追剧", "综艺", "明星", "偶像",
}

# 疑问词（用于拆分关键词，判断哪段是"领域"哪段是"问题"）
QUESTION_WORDS = ["怎么", "如何", "怎样", "为啥", "为什么", "是不是", "能不能", "有没有", "谁知道", "请问"]


def classify_keyword(keyword: str) -> str:
    """分类关键词类型：problem / entertainment / unknown。

    计数法：问题域指示词命中数 vs 娱乐域指示词命中数。
    - problem 多 → problem
    - entertainment 多 → entertainment
    - 平局或全零 → unknown
    """
    if not keyword:
        return "unknown"
    p_hits = sum(1 for w in PROBLEM_INDICATORS if w in keyword)
    e_hits = sum(1 for w in ENTERTAINMENT_INDICATORS if w in keyword)
    if p_hits > e_hits:
        return "problem"
    if e_hits > p_hits:
        return "entertainment"
    return "unknown"


# ---------------- Layer 2: 成人擦边黑名单硬拦截 ----------------

# 成人擦边黑名单（B站合规红线，命中即丢弃，不绕过）
ADULT_BLACKLIST = {
    "福利姬", "福利视频", "擦边", "露出", "走光",
    "内衣秀", "比基尼秀", "色情", "情色", "色站",
    "黄网", "黄站", "成人视频", "18+", "已满18",
}


def is_adult(text: str) -> bool:
    """检查文本是否命中成人擦边黑名单。"""
    if not text:
        return False
    return any(word in text for word in ADULT_BLACKLIST)


# ---------------- Layer 3: 召回后域重合度 ----------------

# 域重合度阈值
OVERLAP_THRESHOLD = 0.3


def domain_overlap(keyword: str, titles: list) -> dict:
    """计算关键词与召回标题的域重合度。

    原理：先判定关键词属于哪个域，再统计召回标题中命中该域指示词的比例。
    """
    keyword_type = classify_keyword(keyword)
    if keyword_type == "unknown" or not titles:
        return {
            "overlap_ratio": 0.0,
            "matched_titles": 0,
            "total_titles": len(titles),
            "verdict": "unknown",
            "samples": [],
        }

    indicators = PROBLEM_INDICATORS if keyword_type == "problem" else ENTERTAINMENT_INDICATORS

    matched = []
    unmatched = []
    for t in titles:
        if any(w in (t or "") for w in indicators):
            matched.append(t)
        else:
            unmatched.append(t)

    ratio = len(matched) / len(titles)

    return {
        "overlap_ratio": round(ratio, 3),
        "matched_titles": len(matched),
        "total_titles": len(titles),
        "verdict": "domain_match" if ratio >= OVERLAP_THRESHOLD else "domain_mismatch",
        "samples": unmatched[:5],
    }


if __name__ == "__main__":
    import json
    samples = [
        "独立开发者怎么接单",
        "女孩喜欢的物件",
        "美女穿搭",
        "编程入门教程",
        "测试",
    ]
    for s in samples:
        print(f"「{s}」 → {classify_keyword(s)}")
    print()
    r = domain_overlap("独立开发者", ["独立开发者如何接单", "女孩喜欢的物件", "美食探店"])
    print(json.dumps(r, ensure_ascii=False, indent=2))
