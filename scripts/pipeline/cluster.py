#!/usr/bin/env python3
"""
痛点聚类：优先 BERTopic + Sentence Transformers，缺依赖时退化为 TF-IDF + KMeans。
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
    if not comments:
        return []
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
