#!/usr/bin/env python3
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
