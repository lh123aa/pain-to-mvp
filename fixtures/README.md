# fixtures/ · 脱敏样本纪律

> 本目录**只放脱敏后的聊天样本**，供 M1 适配器表驱动测试（fixture 矩阵 25）与 CI 使用。

## 铁律（与 PRD 全局约束「数据纪律」一致）

1. **真实聊天样本（chat.db / 导出 txt）永不进 git。** 原始件放本地 ignored 目录 `samples/raw/`（见 `.gitignore`）。
2. 进 `fixtures/` 的样本必须完成 PII 脱敏：姓名、手机号、邮箱、地址、精确时间戳偏移等，脱敏规则沿用报告 PII mask（FR-4）。
3. 每个 fixture 文件头部注释写明：来源（合成 / 真实脱敏）、消息数、平台（WhatsApp/iMessage/Paste）、目标断言（对应 AC-1.2 的哪一类方言）。
4. fixture 变更走 PR，附一句"脱敏已确认"的自检。

## 当前内容

**全部为手写合成会话（synthetic），不含任何真实聊天内容**；每个文件头部的 `#` 注释块写明来源、
消息数（`# expected-messages`）、平台、目标断言，解析层会把它当 preamble 而不计入消息。

| 文件 | 方言 / 目的 | 覆盖的 AC-1.2 类目 |
|---|---|---|
| `whatsapp/android-24h-dmy.txt` | Android 方括号 24h `DD/MM/YYYY`，42 条 + 3 条系统消息 | 多行消息、`<Media omitted>`、已删除消息、emoji、URL、系统行、>12 日字段（DMY 证据） |
| `whatsapp/ios-12h-mdy.txt` | iOS 12h `M/D/YY` + ` - ` 分隔，14 条 + 1 系统 | AM/PM、`<attached: …>`、`image omitted`、多行尾部、4/13 强制 MDY 证据 |
| `whatsapp/european-dots-crlf.txt` | 欧陆点分隔 24h `DD.MM.YYYY`，10 条 + 2 系统 | 日期歧义（需确认）、多行、媒体占位、中/英/德混排 |
| `paste/two-speaker.txt` | 无时间戳粘贴（9 条） | FR-3 无时序替代卡（AC-3.3）+ 粘贴保守解析 |

> 说明：CRLF 行尾与 U+202F 窄空格在 `src/__tests__/whatsapp-txt.test.ts` 里用内联输入覆盖
> （避免 fixture 文件里出现不可见字符造成 review 困难）。

补齐 fixture 矩阵 25 的剩余类目（转发文本伪时间戳行、改昵称的真实导出形态、多语言月份 en/es/de 的
真实样本、真实用户脱敏样本 5 份）挂在 M1 后续任务，本目录持续追加。
