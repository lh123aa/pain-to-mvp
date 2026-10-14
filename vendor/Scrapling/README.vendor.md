# vendor/Scrapling

[Scrapling](https://github.com/D4Vinci/Scrapling) v0.4.15（BSD-3）源码副本，
2026-10-14 从 `E:\程序\Scrapling` 完整复制（不含 `.git`）。

## 用途

B站适配器（`scripts/pipeline/adapters/bilibili.py`）的首选 HTTP 传输层：
Scrapling 的 `Fetcher` 做 TLS/JA3 指纹伪装，降低触发 B站 `v_voucher`
人机验证风控的概率（对应 `docs/OPEN_ISSUES.md` 外部风险第一条）。

**合规边界**：只使用"降低误伤"的指纹伪装能力；`v_voucher` 检测与
"不绕过验证码"的报错逻辑保持不变。缺失 Scrapling 时自动回退 `requests`。

## 注意

- 本目录**不在运行路径上**（不加 `sys.path`）：运行时用的是 pip 安装版
  （editable → `E:\程序\Scrapling`）。此副本仅作源码留档与离线恢复用，
  与 `scripts/pipeline/.libs` 曾出现的 vendored 库污染 sys.path 事故
  刻意区分。
- 本目录自带 `tests/`，与项目根 `tests/` 无关，pytest 只跑项目根 `tests/`。
- 升级：更新 pip 安装版后，重新复制 `scrapling/` 包覆盖本目录的
  `scrapling/`，并更新本文件版本号。
