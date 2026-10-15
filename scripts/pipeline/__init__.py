# pipeline package
# .env 统一加载（OPEN_ISSUES #10 / PRD §七）：所有带 UTF-8 稳定化块的入口脚本
# 都会 `from pipeline.encoding import ...`，必然先执行本包 __init__ —— 零接线覆盖
# 全部 CLI 入口。load_env 幂等：无 .env 返回 False，shell 环境变量优先不被覆盖。
try:
    from .env_loader import load_env

    load_env()
except Exception:
    pass  # .env 缺失/ dotenv 缺失都不阻塞：凭证可继续走 shell 环境变量
