# 数据主权导出：你的数据可以一键带走

> 日期：2026-10-19 ｜ 工具：`scripts/export_backup.py`（零依赖）｜ 纪律：导出不裁剪、逐文件 sha256 可校验、恢复前强制校验

## 为什么要有这个

- 平台风险有真实样本：品类头部工具 GummySearch（Reddit 需求挖掘，约 $35K MRR）因平台 API 关停而退场——**数据锁在平台里的业务，平台风向一变就归零**。
- 本项目的立场反过来：挖掘产物（机会卡 / 证据 / 校准记录 / 看板 / 数据库）永远在用户可触及的目录里，并且可以一键打包、校验、恢复——「数据主权」从口号变成工具。

## 怎么用（三条命令）

```bash
# 1) 打包（默认打包仓库 data/ 全量 → pain-to-mvp-backup-<时间戳>.zip）
python scripts/export_backup.py create

# 2) 校验（逐文件重算 sha256 与清单比对）
python scripts/export_backup.py verify pain-to-mvp-backup-20261019-160000.zip

# 3) 恢复（先校验后恢复；目标非空默认拒绝，--force 覆盖）
python scripts/export_backup.py restore pain-to-mvp-backup-20261019-160000.zip --to restored-data/
```

## 打包内容与格式

- `data/` 全量：卡片（cards / projects）/ 校准记录 / dashboard.json / 数据库 / 原始产物；自动跳过 `__pycache__`
- 包内附 `manifest.json`：格式版本（`pain-to-mvp-backup/1`）+ 打包时间 + 逐文件 sha256 + 大小

## 校验原理与恢复安全

- `verify`：每个文件重算 sha256 比对；缺文件 / 内容变动 / 清单外文件全部报告（不静默）
- `restore`：**先校验通过才允许恢复**；目标目录非空默认拒绝；zip 内非法路径（`../`、绝对路径）直接拦截
- 空数据目录拒绝打包（fail-close，不做"成功导出 0 个文件"的假动作）

## 边界（如实说明）

- 备份**不加密**（本地数据自管）；需要传输时请先自行加密（如 7-Zip 密码包）
- 恢复是"整目录"语义：不合并、不覆盖非空目录（除非显式 `--force`）
