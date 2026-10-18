.PHONY: help demo test test-unit doctor serve clean

help:
	@echo "Pain-to-MVP 常用命令："
	@echo "  make doctor     - 系统自检"
	@echo "  make demo       - 离线演示"
	@echo "  make test       - 端到端测试（B站，需网络凭证）"
	@echo "  make test-unit  - 单元测试（离线，CI 同款）"
	@echo "  make serve      - 启动看板"
	@echo "  make clean      - 清理缓存"

doctor:
	python scripts/doctor.py

demo:
	python scripts/demo.py

test:
	python scripts/e2e_test.py --keyword "独立开发者" --platform bilibili --limit 10 --comments 100

test-unit:
	python -m pytest tests/ -q

serve:
	python scripts/dashboard/serve.py --port 8787

clean:
	rm -rf data/cache/* data/raw/*.jsonl data/discovered/* data/pains/* data/scored/* __pycache__ scripts/**/__pycache__
	@echo "✅ 已清理"
