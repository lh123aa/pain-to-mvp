
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pain-to-MVP 项目生成器 - P3
痛点聚类 + 机会评分 + MVP设计 + 卡片导出
运行：python generate_p3.py
"""
from pathlib import Path

FILES = {}

# ============================================================
# scripts/pipeline/preprocess.py
# ============================================================
FILES["scripts/pipeline/preprocess.py"] = r'''#!/usr/bin/env python3
"""
文本预处理：清洗、去噪、分词、过滤。
评论 → 干净文本 → 分词 → 可聚类
"""
import re
from typing import List, Dict

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
'''

# ============================================================
# scripts/pipeline/pain_rules.py
# ============================================================
FILES["scripts/pipeline/pain_rules.py"] = r'''#!/usr/bin/env python3
"""
痛点识别规则引擎。
从评论文本中识别：求助、抱怨、对比、失望、期望。
"""
import re
from typing import List, Dict

# 痛点信号词表
SIGNALS = {
    "help": {
        "words": ["求", "求助", "怎么", "如何", "有没有人", "谁知道", "请问", "求教", "教教"],
        "weight": 3,
        "label": "求助",
    },
    "complain": {
        "words": ["太难", "好难", "麻烦", "繁琐", "复杂", "坑", "踩坑", "吐槽", "烦"],
        "weight": 4,
        "label": "抱怨",
    },
    "compare": {
        "words": ["不如", "比", "平替", "替代", "对比", "哪个好", "选哪个"],
        "weight": 2,
        "label": "对比",
    },
    "disappoint": {
        "words": ["失望", "后悔", "垃圾", "差", "不行", "没用", "踩雷", "避雷", "浪费"],
        "weight": 5,
        "label": "失望",
    },
    "expect": {
        "words": ["希望", "如果能", "要是", "期待", "建议", "最好有", "需要"],
        "weight": 4,
        "label": "期望",
    },
    "pay": {
        "words": ["多少钱", "价格", "收费", "付费", "贵", "便宜", "免费", "值不值"],
        "weight": 5,
        "label": "付费意愿",
    },
    "why": {
        "words": ["为什么", "为啥", "怎么回", "难道", "是不是"],
        "weight": 3,
        "label": "困惑",
    },
}

def detect_signals(text: str) -> List[Dict]:
    """返回命中的信号列表"""
    hits = []
    for key, spec in SIGNALS.items():
        for w in spec["words"]:
            if w in text:
                hits.append({
                    "type": key,
                    "label": spec["label"],
                    "word": w,
                    "weight": spec["weight"],
                })
                break
    return hits

def pain_score(text: str) -> int:
    """返回文本的痛点强度分（累加命中信号权重）"""
    hits = detect_signals(text)
    return sum(h["weight"] for h in hits)

def filter_painful(comments: List[Dict], min_score: int = 3) -> List[Dict]:
    """过滤出痛点较强的评论，附加信号"""
    result = []
    for c in comments:
        text = c.get("clean_content") or c.get("content") or ""
        hits = detect_signals(text)
        score = sum(h["weight"] for h in hits)
        if score >= min_score:
            c["pain_signals"] = hits
            c["pain_score"] = score
            result.append(c)
    result.sort(key=lambda x: x["pain_score"], reverse=True)
    return result

if __name__ == "__main__":
    import json
    samples = [
        "这个工具太难用了，我找了好久都没找到解决方案",
        "求推荐一个平替，太贵了",
        "哈哈",
        "为什么我的报错啊，太失望了，后悔买",
    ]
    for s in samples:
        print(f"「{s}」 → {pain_score(s)} 分")
'''

# ============================================================
# scripts/pipeline/cluster.py
# ============================================================
FILES["scripts/pipeline/cluster.py"] = r'''#!/usr/bin/env python3
"""
痛点聚类：优先 BERTopic + Sentence Transformers，缺依赖时退化为 TF-IDF + KMeans。
"""
from typing import List, Dict

def _cluster_bertopic(texts: List[str]) -> List[int]:
    from sentence_transformers import SentenceTransformer
    from bertopic import BERTopic
    model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    embeddings = model.encode(texts, show_progress_bar=False)
    topic_model = BERTopic(language="multilingual", calculate_probabilities=False, verbose=False)
    topics, _ = topic_model.fit_transform(texts, embeddings)
    return list(topics)

def _cluster_tfidf(texts: List[str], n_clusters: int = 5) -> List[int]:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.cluster import KMeans
    vec = TfidfVectorizer(max_features=500)
    X = vec.fit_transform(texts)
    n = min(n_clusters, max(2, len(texts) // 5))
    km = KMeans(n_clusters=n, random_state=42, n_init=10)
    return list(km.fit_predict(X))

def cluster_comments(comments: List[Dict], min_size: int = 3) -> List[Dict]:
    """
    输入评论列表（需含 clean_content 或 content）
    输出聚类列表，每个聚类含 representative 文本 + 成员
    """
    texts = [c.get("clean_content") or c.get("content") or "" for c in comments]
    if len(texts) < min_size:
        return [{"cluster_id": 0, "size": len(texts), "members": comments,
                 "representative": texts[:3]}]

    try:
        labels = _cluster_bertopic(texts)
        method = "bertopic"
    except Exception as e:
        print(f"⚠️ BERTopic 失败（{e}），退化为 TF-IDF + KMeans")
        labels = _cluster_tfidf(texts)
        method = "tfidf_kmeans"

    # 组装
    clusters = {}
    for c, lbl in zip(comments, labels):
        if lbl == -1:  # BERTopic 的噪声
            continue
        clusters.setdefault(int(lbl), []).append(c)

    result = []
    for cid, members in clusters.items():
        if len(members) < min_size:
            continue
        # 代表文本：痛点分最高的 3 条
        members_sorted = sorted(members, key=lambda x: x.get("pain_score", 0), reverse=True)
        representative = [m.get("clean_content") or m.get("content") for m in members_sorted[:3]]
        total_pain = sum(m.get("pain_score", 0) for m in members)
        result.append({
            "cluster_id": cid,
            "size": len(members),
            "total_pain": total_pain,
            "avg_pain": round(total_pain / len(members), 2),
            "representative": representative,
            "members": members,
            "method": method,
        })
    result.sort(key=lambda x: x["total_pain"], reverse=True)
    return result

if __name__ == "__main__":
    import json
    sample = [
        {"content": "怎么获客啊，找不到用户"},
        {"content": "获客太难了，投放太贵"},
        {"content": "求推荐获客渠道"},
        {"content": "这个工具付费太贵了"},
        {"content": "平替有没有，买不起"},
        {"content": "价格太高了，学生党用不起"},
    ]
    clusters = cluster_comments(sample, min_size=2)
    print(json.dumps(
        [{k: v for k, v in c.items() if k != "members"} for c in clusters],
        ensure_ascii=False, indent=2
    ))
'''

# ============================================================
# scripts/pipeline/mine_pain_points.py
# ============================================================
FILES["scripts/pipeline/mine_pain_points.py"] = r'''#!/usr/bin/env python3
"""
痛点挖掘入口：读评论 → 清洗 → 识别信号 → 聚类 → 输出痛点列表。
用法：
  python mine_pain_points.py --input data/raw/bilibili_xxx.jsonl --output data/pains/xxx.json
  python mine_pain_points.py --platform bilibili --limit 1000
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

from preprocess import preprocess_comments
from pain_rules import filter_painful
from cluster import cluster_comments
from storage import query_comments

OUTPUT_DIR = Path("data/pains")

def _load_input(input_file=None, platform=None, limit=1000):
    if input_file:
        comments = []
        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    comments.append(json.loads(line))
        return comments
    if platform:
        return query_comments(platform=platform, limit=limit)
    return []

def mine(input_file=None, platform=None, limit=1000, min_pain=3, min_cluster=3):
    raw = _load_input(input_file, platform, limit)
    print(f"📥 载入 {len(raw)} 条评论")

    cleaned = preprocess_comments(raw)
    print(f"🧹 清洗后 {len(cleaned)} 条")

    painful = filter_painful(cleaned, min_score=min_pain)
    print(f"🔥 痛点评论 {len(painful)} 条")

    clusters = cluster_comments(painful, min_size=min_cluster)
    print(f"🧩 形成 {len(clusters)} 个痛点簇")

    # 汇总每个簇的痛点描述
    pains = []
    for c in clusters:
        # 汇总信号类型
        sig_counter = {}
        for m in c["members"]:
            for s in m.get("pain_signals", []):
                sig_counter[s["label"]] = sig_counter.get(s["label"], 0) + 1
        pains.append({
            "cluster_id": c["cluster_id"],
            "size": c["size"],
            "avg_pain": c["avg_pain"],
            "total_pain": c["total_pain"],
            "signal_distribution": sig_counter,
            "representative_quotes": c["representative"],
            "evidence_ids": [m.get("id") for m in c["members"][:5]],
            "method": c["method"],
        })

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    tag = platform or Path(input_file).stem if input_file else "all"
    out_file = OUTPUT_DIR / f"pains_{tag}_{ts}.json"
    out_file.write_text(json.dumps(pains, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n💾 已保存 → {out_file}")

    print("\n📊 Top 3 痛点簇：")
    for p in pains[:3]:
        print(f"  - 簇{p['cluster_id']} | {p['size']}条 | 平均痛点 {p['avg_pain']} | {list(p['signal_distribution'].keys())}")
        for q in p["representative_quotes"][:2]:
            print(f"      「{q[:50]}」")
    return pains

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--input", help="评论 JSONL 文件")
    p.add_argument("--platform", help="平台（从 SQLite 读）")
    p.add_argument("--limit", type=int, default=1000)
    p.add_argument("--min-pain", type=int, default=3)
    p.add_argument("--min-cluster", type=int, default=3)
    args = p.parse_args()
    mine(args.input, args.platform, args.limit, args.min_pain, args.min_cluster)
'''

# ============================================================
# scripts/pipeline/score_opportunity.py
# ============================================================
FILES["scripts/pipeline/score_opportunity.py"] = r'''#!/usr/bin/env python3
"""
机会评分：五维打分 + 综合分。支持 LLM 辅助，缺 key 时用启发式。
用法：
  python score_opportunity.py --input data/pains/xxx.json --output data/scored/xxx.json
"""
import argparse
import json
import os
from datetime import datetime
from pathlib import Path

WEIGHTS = {
    "demand": 0.30,
    "competition": 0.20,
    "feasibility": 0.20,
    "reach": 0.15,
    "ai_leverage": 0.15,
}

def _heuristic_scores(pain: dict) -> dict:
    """启发式打分（无 LLM 时使用）"""
    avg_pain = pain.get("avg_pain", 0)
    size = pain.get("size", 0)
    sigs = pain.get("signal_distribution", {})

    # 需求强度：平均痛点 + 付费信号
    demand = min(5, max(1, round(avg_pain / 2 + (1 if "付费意愿" in sigs else 0))))
    # 竞争空缺：暂默认中等（无外部数据时保守）
    competition = 3
    # 个人可行性：聚类规模小通常更聚焦
    feasibility = 5 if size < 50 else (4 if size < 200 else 3)
    # 触达难度：有明确渠道（聚类本身就来自渠道）
    reach = 4
    # AI杠杆：默认较高（文本类任务）
    ai_leverage = 4
    return {
        "demand": demand, "competition": competition,
        "feasibility": feasibility, "reach": reach, "ai_leverage": ai_leverage
    }

def _llm_scores(pain: dict, model: str = "gpt-4o-mini") -> dict:
    """LLM 辅助打分。失败则回退到启发式。"""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _heuristic_scores(pain)
    try:
        import urllib.request
        prompt = f"""你是机会评估专家。根据以下痛点信息，按1-5打分：
- demand: 需求强度（是否有付费信号）
- competition: 竞争空缺（现有方案是否不足）
- feasibility: 个人可行性（一人+AI能否做出MVP）
- reach: 触达难度（能否低成本找到用户）
- ai_leverage: AI杠杆（AI能否降本10倍）

痛点信息：
- 规模：{pain.get('size')} 条
- 平均痛点分：{pain.get('avg_pain')}
- 信号分布：{pain.get('signal_distribution')}
- 代表原话：{pain.get('representative_quotes', [])[:3]}

只输出 JSON：{{"demand": N, "competition": N, "feasibility": N, "reach": N, "ai_leverage": N, "reason": "简短理由"}}"""
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            data=json.dumps({
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"},
            }).encode(),
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
        scores = json.loads(data["choices"][0]["message"]["content"])
        for k in WEIGHTS:
            scores[k] = max(1, min(5, int(scores.get(k, 3))))
        return scores
    except Exception as e:
        print(f"⚠️ LLM 打分失败（{e}），回退启发式")
        return _heuristic_scores(pain)

def _compose_total(scores: dict) -> float:
    total = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)  # 1-5 加权
    return round(total / 5 * 100, 1)  # 归一到 100

def score(input_file, output_file=None, use_llm=True):
    pains = json.loads(Path(input_file).read_text(encoding="utf-8"))
    scored = []
    for p in pains:
        s = _llm_scores(p) if use_llm else _heuristic_scores(p)
        total = _compose_total(s)
        p["scores"] = {k: s[k] for k in WEIGHTS}
        p["total_score"] = total
        p["tier"] = (
            "S" if total >= 85 else
            "A" if total >= 70 else
            "B" if total >= 55 else
            "C" if total >= 40 else "D"
        )
        if "reason" in s:
            p["score_reason"] = s["reason"]
        scored.append(p)

    scored.sort(key=lambda x: x["total_score"], reverse=True)

    if not output_file:
        ts = datetime.now().strftime("%Y%m%d_%H%M")
        out_dir = Path("data/scored"); out_dir.mkdir(parents=True, exist_ok=True)
        output_file = out_dir / f"scored_{ts}.json"
    else:
        Path(output_file).parent.mkdir(parents=True, exist_ok=True)

    Path(output_file).write_text(json.dumps(scored, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 已保存 → {output_file}")

    print("\n🏆 Top 5：")
    for p in scored[:5]:
        print(f"  [{p['tier']}] {p['total_score']} 分 | {p['size']} 条 | {p['representative_quotes'][0][:40] if p['representative_quotes'] else ''}")
    return scored

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output")
    p.add_argument("--no-llm", action="store_true")
    args = p.parse_args()
    score(args.input, args.output, use_llm=not args.no_llm)
'''

# ============================================================
# scripts/pipeline/design_mvp.py
# ============================================================
FILES["scripts/pipeline/design_mvp.py"] = r'''#!/usr/bin/env python3
"""
MVP 设计：根据高分痛点生成最小商业闭环。
参考 references/mvp-patterns.md。
"""
import json
from pathlib import Path

# 痛点信号 → MVP 类型推荐
SIGNAL_TO_MVP = {
    "求助": ("模板/提示词库", "把常见问题整理成模板或提示词"),
    "抱怨": ("小工具/自动化", "用工具消除繁琐步骤"),
    "对比": ("导航站/评测报告", "帮用户做选择"),
    "失望": ("替代方案/教程", "提供更好的替代品"),
    "期望": ("新产品原型", "直接满足未满足的期望"),
    "付费意愿": ("付费产品/咨询", "直接商业化"),
    "困惑": ("教程/知识库", "把知识结构化"),
}

def design_mvp(pain: dict) -> dict:
    sigs = list(pain.get("signal_distribution", {}).keys())
    quotes = pain.get("representative_quotes", [])

    # 推荐 MVP 类型
    recommended = []
    for s in sigs:
        if s in SIGNAL_TO_MVP:
            recommended.append({"signal": s, "type": SIGNAL_TO_MVP[s][0], "rationale": SIGNAL_TO_MVP[s][1]})
    if not recommended:
        recommended.append({"signal": "generic", "type": "咨询/模板", "rationale": "默认推荐轻交付"})

    return {
        "recommended_mvp": recommended[:3],
        "deliverable_hint": recommended[0]["type"],
        "validation_plan": [
            "Day 1: 找 10 个目标用户",
            "Day 2: 访谈 3 个，确认痛点",
            "Day 3: 做出最小交付物",
            "Day 4: 尝试收 100 元",
            "Day 5: 交付 + 收集反馈",
            "Day 6-7: 复盘，决定继续/放弃",
        ],
        "revenue_layers": ["咨询/代做（现金流）", "模板/工具（可复用）", "社群/订阅（复利）"],
        "tech_stack": ["GitHub Pages", "单文件 HTML", "Stripe/爱发电", "Tally/金数据"],
        "estimated_cost": "¥0-500",
        "estimated_days": 7,
        "raw_quotes": quotes,
    }

def enrich(input_file, output_file=None):
    scored = json.loads(Path(input_file).read_text(encoding="utf-8"))
    for p in scored:
        p["mvp"] = design_mvp(p)
    out = output_file or input_file.replace(".json", "_mvp.json")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(scored, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 已保存 → {out}")
    return scored

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output")
    args = p.parse_args()
    enrich(args.input, args.output)
'''

# ============================================================
# scripts/pipeline/export_card.py
# ============================================================
FILES["scripts/pipeline/export_card.py"] = r'''#!/usr/bin/env python3
"""
导出机会卡片（Markdown）+ 更新 dashboard.json。
用法：
  python export_card.py --input data/scored/xxx_mvp.json --top 5
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

CARD_DIR = Path("data/cards")
DASHBOARD = Path("data/dashboard.json")

CARD_TMPL = """# 机会卡片 #{id}

## 基本信息
- **标题**：{title}
- **状态**：{status}
- **机会分**：{score}/100（{tier} 档）
- **发现时间**：{discovered_at}
- **规模**：{size} 条评论

## 痛点
- **描述**：{description}
- **信号分布**：{signals}
- **代表原话**：
{quotes}

## 机会评分
| 维度 | 分数 |
|---|---|
| 需求强度 | {demand}/5 |
| 竞争空缺 | {competition}/5 |
| 个人可行性 | {feasibility}/5 |
| 触达难度 | {reach}/5 |
| AI杠杆 | {ai_leverage}/5 |

{reason}

## MVP 方案
- **推荐类型**：{mvp_type}
- **理由**：{mvp_rationale}
- **验证路径**：
{validation}

## 收入层
{revenue}

## 技术栈
{tech}

## 预计成本 / 周期
{cost} / {days} 天

## 下一步
- [ ] 找 10 个目标用户
- [ ] 访谈 3 个
- [ ] 做最小交付物
- [ ] 尝试收费
"""

def _format_quotes(quotes):
    if not quotes:
        return "- （暂无）"
    return "\n".join(f"- 「{q}」" for q in quotes[:5])

def _format_list(items):
    if not items:
        return "- （暂无）"
    return "\n".join(f"- {i}" for i in items)

def export(input_file, top=5):
    scored = json.loads(Path(input_file).read_text(encoding="utf-8"))
    CARD_DIR.mkdir(parents=True, exist_ok=True)

    cards = []
    for i, p in enumerate(scored[:top], 1):
        card_id = f"{datetime.now().strftime('%Y%m%d')}-{i:03d}"
        title = (p.get("representative_quotes") or ["未命名痛点"])[0][:40]
        mvp = p.get("mvp", {})
        mvp_rec = (mvp.get("recommended_mvp") or [{}])[0]

        content = CARD_TMPL.format(
            id=card_id,
            title=title,
            status="discovered",
            score=p.get("total_score"),
            tier=p.get("tier", "?"),
            discovered_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
            size=p.get("size", 0),
            description=title,
            signals=json.dumps(p.get("signal_distribution", {}), ensure_ascii=False),
            quotes=_format_quotes(p.get("representative_quotes")),
            demand=p["scores"]["demand"],
            competition=p["scores"]["competition"],
            feasibility=p["scores"]["feasibility"],
            reach=p["scores"]["reach"],
            ai_leverage=p["scores"]["ai_leverage"],
            reason=f"\n**评分理由**：{p.get('score_reason', '启发式评分')}\n",
            mvp_type=mvp_rec.get("type", "咨询/模板"),
            mvp_rationale=mvp_rec.get("rationale", ""),
            validation=_format_list(mvp.get("validation_plan", [])),
            revenue=_format_list(mvp.get("revenue_layers", [])),
            tech=", ".join(mvp.get("tech_stack", [])),
            cost=mvp.get("estimated_cost", "¥0-500"),
            days=mvp.get("estimated_days", 7),
        )
        card_path = CARD_DIR / f"{card_id}.md"
        card_path.write_text(content, encoding="utf-8")
        print(f"📇 卡片 → {card_path}")

        cards.append({
            "id": card_id,
            "title": title,
            "status": "discovered",
            "progress": 10,
            "score": p.get("total_score"),
            "tier": p.get("tier"),
            "size": p.get("size"),
            "representative_quotes": p.get("representative_quotes", [])[:3],
            "scores": p["scores"],
            "mvp": mvp,
            "card_path": str(card_path),
            "discovered_at": datetime.now().isoformat(),
        })

    _update_dashboard(cards)
    return cards

def _update_dashboard(new_cards):
    if DASHBOARD.exists():
        db = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    else:
        db = {"last_updated": None, "summary": {}, "requirements": []}

    existing_ids = {r["id"] for r in db.get("requirements", [])}
    for c in new_cards:
        if c["id"] not in existing_ids:
            db["requirements"].append(c)

    # 更新 summary
    reqs = db["requirements"]
    db["summary"] = {
        "total": len(reqs),
        "in_progress": sum(1 for r in reqs if r["status"] == "in_progress"),
        "completed": sum(1 for r in reqs if r["status"] == "completed"),
        "dropped": sum(1 for r in reqs if r["status"] == "dropped"),
        "high_score": sum(1 for r in reqs if (r.get("score") or 0) >= 70),
    }
    db["last_updated"] = datetime.now().isoformat()
    DASHBOARD.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📊 Dashboard 已更新：{DASHBOARD}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="scored_mvp.json")
    p.add_argument("--top", type=int, default=5)
    args = p.parse_args()
    export(args.input, args.top)
'''

# ============================================================
# scripts/pipeline/run_all.py
# ============================================================
FILES["scripts/pipeline/run_all.py"] = r'''#!/usr/bin/env python3
"""
一键跑通 P2 → P3：发现 → 爬取 → 挖掘 → 评分 → MVP → 导出卡片。
用法：
  python run_all.py --keyword "独立开发者获客" --platforms bilibili --limit 20 --comments 200
"""
import argparse
import subprocess
import sys
from pathlib import Path

def run(cmd):
    print(f"\n$ {' '.join(cmd)}")
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0:
        print(f"⚠️ 命令失败：{cmd}")
    return r.returncode == 0

def main(args):
    base = Path(__file__).parent

    # 1. 发现
    run([sys.executable, str(base / "discover_content.py"),
         "--keyword", args.keyword,
         "--platforms", *args.platforms,
         "--limit", str(args.limit)])

    # 找最新的 discovered 文件
    discovered_dir = Path("data/discovered")
    files = sorted(discovered_dir.glob(f"{args.keyword}_*.json"), key=lambda p: p.stat().st_mtime)
    if not files:
        print("❌ 未找到发现结果"); return
    latest = files[-1]

    # 2. 爬评论
    run([sys.executable, str(base / "crawl_comments.py"),
         "--input", str(latest), "--limit", str(args.comments)])

    # 3. 找最新的 raw JSONL（爬取结果）
    raw_dir = Path("data/raw")
    raw_files = sorted(raw_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    if not raw_files:
        print("❌ 未找到爬取结果"); return
    raw_latest = raw_files[-1]

    # 4. 挖掘痛点
    run([sys.executable, str(base / "mine_pain_points.py"),
         "--input", str(raw_latest)])

    # 5. 找最新 pains 文件
    pains_dir = Path("data/pains")
    pains_files = sorted(pains_dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
    if not pains_files:
        print("❌ 未找到痛点结果"); return
    pains_latest = pains_files[-1]

    # 6. 评分
    run([sys.executable, str(base / "score_opportunity.py"),
         "--input", str(pains_latest)])

    # 7. 找最新 scored 文件
    scored_dir = Path("data/scored")
    scored_files = sorted(scored_dir.glob("scored_*.json"), key=lambda p: p.stat().st_mtime)
    if not scored_files:
        print("❌ 未找到评分结果"); return
    scored_latest = scored_files[-1]

    # 8. MVP 设计
    run([sys.executable, str(base / "design_mvp.py"),
         "--input", str(scored_latest)])

    # 9. 导出卡片
    mvp_file = Path(str(scored_latest).replace(".json", "_mvp.json"))
    if mvp_file.exists():
        run([sys.executable, str(base / "export_card.py"),
             "--input", str(mvp_file), "--top", "5"])

    print("\n🎉 全流程完成！")
    print("查看卡片：data/cards/")
    print("查看看板数据：data/dashboard.json")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--keyword", required=True)
    p.add_argument("--platforms", nargs="+", default=["bilibili"])
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--comments", type=int, default=200)
    args = p.parse_args()
    main(args)
'''


def generate():
    root = Path.cwd()
    print(f"📁 生成 P3 文件到：{root}\n")
    for rel_path, content in FILES.items():
        p = root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"✅ {rel_path}")

    # 建 data 子目录
    for d in ["data/pains", "data/scored", "data/cards", "data/raw", "data/discovered"]:
        (root / d).mkdir(parents=True, exist_ok=True)

    print("\n🎉 P3 生成完成！")
    print("\n本次生成：")
    print("  - preprocess.py：文本清洗 + 分词")
    print("  - pain_rules.py：痛点信号识别（求助/抱怨/对比/失望/期望/付费/困惑）")
    print("  - cluster.py：痛点聚类（BERTopic 优先，TF-IDF 兜底）")
    print("  - mine_pain_points.py：痛点挖掘入口")
    print("  - score_opportunity.py：五维机会评分（LLM 优先，启发式兜底）")
    print("  - design_mvp.py：MVP 设计")
    print("  - export_card.py：导出卡片 + 更新 dashboard.json")
    print("  - run_all.py：一键跑通全流程")
    print("\n验证（用 B站，无需 key）：")
    print("  python scripts/pipeline/run_all.py --keyword '独立开发者' --platforms bilibili --limit 10 --comments 100")
    print("\n或分步跑：")
    print("  python scripts/pipeline/mine_pain_points.py --platform bilibili --limit 500")
    print("  python scripts/pipeline/score_opportunity.py --input data/pains/pains_*.json --no-llm")
    print("  python scripts/pipeline/design_mvp.py --input data/scored/scored_*.json")
    print("  python scripts/pipeline/export_card.py --input data/scored/*_mvp.json --top 5")
    print("\n下一步：等待 P4（工具智能层 + 自优化循环）")


if __name__ == "__main__":
    generate()
