/**
 * 演示合成报告内核（demo）
 * ------------------------
 * 用途：前端全链路跑通时，不依赖真实解析/规则引擎，
 *      用 CASE-001 的 94/100 评估结果（见 验证与基准/CASE-001-对话记录.md）
 *      当"演示内核"，让 上传 → 免费预览 → 付费 → 报告 全链路可走完。
 *
 * 切真解析：后续 M1/M2 完成后，本模块被真实 reportData（解析 + 规则 + LLM）替换，
 *  页面不变，仅数据源切换（ADR 化的数据契约边界）。
 */

export type Attachment = "焦虑型" | "安全型" | "回避型";
export type RiskFlag = { level: "中" | "低"; label: string; advice: string };

export type ReportData = {
  score: number; // 健康度 0-100
  grade: "A" | "B" | "C";
  scoreLabel: string; // "健康" / "良好" / "待改善"
  attachment: Attachment;
  attachmentNote: string;
  replyBias: number; // 主动回复占比 %
  lateRatio: number; // 深夜发言占比 %
  shortRatio: number; // 短句占比 %
  initiativeNote: string;
  risks: RiskFlag[];
  turningPoint: { day: string; detail: string };
  actionPlan: { day: string; action: string; goal: string }[];
  summary: string;
  evidenceCount: number; // 证据引用条数
};

export const DEMO_REPORT: ReportData = {
  score: 94,
  grade: "A",
  scoreLabel: "健康",
  attachment: "安全型",
  attachmentNote:
    "回复节奏均衡、情绪稳定，多数冲突走向修复。你倾向于在问题出现时直接表达，而非反复复盘对话。",
  replyBias: 30,
  lateRatio: 12,
  shortRatio: 8,
  initiativeNote:
    "主动回复占 30%，被动 70%，整体处于健康区间（30-70 为均衡）。深夜发言偏少，节奏规律。",
  risks: [
    {
      level: "中",
      label: "冲突时语气可能升温",
      advice:
        "检测到 2 处语气升温点。建议在情绪高点先暂停 10 分钟再回复，用「我感觉…」开头代替指责。",
    },
    {
      level: "低",
      label: "偶尔有深夜集中回复",
      advice:
        "深夜会话占比 12%，略高于均值。若双方作息不同，约定一个「不即时回复」时段可减少焦虑。",
    },
  ],
  turningPoint: {
    day: "Day 47（示例）",
    detail:
      "一次分歧后双方在 2 小时内各发 5 条消息解释与道歉，是关系修复能力最强的节点。",
  },
  actionPlan: [
    {
      day: "Day 1",
      action: "把报告里 1 处冲突原文发给对方，问「你怎么看」",
      goal: "开启一次非指责式对话",
    },
    {
      day: "Day 2",
      action: "记录一次「我说了什么、对方如何反应」",
      goal: "建立自己的对话数据",
    },
    {
      day: "Day 3",
      action: "把 1 句指责改成「我感觉…」再发",
      goal: "练习非暴力表达",
    },
    {
      day: "Day 4",
      action: "约一次 15 分钟「只谈感受」的对话",
      goal: "练习修复性沟通",
    },
    {
      day: "Day 5",
      action: "复盘本周：哪一次对话最舒服？为什么",
      goal: "识别你的有效沟通模式",
    },
    {
      day: "Day 6",
      action: "对对方表达 1 件具体的感谢（非泛泛）",
      goal: "正向强化",
    },
    {
      day: "Day 7",
      action: "把 1 条规则（如「不深夜轰炸」）写进你们之间",
      goal: "把洞察固化为约定",
    },
  ],
  summary:
    "整体沟通健康度 94/100，属于关系中最稳定的前 10%。主要成长空间在冲突期的语气管理与深夜回复节奏。",
  evidenceCount: 12,
};

/** 上传文件名 / 说话人组合 → 报告（demo 阶段全部返回同一样本，后续接真数据时按 case 区分） */
export function makeReportFromInput(fileName: string, speakerA: string, speakerB: string): ReportData {
  return {
    ...DEMO_REPORT,
    summary: `（演示）基于 ${fileName} 中「${speakerA} ↔ ${speakerB}」的对话，整体沟通健康度 ${DEMO_REPORT.score}/100，属最稳定的前 10%。主要成长空间在冲突期语气管理。`,
  };
}
