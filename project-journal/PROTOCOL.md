# 项目记录契约 . pain-to-mvp 痛点→MVP机会发现管线

> **契约版本：v1.5.0** —— 与本 skill 版本对应。落后时执行 `journal.py upgrade --root <本目录>` 升级。
> 本文件由 project-journal skill 在立项时生成，是整个项目的**记录宪法**。
> 任何 Agent、任何人接手这个项目，先读这一页，再干活。**不要删除本文件。**

## 1. 为什么要有这个文件夹

项目过程中的判断、踩过的坑、真实的数字，如果不落盘，三天后就只剩模糊印象；三个月后连"当时为什么这么选"都答不上来。
本文件夹是项目的**飞行记录仪**：它不参与交付，但它决定了这个项目结束后还能留下什么。
位置：**项目根目录下的 `project-journal/` 子文件夹**（建议随 git 一起提交——它本身就是这个项目的数字资产）。

记录的三类读者：
- **未来的你**：避免重复踩坑，复用有效动作
- **别的 AI / 协作者**：无需翻聊天记录即可接手
- **付费读者**（项目结束后的资产化）：真实过程 + 真实数字 + 真实教训

## 2. 持续跟踪的四个装置

| 装置 | 位置 | 作用 |
|---|---|---|
| 会话锚点 | 项目根 `AGENTS.md` 的 project-journal 托管块 | 让未来每次会话自动发现本协议 |
| 磁盘状态 | `STATE.md` + `tracker.json` | 30 秒恢复上下文，不依赖聊天历史 |
| 收尾捕获 | 本文件第 4 节 | 每次会话结束前把增量写入当日日记 |
| 心跳（可选） | 宿主定时任务 | 每日提醒补记 |

**核心规则：未记录 = 对后人而言没有发生过。**

## 3. 目录结构

```
PROTOCOL.md      本契约
CHARTER.md       立项宪章：目标 / 变现假设 / 成功线 / 止损线（不轻易改动）
STATE.md         自动生成的一页驾驶舱（勿手改）
INDEX.md         自动生成的全目录（勿手改）
NEXT-ACTIONS.md  未完成事项（手工维护，带 checkbox）
tracker.json     机器可读状态（勿手改）
sanitize.txt     对外发布时的脱敏规则
journal/         原始日记 YYYY-MM-DD.md（append-only）
records/         档案：decisions problems solutions experiments insights lessons risks milestones
metrics/         metrics.csv ledger.csv experiments.csv
reviews/         周/月复盘、终局档案
assets/          截图、导出、证据
publish/         脱敏后的可销售资产包
```

## 4.1 口令表（用户只需记这几个词）

| 用户说 | 动作 |
|---|---|
| **跟踪项目** / 跟踪 <项目名> | 首次 `init`；已存在 `resume` |
| **记一下** / 记录一下 | 把本次增量 `add` / `metric` / `ledger` 落盘 |
| **项目状态** | `status` 一行体检 |
| **复盘** | `review --period weekly|monthly` |
| **结项** | `closeout --outcome success|failure|pivot|paused` |
| **出资产** | `publish` 生成脱敏资产包 |

口语变体（"记一下今天的""这个项目怎么样了""能卖了吗"）按上表映射。口令只是入口，自然语言同样触发。

---

## 4.2 每次会话的标准动作

**开工（1 分钟）**
```bash
python "<skill>/scripts/journal.py" resume --root "<本目录>"
```
读完后用一句话向用户复述：阶段 / 卡在哪 / 下一步。

**干活中**
随时留意"值得记的瞬间"，先记在草稿里，不要打断工作节奏。

**收工（必做，5 分钟）**
1. 判断本次增量，逐条落盘：
```bash
journal.py add --type decision --title "..." --body-file /tmp/d.md
journal.py metric --name MRR --value 120 --unit USD --source Stripe
journal.py ledger --kind income --amount 99 --channel Gumroad
journal.py stage --set S3 --why "拿到首单"
```
2. 更新 `NEXT-ACTIONS.md`（勾掉完成的，补上新的开口）
3. `journal.py index` 然后 `journal.py lint`
4. 向用户汇报本次新增的条目 ID

## 5. MUST-RECORD 触发器（命中即记）

1. 任何"选 A 不选 B"的取舍，含**被否决的选项和被否决的理由**
2. 用户的偏好与红线（"不要这样 / 太贵 / 太慢"）
3. 认知更新（推翻先前假设的那一刻）
4. 耗时 > 15 分钟的困难，以及最终怎么绕过去的
5. 任何数字：价格、成本、转化率、耗时、用户数、收入、退款
6. 对外承诺、deadline、合同条款
7. 可能让项目死掉的风险、单点依赖
8. 可复用的步骤（打完就忘 = 白干）
9. **失败与放弃**：pivot、砍功能、关渠道、不做了（最值钱，最容易漏）

## 6. 铁律

1. **append-only**：日记与档案不删不改；更正就新增一条并标注 `[更正 <ID>]`
2. **禁止密钥与隐私**：API Key、密码、token、客户真实姓名/手机号/邮箱、身份证一律不得写入
3. **不编造**：数字、日期、引用没确认就写"待确认"
4. **不隔夜**：本次会话产生的条目在本次会话结束前落盘
5. **先读后写**：CAPTURE 前先 RESUME，避免重复 ID 与覆盖
6. **区分事实与判断**：主观判断标 `判断：`，客观事实标 `事实：`
7. 不要粘贴大段代码/日志/diff —— 给结论 + 证据存放位置

## 7. 质量三问（每条记录自检）

1. 换个人只看这条，懂不懂发生了什么、为什么？
2. 有证据吗？（数字/链接/截图路径/报错原文）
3. 下次遇到同类问题，能不能照着做？

## 8. 常用命令

```bash
journal.py status --root <本目录>            # 一行体检
journal.py resume --root <本目录>            # 生成补液包
journal.py add --type <T> --title "..." [--body-file f] [--tags a,b] [--link ADR-0001]
journal.py update --id PB-0003 --status solved --append-file f.md   # --body-file 同义
journal.py metric --name <> --value <> --unit <> [--source <>]
journal.py ledger --kind income|cost --amount <> [--currency <>] [--channel <>]
journal.py stage --set S1 --why "..."
journal.py review --period weekly|monthly
journal.py closeout --outcome success|failure|pivot|paused
journal.py publish
journal.py lint --strict
```

类型代码：`T` 任务 `D` 决策 `P` 问题 `S` 解法 `I` 认知 `X` 实验 `M` 指标 `$` 收入 `C` 成本 `R` 风险 `L` 教训 `MS` 里程碑 `Q` 开放问题

## 9. 记录系统自身的迭代

这套记录工具（project-journal skill）本身也在迭代。运行中如果遇到下面任何一种情况：

- 命令报错、退出码非 0、崩溃
- 参数/模板与文档不符，或模板字段根本填不进去
- 流程缺步骤、走不通，**你不得不绕过 skill 才能完成任务**
- 索引、配对、脱敏、STATE 等自动行为结果不对

**立刻记录，不要只在对话里说一句就算**：

`@bash
journal.py evolve --category bug --severity high --title "一句话现象" \
  --body-file <症状说明.md> --evidence "文件:行 / 输出片段" \
  --repro "复现命令" --project <本项目 slug>
`@

- `lint` 会检测结构性问题并打印 `[EVOLVE]` 提示；加 `--auto-evolve` 可自动写入台账
- 命令崩溃时脚本会自动记录（退出码 3）
- 台账：`<skill>/evolution/LEDGER.md`（跨项目共享，自动去重）

修复闭环：**先记录 → 改 → 跑 `scripts/selftest.py` → 升版本 + 写 CHANGELOG → 对已有项目 `upgrade`**。
细则见 skill 的 `references/08-self-evolution.md`。

> 铁律：先记录再修；每次修复必须过自测；必须升版本；**不许把本项目的隐私内容复制进台账**（只写引用路径与命令）。
