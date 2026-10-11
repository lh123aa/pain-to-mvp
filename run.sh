#!/usr/bin/env bash
# 一键启动：自检 → 后台跑 pipeline → 前台起看板
# 用法：bash run.sh "独立开发者" bilibili

set -e
KEYWORD="${1:-独立开发者}"
PLATFORM="${2:-bilibili}"

echo "🩺 自检"
python scripts/doctor.py

echo ""
echo "🚀 启动 Dashboard（后台）"
python scripts/dashboard/serve.py --port 8787 &
DASH_PID=$!

sleep 1
echo ""
echo "🔍 开始挖掘：$KEYWORD（平台：$PLATFORM）"
python scripts/pipeline/run_all.py --keyword "$KEYWORD" --platforms "$PLATFORM" --limit 20 --comments 200 || true

echo ""
echo "📊 重建看板"
python scripts/dashboard/write_dashboard.py

echo ""
echo "✅ 完成！访问：http://localhost:8787"
echo "   按 Ctrl+C 停止看板"
wait $DASH_PID
