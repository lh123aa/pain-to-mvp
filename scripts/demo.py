#!/usr/bin/env python3
"""
演示脚本：用内置样本数据跑通全流程（无需网络）。
用于快速验证系统是否正常。
用法：python scripts/demo.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SAMPLE_DIR = ROOT / "data" / "demo"
SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

# 内置样本评论（模拟从B站爬到的真实评论）
SAMPLE_COMMENTS = [
    {"id": "c1", "platform": "demo", "source_id": "demo1", "content": "独立开发者太难了，做出来的产品根本没人用", "author": "user_a", "likes": 20, "timestamp": "1700000000"},
    {"id": "c2", "platform": "demo", "source_id": "demo1", "content": "怎么找到第一批用户啊，求教", "author": "user_b", "likes": 15, "timestamp": "1700000001"},
    {"id": "c3", "platform": "demo", "source_id": "demo1", "content": "投放太贵了，学生党根本负担不起", "author": "user_c", "likes": 30, "timestamp": "1700000002"},
    {"id": "c4", "platform": "demo", "source_id": "demo1", "content": "有没有性价比高的获客渠道推荐？", "author": "user_d", "likes": 8, "timestamp": "1700000003"},
    {"id": "c5", "platform": "demo", "source_id": "demo1", "content": "这个工具的价格太高了，有没有平替", "author": "user_e", "likes": 25, "timestamp": "1700000004"},
    {"id": "c6", "platform": "demo", "source_id": "demo1", "content": "为什么我的产品没有流量，是不是SEO有问题", "author": "user_f", "likes": 12, "timestamp": "1700000005"},
    {"id": "c7", "platform": "demo", "source_id": "demo1", "content": "做独立开发半年了，一分钱没赚到，很迷茫", "author": "user_g", "likes": 50, "timestamp": "1700000006"},
    {"id": "c8", "platform": "demo", "source_id": "demo1", "content": "有没有独立开发者的社群，一个人太孤独了", "author": "user_h", "likes": 18, "timestamp": "1700000007"},
    {"id": "c9", "platform": "demo", "source_id": "demo1", "content": "求推荐一个好用的落地页模板，太贵了买不起", "author": "user_i", "likes": 22, "timestamp": "1700000008"},
    {"id": "c10", "platform": "demo", "source_id": "demo1", "content": "独立开发者怎么定价啊，定高了没人买，定低了亏本", "author": "user_j", "likes": 35, "timestamp": "1700000009"},
    {"id": "c11", "platform": "demo", "source_id": "demo1", "content": "求一个能自动生成文案的AI工具，手动写太累了", "author": "user_k", "likes": 28, "timestamp": "1700000010"},
    {"id": "c12", "platform": "demo", "source_id": "demo1", "content": "每次上线新功能都没人用，白做了", "author": "user_l", "likes": 40, "timestamp": "1700000011"},
    {"id": "c13", "platform": "demo", "source_id": "demo1", "content": "产品做出来了，不知道怎么推广，太难了", "author": "user_m", "likes": 33, "timestamp": "1700000012"},
    {"id": "c14", "platform": "demo", "source_id": "demo1", "content": "独立开发者要不要做SEO？求经验", "author": "user_n", "likes": 10, "timestamp": "1700000013"},
    {"id": "c15", "platform": "demo", "source_id": "demo1", "content": "有没有办法低成本验证产品想法，不想白做", "author": "user_o", "likes": 16, "timestamp": "1700000014"},
]

def main():
    print("🎬 Pain-to-MVP 演示（离线样本）\n")

    # 写样本
    sample_file = SAMPLE_DIR / "comments.jsonl"
    with open(sample_file, "w", encoding="utf-8") as f:
        for c in SAMPLE_COMMENTS:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"📝 写入样本：{sample_file}（{len(SAMPLE_COMMENTS)} 条）")

    # 跑痛点挖掘 → 评分 → MVP → 卡片，每步跑完再定位上一步产物（不再预先 glob）
    def latest(directory, pattern):
        files = sorted(directory.glob(pattern), key=lambda p: p.stat().st_mtime)
        if not files:
            print(f"❌ 未找到 {directory}/{pattern}")
            return None
        return files[-1]

    pipeline = ROOT / "scripts" / "pipeline"
    py = sys.executable

    def run(desc, cmd):
        print(f"\n▶️  {desc}")
        r = subprocess.run(cmd, text=True)
        if r.returncode != 0:
            print(f"❌ {desc} 失败")
            return False
        return True

    if not run("痛点挖掘", [py, str(pipeline / "mine_pain_points.py"),
                          "--input", str(sample_file),
                          "--min-pain", "3", "--min-cluster", "2"]):
        return

    pains = latest(ROOT / "data" / "pains", "*.json")
    if not pains:
        return
    if not run("机会评分", [py, str(pipeline / "score_opportunity.py"),
                          "--input", str(pains), "--no-llm"]):
        return

    scored = latest(ROOT / "data" / "scored", "scored_*.json")
    if not scored:
        return
    if not run("MVP 设计", [py, str(pipeline / "design_mvp.py"), "--input", str(scored)]):
        return

    mvp_file = Path(str(scored).replace(".json", "_mvp.json"))
    if not mvp_file.exists():
        print("❌ 未找到 MVP 结果")
        return
    if not run("导出卡片", [py, str(pipeline / "export_card.py"),
                          "--input", str(mvp_file), "--top", "5"]):
        return

    run("重建看板", [py, str(ROOT / "scripts" / "dashboard" / "write_dashboard.py")])

    print("\n🎉 演示完成！")
    print("查看卡片：data/cards/")
    print("启动看板：python scripts/dashboard/serve.py --port 8787")

if __name__ == "__main__":
    main()
