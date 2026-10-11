#!/usr/bin/env python3
"""
机会评分：五维打分 + 综合分。支持 LLM 辅助，缺 key 时用启发式。
用法：
  python score_opportunity.py --input data/pains/xxx.json --output data/scored/xxx.json
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
    # 个人可行性：聚类规模小通常更聚焦
    feasibility = 5 if size < 50 else (4 if size < 200 else 3)
    return {
        "demand": demand, "competition": None,
        "feasibility": feasibility, "reach": None, "ai_leverage": None
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
    """仅对有值的维度求简单均值，归一到 100；无有效维度返回 0。"""
    valid = [scores[k] for k in WEIGHTS if scores.get(k) is not None]
    if not valid:
        return 0.0
    return round(sum(valid) / len(valid) * 20, 1)

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
