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

# 评分维度（有序）。历史 WEIGHTS 的权重值在启发式路径从未生效（compose 用有效维度均值），
# 属死代码，已清理为维度元组（OPEN_ISSUES #4）。
DIMS = ("demand", "competition", "feasibility", "reach", "ai_leverage")

# AI杠杆的代表句形态词表（OPEN_ISSUES #21 方向A收窄版，2026-10-15 批准）：
# 软件形态词 → AI 可 10x；硬件/线下形态词 → AI 难杠杆。匹配前文本统一 lower()。
AI_LEVERAGE_HIGH = (
    "工具", "网站", "小程序", "app", "插件", "模板", "脚本",
    "自动", "一键", "在线", "查询", "生成", "转换", "数据", "教程", "攻略",
)
AI_LEVERAGE_LOW = (
    "硬件", "实体", "线下", "门店", "上门", "维修", "物流", "快递", "手工", "工厂",
)


def _competition_score(pain: dict):
    """竞争空缺（1-5 或 None）：现有方案是否不足。返回 (score, 证据描述)。

    证据 = 簇内「对比」（用户在比较现有方案）与「失望」（对方案不满）信号：
    - 双证据且 (对比+失望)/size ≥ 15% → 竞品在被比较且被不满 → 空缺大（5）
    - 双证据稀疏（4）/ 单证据（3）→ 中档，不虚高
    - 零证据 → None：无证据不评，不伪造（方向A红线，与旧「恒 None」的区别是
      有证据时真的评）
    """
    sigs = pain.get("signal_distribution") or {}
    size = max(1, int(pain.get("size") or 1))
    cmp_n = int(sigs.get("对比") or 0)
    dsp_n = int(sigs.get("失望") or 0)
    if cmp_n == 0 and dsp_n == 0:
        return None, "无对比/失望证据（不参与均值）"
    score = 2
    if cmp_n:
        score += 1
    if dsp_n:
        score += 1
    density = (cmp_n + dsp_n) / size
    if cmp_n and dsp_n and density >= 0.15:
        score += 1
    return min(5, score), f"对比 {cmp_n}+失望 {dsp_n} 条(密度 {density:.0%})"


def _ai_leverage_score(pain: dict):
    """AI杠杆（1-5 或 None）：代表句里有无产品形态证据。返回 (score, 证据描述)。

    软件形态词命中越多分越高（3+2=5），硬件/线下越多越低（3-2=1），
    两类命中取中间；都没有 → None —— 纯痛点句评不出杠杆，不硬凑。
    """
    text = " ".join(pain.get("representative_quotes") or []).lower()
    hi = sorted({w for w in AI_LEVERAGE_HIGH if w in text})
    lo = sorted({w for w in AI_LEVERAGE_LOW if w in text})
    if not hi and not lo:
        return None, "代表句无产品形态词（不参与均值）"
    score = 3
    if hi:
        score += 2 if len(hi) >= 2 else 1
    if lo:
        score -= 2 if len(lo) >= 2 else 1
    score = max(1, min(5, score))
    if hi and lo:
        ev = f"软件词 {len(hi)}+线下词 {len(lo)} 个"
    elif hi:
        ev = f"软件形态词 {len(hi)} 个({'/'.join(hi[:3])})"
    else:
        ev = f"线下形态词 {len(lo)} 个({'/'.join(lo[:3])})"
    return score, ev

def _paid_bonus(paid) -> int:
    """付费信号量级加成：1-5 条 +1，6 条以上 +2，无 +0。

    旧版是二值 `1 if "付费意愿" in sigs else 0`，再被 round 抹平 ——
    实测 112 条簇里 10 个付费意愿与 11 条簇里 1 个付费意愿，
    需求强度算出来同为 3/5，付费证据的量级差异完全丢失。
    """
    return min(2, (max(0, int(paid)) + 4) // 5)


def _feas_basis(size) -> str:
    """可行性依据的可读描述（与 exec_report.breakdown 同口径）。"""
    if size < 50:
        return f"size={size}<50"
    if size < 200:
        return f"size={size}<200"
    return f"size={size}>=200"


def _heuristic_scores(pain: dict) -> dict:
    """启发式打分（无 LLM 时使用）。同时产出 reason，供 score_reason 落卡。

    维度参与规则（方向A收窄版）：demand/feasibility 恒评；
    competition/ai_leverage 证据驱动（有证据才评，无证据 None）；
    reach 无独立数据来源，恒为 None（诚实留空，不硬凑）。
    """
    avg_pain = pain.get("avg_pain", 0)
    size = pain.get("size", 0)
    sigs = pain.get("signal_distribution", {})
    paid = int(sigs.get("付费意愿") or 0)
    bonus = _paid_bonus(paid)

    # 需求强度：平均痛点 + 付费信号量级
    demand = min(5, max(1, round(avg_pain / 2 + bonus)))
    # 个人可行性：聚类规模小通常更聚焦
    feasibility = 5 if size < 50 else (4 if size < 200 else 3)
    competition, comp_ev = _competition_score(pain)
    ai_leverage, ai_ev = _ai_leverage_score(pain)
    comp_part = (f"竞争空缺 = {comp_ev} → {competition}/5" if competition is not None
                 else f"竞争空缺 {comp_ev}")
    ai_part = (f"AI杠杆 = {ai_ev} → {ai_leverage}/5" if ai_leverage is not None
               else f"AI杠杆 {ai_ev}")
    reason = (
        f"启发式：需求强度 = 平均痛点 {avg_pain}/2 + 付费信号 {paid} 条(+{bonus}) "
        f"→ {demand}/5；个人可行性 = 簇规模 {size} 条({_feas_basis(size)}) "
        f"→ {feasibility}/5；{comp_part}；{ai_part}；"
        f"触达难度 无数据来源（不参与均值）"
    )
    return {
        "demand": demand, "competition": competition,
        "feasibility": feasibility, "reach": None, "ai_leverage": ai_leverage,
        "reason": reason,
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
        for k in DIMS:
            scores[k] = max(1, min(5, int(scores.get(k, 3))))
        return scores
    except Exception as e:
        print(f"⚠️ LLM 打分失败（{e}），回退启发式")
        return _heuristic_scores(pain)

def _compose_total(scores: dict) -> float:
    """仅对有值的维度求简单均值，归一到 100；无有效维度返回 0。"""
    valid = [scores[k] for k in DIMS if scores.get(k) is not None]
    if not valid:
        return 0.0
    return round(sum(valid) / len(valid) * 20, 1)

def _confidence_factor(size: int) -> float:
    """小簇置信惩罚（T8）：样本越少，结论越不可信，按规模线性折减。

    factor = min(1.0, 0.6 + 0.008 * size) —— 下限 0.6，50 条封顶 1.0。

    旧值是 0.6 + 0.04 * size，在 size ≥ 10 就封顶 1.0：11 条与 112 条的证据
    同价，样本量的正向作用失效；与此同时 feasibility（size<50 得 5 分）仍在
    按「小簇更聚焦」反向计分 —— 等于样本量只剩反向惩罚这一条腿。实测后果：
    112 条真实需求簇得 70 分，被 11 条玩梗簇的 80 分压过。
    斜率调到 0.008 后，证据量的正向作用持续到 50 条，排序恢复。
    """
    return min(1.0, 0.6 + 0.008 * max(0, int(size)))

def score(input_file, output_file=None, use_llm=True):
    pains = json.loads(Path(input_file).read_text(encoding="utf-8"))
    scored = []
    for p in pains:
        s = _llm_scores(p) if use_llm else _heuristic_scores(p)
        raw = _compose_total(s)
        conf = _confidence_factor(p.get("size", 0))
        total = round(raw * conf, 1)
        p["scores"] = {k: s[k] for k in DIMS}
        p["total_score"] = total
        p["score_confidence"] = conf
        p["tier"] = (
            "S" if total >= 85 else
            "A" if total >= 70 else
            "B" if total >= 55 else
            "C" if total >= 40 else "D"
        )
        # 评分理由必须总是存在且可核对（旧版启发式路径不产 reason，
        # 卡片落到「启发式评分」四个字的空话兜底）。
        size = int(p.get("size") or 0)
        conf_txt = f"样本置信度 {conf:.2f}（{size} 条）"
        base = str(s.get("reason") or "").strip()
        p["score_reason"] = (
            f"{base}；{conf_txt}" if base else
            f"启发式评分：总分 {total} = 有效维度均值/5×100 × {conf_txt}"
        )
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
