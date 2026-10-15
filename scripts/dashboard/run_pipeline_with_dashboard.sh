#!/usr/bin/env bash
# 一键启动：后台跑 pipeline + 前台起看板
# 用法：bash scripts/dashboard/run_pipeline_with_dashboard.sh "独立开发者" bilibili

set -e
KEYWORD="${1:-独立开发者}"
PLATFORM="${2:-bilibili}"

echo "🚀 启动 Dashboard（后台）"
python scripts/dashboard/serve.py --port 8787 &
DASH_PID=$!

echo "🔍 开始挖掘：$KEYWORD（平台：$PLATFORM）"
python scripts/pipeline/run_all.py --keyword "$KEYWORD" --platforms "$PLATFORM" --limit 20 --comments 200

echo ""
echo "✅ 挖掘完成，看板仍在运行"
echo "   访问：http://localhost:8787"
echo "   按 Ctrl+C 停止"

wait $DASH_PID
