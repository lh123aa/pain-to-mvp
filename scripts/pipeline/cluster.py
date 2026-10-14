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

# --- 痛点信号过滤（iteration-1 T6：OPEN_ISSUES #6） ---
_SEPARATORS = "，,。.！!？?；;、\n"

def _segments(text: str) -> List[str]:
    cur, out = "", []
    for ch in text:
        if ch in _SEPARATORS:
            if cur:
                out.append(cur)
            cur = ""
        else:
            cur += ch
    if cur:
        out.append(cur)
    return out

def _is_noise(text: str) -> bool:
    """噪音判定：话题标签串 / 灌水短句（<10字 或 ≥3段且每段≤6字）。

    真实痛点表达多为完整长句；标签罗列（"独立开发，知识付费，…"）与
    灌水（"哈哈哈哈"）进入聚类会污染簇结构与代表句。
    """
    t = (text or "").strip()
    if len(t) < 10:
        return True
    segs = _segments(t)
    if len(segs) >= 3 and all(len(s.strip()) <= 6 for s in segs):
        return True
    return False

def _select_representative(members: List[Dict], top: int = 3) -> List[str]:
    """代表句：优先取非噪音成员（按 pain_score 降序）；全噪音时回退全部成员。"""
    clean = [m for m in members if not _is_noise(m.get("clean_content") or m.get("content") or "")]
    pool = clean or members
    pool = sorted(pool, key=lambda x: x.get("pain_score", 0), reverse=True)
    return [m.get("clean_content") or m.get("content") for m in pool[:top]]
# --- 结束痛点信号过滤 ---

def _cluster_fallback(texts: List[str], n_clusters: int = 5) -> List[int]:
    """纯 Python 兜底聚类：字符二元组 Jaccard 贪心分组。

    sklearn/scipy 环境损坏（vendored .libs 冲突、编译版本不匹配）时保证管线不崩。
    """
    n = min(n_clusters, max(2, len(texts) // 5))
    centers: List[set] = []
    labels: List[int] = []
    for t in texts:
        bg = {t[i:i + 2] for i in range(max(1, len(t) - 1))}
        best, best_sim = -1, 0.0
        for i, c in enumerate(centers):
            union = len(bg | c) or 1
            sim = len(bg & c) / union
            if sim > best_sim:
                best, best_sim = i, sim
        if best >= 0 and best_sim >= 0.15:
            labels.append(best)
            centers[best] = centers[best] | bg
        elif len(centers) < n:
            labels.append(len(centers))
            centers.append(bg)
        else:
            # 附着到最近中心（即使相似度低）
            sims = [len(bg & c) / (len(bg | c) or 1) for c in centers]
            labels.append(max(range(len(centers)), key=lambda i: sims[i]))
    return labels

def _cluster_bertopic(texts: List[str]) -> List[int]:
    from sentence_transformers import SentenceTransformer
    from bertopic import BERTopic
    model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    embeddings = model.encode(texts, show_progress_bar=False)
    topic_model = BERTopic(language="multilingual", calculate_probabilities=False, verbose=False)
    topics, _ = topic_model.fit_transform(texts, embeddings)
    return list(topics)

def _cluster_tfidf(texts: List[str], n_clusters: int = 5) -> List[int]:
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.cluster import KMeans
        vec = TfidfVectorizer(max_features=500)
        X = vec.fit_transform(texts)
        n = min(n_clusters, max(2, len(texts) // 5))
        km = KMeans(n_clusters=n, random_state=42, n_init=10)
        return list(km.fit_predict(X))
    except Exception as e:
        print(f"⚠️ TF-IDF+KMeans 失败（{e}），退化为纯 Python 兜底聚类")
        return _cluster_fallback(texts, n_clusters)

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
                 "representative": _select_representative(comments)}]

    # 噪音过滤：标签串/灌水不参与聚类（T6）
    kept = [(c, t) for c, t in zip(comments, texts) if not _is_noise(t)]
    if not kept:
        # 全噪音：保留原始成员，避免空结果
        return [{"cluster_id": 0, "size": len(comments), "members": comments,
                 "representative": _select_representative(comments)}]
    comments, texts = [c for c, _ in kept], [t for _, t in kept]

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
        # 代表文本：非噪音成员中痛点分最高的 3 条
        representative = _select_representative(members)
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
