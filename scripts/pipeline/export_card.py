#!/usr/bin/env python3
"""
导出机会卡片（Markdown）+ 更新 dashboard.json。
用法：
  python export_card.py --input data/scored/xxx_mvp.json --top 5
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
import re
from datetime import datetime
from pathlib import Path

CARD_DIR = Path("data/cards")
DASHBOARD = Path("data/dashboard.json")

# 表情/玩梗标签：[笑哭] [doge] [吃瓜] 等
_EMOJI_TAG = re.compile(r"\[[^\]]{1,12}\]")
_ZH_DIMS = {"demand": "需求强度", "competition": "竞争空缺",
            "feasibility": "个人可行性", "reach": "触达难度",
            "ai_leverage": "AI杠杆"}

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
| 需求强度 | {demand} |
| 竞争空缺 | {competition} |
| 个人可行性 | {feasibility} |
| 触达难度 | {reach} |
| AI杠杆 | {ai_leverage} |

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


def format_title(quotes, max_len: int = 30, fallback: str = "未命名痛点") -> str:
    """卡片标题：从代表原话里挑信息量最高的一条，跳过玩梗句。

    旧版直接取首条原话 —— 实测把「笑死，干运维还没用到Python[笑哭]」当成
    机会标题，而 112 条真实需求簇的卡片被排在其后。规则：
      - 含 [表情] 标签的跳过（多为玩梗/纯情绪）—— 主防线
      - 过短（<8 字）的跳过（多为感叹、没有信息）
      - 其余取最长者（信息密度最高），再按 max_len 截断
    长度阈值只到 8 字：再高会误伤「预算有限投不起广告」这类真实诉求。
    全不合格 → 退回 fallback（_topic_title 的「主导信号 + 规模」），
    宁可标题平淡，也不引用玩梗句。
    """
    cands = []
    for q in quotes or []:
        t = (q or "").strip().strip("，。！？、；：,.!?;: ")
        if not t or _EMOJI_TAG.search(t) or len(t) < 8:
            continue
        cands.append(t)
    if not cands:
        return fallback
    best = max(cands, key=len)
    return best[:max_len] + "…" if len(best) > max_len else best


def _topic_title(p) -> str:
    """无合格原话时的卡片标题：主导信号 + 样本规模（诚实，不引用玩梗句）。"""
    sigs = p.get("signal_distribution") or {}
    size = p.get("size", 0)
    if not sigs:
        return f"痛点（{size} 条评论）"   # 无信号时不得拼成「痛点痛点」
    top = max(sigs.items(), key=lambda kv: kv[1])[0]
    return f"{top}痛点（{size} 条评论）"


def _fallback_reason(total, p) -> str:
    """旧数据缺 score_reason 时的兜底：仍给出分数构成，不写空话。"""
    scores = p.get("scores") or {}
    used = [k for k in _ZH_DIMS if scores.get(k) is not None]
    conf = p.get("score_confidence")
    conf_txt = f" × 样本置信度 {conf:.2f}" if conf is not None else ""
    names = "、".join(_ZH_DIMS[k] for k in used) or "无"
    return (f"启发式评分：总分 {total} = 有效维度均值/5×100{conf_txt}"
            f"（样本 {p.get('size', 0)} 条，参与 {len(used)}/5 维：{names}；"
            "旧数据缺逐维理由）")


def format_dim(value):
    """评分渲染：None（无数据来源）显示 —，而不是伪造分。"""
    return f"{value}/5" if value is not None else "—"


def _build_card(p, total_score, tier):
    """构造单张卡片内容（供 export 与测试复用）。

    description 优先级：pain_summary（T7 mine 生成的一句话摘要）→ title → 首条原话。
    """
    title = format_title(p.get("representative_quotes"), fallback=_topic_title(p))
    description = (p.get("pain_summary") or "").strip() \
        or (p.get("title") or "").strip() \
        or title \
        or next((q for q in (p.get("representative_quotes") or []) if q), "（暂无描述）")
    scores = p.get("scores") or {}  # 旧格式容错：缺键不崩，维度渲染 —（OPEN_ISSUES #4）
    mvp = p.get("mvp", {})
    mvp_rec = (mvp.get("recommended_mvp") or [{}])[0]
    card_id = f"{datetime.now().strftime('%Y%m%d')}-{hash(description) % 1000:03d}"
    content = CARD_TMPL.format(
        id=card_id,
        title=title,
        status="discovered",
        score=total_score,
        tier=tier,
        discovered_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        size=p.get("size", 0),
        description=description,
        signals=json.dumps(p.get("signal_distribution", {}), ensure_ascii=False),
        quotes=_format_quotes(p.get("representative_quotes")),
        demand=format_dim(scores.get("demand")),
        competition=format_dim(scores.get("competition")),
        feasibility=format_dim(scores.get("feasibility")),
        reach=format_dim(scores.get("reach")),
        ai_leverage=format_dim(scores.get("ai_leverage")),
        reason=f"\n**评分理由**：{p.get('score_reason') or _fallback_reason(total_score, p)}\n",
        mvp_type=mvp_rec.get("type", "咨询/模板"),
        mvp_rationale=mvp_rec.get("rationale", ""),
        validation=_format_list(mvp.get("validation_plan", [])),
        revenue=_format_list(mvp.get("revenue_layers", [])),
        tech=", ".join(mvp.get("tech_stack", [])),
        cost=mvp.get("estimated_cost", "¥0-500"),
        days=mvp.get("estimated_days", 7),
    )
    return {"id": card_id, "title": title, "description": description, "content": content,
            "scores": scores, "mvp": mvp, "total_score": total_score, "tier": tier,
            "size": p.get("size", 0), "quotes": p.get("representative_quotes", [])[:3]}


def export(input_file, top=5):
    scored = json.loads(Path(input_file).read_text(encoding="utf-8"))
    CARD_DIR.mkdir(parents=True, exist_ok=True)

    cards = []
    for i, p in enumerate(scored[:top], 1):
        total_score = p.get("total_score")
        tier = p.get("tier", "?")
        built = _build_card(p, total_score, tier)
        card_id = f"{datetime.now().strftime('%Y%m%d')}-{i:03d}"
        built["content"] = built["content"].replace(f"#{built['id']}", f"#{card_id}", 1)
        built["id"] = card_id
        card_path = CARD_DIR / f"{card_id}.md"
        card_path.write_text(built["content"], encoding="utf-8")
        print(f"📇 卡片 → {card_path}")

        cards.append({
            "id": card_id,
            "title": built["title"],
            "status": "discovered",
            "progress": 10,
            "score": total_score,
            "tier": tier,
            "size": built["size"],
            "representative_quotes": built["quotes"],
            "scores": built["scores"],
            "mvp": built["mvp"],
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
