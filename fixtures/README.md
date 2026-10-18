# fixtures/ · 脱敏样本纪律

> 本目录**只放脱敏后的聊天样本**，供 M1 适配器表驱动测试（fixture 矩阵 25）与 CI 使用。

## 铁律（与 PRD 全局约束「数据纪律」一致）

1. **真实聊天样本（chat.db / 导出 txt）永不进 git。** 原始件放本地 ignored 目录 `samples/raw/`（见 `.gitignore`）。
2. 进 `fixtures/` 的样本必须完成 PII 脱敏：姓名、手机号、邮箱、地址、精确时间戳偏移等，脱敏规则沿用报告 PII mask（FR-4）。
3. 每个 fixture 文件头部注释写明：来源（合成 / 真实脱敏）、消息数、平台（WhatsApp/iMessage/Paste）、目标断言（对应 AC-1.2 的哪一类方言）。
4. fixture 变更走 PR，附一句"脱敏已确认"的自检。

## 当前内容

（M1 起填充 fixture 矩阵 25：MM/DD vs DD/MM、有无方括号、`.` 分隔、多语言月份 en/es/de、消息内换行、转发文本伪时间戳行、改昵称、`<Media omitted>`、CRLF。）
