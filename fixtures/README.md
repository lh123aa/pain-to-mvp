# fixtures/ · 合成聊天样本矩阵（M1 fixture 矩阵 25+）

> 本目录只放**脱敏/合成**聊天样本，供 M1 适配器表驱动测试与 CI 使用。
> 当前 **28 份**（whatsapp 25 + paste 3），**全部为手写合成或确定性生成，不含任何真实聊天内容**。

## 铁律（与 PRD 全局约束「数据纪律」一致）

1. **真实聊天样本（chat.db / 导出 txt）永不进 git。** 原始件放本地 ignored 目录 `samples/raw/`（见 `.gitignore`）。
2. 进 `fixtures/` 的样本必须完成 PII 脱敏；本矩阵为全合成，不含真实姓名/号码/地址。
3. 每份 fixture 文件头注释写明：`# fixture:` / 来源（synthetic）/ 平台与格式 / `# category:` / `# expected-messages:` / `# expected-system:` / `# asserts:`；失败态额外写 `# expected-ok: false`。
4. fixture 变更走 PR，附一句"合成/脱敏已确认"的自检。

> **唯一例外**：`whatsapp/empty-file.txt` 是 0 字节文件（覆盖"0 消息空文件"边界），无法携带文件头；其预期登记在本 README 与测试矩阵表中（parser=whatsapp, messages=0, system=0, ok=false, 期望 E-3）。

## 表驱动断言

`src/__tests__/whatsapp-txt.test.ts` 的 **「fixture matrix · table-driven parser assertions」** 维护
`FIXTURE_MATRIX`（28 行）：每行断言 `消息数 / 系统消息数 / 日期顺序（+来源/是否需确认）/ 说话人数 / ok / 警告码`，
并交叉校验文件头声明的 `expected-messages` / `expected-system` / `category` 与表一致（文档不漂移）。
另有「fixture inventory · ≥25 unique, complete table coverage」断言：目录内 fixture ≥25、文件名唯一、
**目录内容与矩阵表完全一一对应**、五类覆盖计数、BOM/U+202F/U+200E/CRLF 真实字节、>5k 单行长消息。

## 覆盖矩阵（28）

| # | 文件（fixtures/） | 类别 | 覆盖 / 断言点 |
|---|---|---|---|
| 1 | `whatsapp/android-24h-dmy.txt` | 方言 | Android 方括号 24h `DD/MM/YYYY` + 秒；多行/媒体/已删除/emoji/URL/系统行；DMY 证据（42 消息 + 3 系统） |
| 2 | `whatsapp/ios-12h-mdy.txt` | 方言 | iOS 12h `M/D/YY AM/PM`、` - ` 分隔；`<attached:>`/`image omitted`、多行尾部；MDY 证据（14+1） |
| 3 | `whatsapp/european-dots-crlf.txt` | 方言 | 欧陆点分隔 24h；**真 CRLF**；日期歧义 → DMY 启发式 + 需确认；中/英/德混排（10+2） |
| 4 | `whatsapp/android-no-seconds.txt` | 方言 | Android 无方括号、**无秒**（precision=minute）、en/em dash 分隔；DMY 证据（5） |
| 5 | `whatsapp/iso-ymd.txt` | 方言 | ISO `YYYY-MM-DD` → YMD，无日月歧义（4） |
| 6 | `whatsapp/month-names-es.txt` | 方言 | 西班牙语月份名 `12 de enero de 2026` → DMY 高置信（4） |
| 7 | `whatsapp/month-names-de.txt` | 方言 | 德语月份名 + 变音 `3. März 2026` → DMY 高置信（4） |
| 8 | `whatsapp/month-first-en.txt` | 方言 | 英文月份在前 `Mar 4, 2026, 9:15 AM` → MDY 高置信（4） |
| 9 | `whatsapp/encoding-bom-narrow.txt` | 方言 | **UTF-8 BOM** + **U+202F** 窄空格 + **U+200E** LRM；BOM 去除/窄空格归一化（4） |
| 10 | `whatsapp/system-messages-heavy.txt` | 内容 | 系统消息：端到端加密/入群/加人/改主题/移人（5 系统 + 3 消息） |
| 11 | `whatsapp/media-deleted-calls.txt` | 内容 | `<Media omitted>`/`<attached:>`/image/video/sticker + 已删除 + 语音/视频未接（8） |
| 12 | `whatsapp/multiline-and-forwarded.txt` | 内容 | 多行合并 + **已知限制**：转发内容里的伪时间戳行会被当作新消息（3，文件头注明） |
| 13 | `whatsapp/emoji-mixed-scripts.txt` | 内容 | emoji 云 + 中文/西里尔/阿拉伯文 + 带参 URL + **空消息体**（6） |
| 14 | `whatsapp/long-line-5k.txt` | 内容 | **单条消息 >5000 字符**不截断不拆行（2，生成式合成填充） |
| 15 | `whatsapp/empty-file.txt` | 内容 | **0 字节空文件** → E-3 + 日期歧义警告、ok=false（README 例外说明） |
| 16 | `whatsapp/single-message.txt` | 内容 | 单条消息不崩、1 说话人、W-SMALL-SAMPLE（1） |
| 17 | `whatsapp/one-sided-only-speaker.txt` | 内容 | **只有一方发言** → 1 说话人（会话层后续 W-PARTNER-SILENT）（4） |
| 18 | `whatsapp/year-boundary-leap.txt` | 时间 | **跨年** 2023→2024 + **闰日 29/02/2024**（4） |
| 19 | `whatsapp/midnight-crossing.txt` | 时间 | **23:59:59 → 00:00:05** 跨午夜，日期/间隔正确（4） |
| 20 | `whatsapp/clock-anomalies.txt` | 时间 | **恰 6h 仍同会话**、+6h 时钟跳变（时区近似）、**乱序时间戳**；源序保留、负间隔不计回复（5） |
| 21 | `whatsapp/late-night-window.txt` | 时间 | 深夜窗口严格 23:00–04:59（22:59 与 05:00 不算）；wall-clock 口径（4） |
| 22 | `whatsapp/date-only-no-time.txt` | 时间 | **只有日期无时间**：按设计不猜时间 → E-3（UI 应引导 paste，PRD E-3 原文）；ok=false |
| 23 | `whatsapp/speakers-rename.txt` | 说话人 | **改名** Alice→Al 非重叠 → 3 sender + W-RENAME-SUSPECTED（5） |
| 24 | `whatsapp/speakers-similar-names.txt` | 说话人 | 相似名 Alex/Alexandra 保持两人，不做前缀猜并（4） |
| 25 | `whatsapp/speakers-group-third-party.txt` | 说话人 | **第三方名字出现 / 群聊 >2 人** → W-RENAME-SUSPECTED；speaker-map 判 E-4（6） |
| 26 | `paste/two-speaker.txt` | 粘贴 | **不带时间戳**粘贴：`Name: text` 保守解析 + 多行续行；替代卡口径（9） |
| 27 | `paste/paste-with-timestamps.txt` | 粘贴 | **带时间戳**粘贴：header 占比 ≥30% → 委托 WhatsApp 解析器（platform=whatsapp）（4） |
| 28 | `paste/paste-mixed-labels-and-headers.txt` | 粘贴 | **混合**：有 header + 无时间戳行 → 委托 WA，未带时间戳行并入上一条（6） |

> 类别计数：方言 9 · 内容 8 · 时间 5 · 说话人 3 · 粘贴 3 = **28**（whatsapp 25 + paste 3）。

## 已知限制 / 下一波

- 转发内容中的**伪时间戳行**无法与真实 header 区分（纯文本格式极限，见 #12）。
- **只有日期无时间**的方言明确不支持（不静默猜时间，走 E-3 → paste 降级，见 #22）。
- 真实用户脱敏样本 5 份（PRD AC-1.2 另一项）仍待提供；本矩阵目前只有合成样本。
- 2026 年 2 月无 29 日，闰日夹具使用 2024-02-29；非法日期（如 29/02/2025）由内联单测覆盖（W-INVALID-DATE）。
