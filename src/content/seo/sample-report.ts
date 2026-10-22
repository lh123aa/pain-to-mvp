/**
 * The Tell · /sample 报告构建器（PRD FR-17 · AC-17.1）
 *
 * 为什么单独一个文件：
 * - `/sample` 必须在**服务端构建期**拿到一份真实 `ReportDataV2`，且不能依赖
 *   demo 数据（`lib/demo-report.ts` 是合成分数，本页禁止使用）；
 * - 管线是纯函数（parser / rules / report-engine 均无 DOM / 网络依赖），所以
 *   同一段代码可以被两处复用：`app/sample/page.tsx`（构建期渲染）与本目录的
 *   单测（用 fixtures 复算并断言"分数不是手写的"）。
 *
 * 确定性：`buildReportV2` 不读时钟；`generatedAt` 由对话最后一条消息的时间戳
 * 派生，因此同一份 fixture 两次构建结果逐字节一致（单测断言）。
 */
import {
  conversationFromChat,
  createSpeakerMap,
  parseWhatsAppTxt,
  type Conversation,
} from "@/parser";
import { buildReportFeatures, type ReportFeatures } from "@/rules";
import { buildReportV2 } from "@/lib/report-engine";
import type { ReportDataV2 } from "@/lib/report-contract";
import { SAMPLE_SPEAKERS } from "./sample";

export interface SampleReportBundle {
  /** 六章报告（由真实管线生成，不含任何硬编码分数）。 */
  readonly report: ReportDataV2;
  /** 规则层特征，单测用来证明 `report.headline.score` 确实来自计算。 */
  readonly features: ReportFeatures;
  /** 归一化对话，单测用来证明证据引用指向真实消息。 */
  readonly conversation: Conversation;
}

/**
 * 把一份 WhatsApp 导出文本变成样例报告。
 *
 * 失败就抛错，绝不回落到演示数据：构建期失败应该让构建停下来，而不是上线
 * 一份假分数页面。
 */
export function buildSampleReport(fixtureText: string): SampleReportBundle {
  if (fixtureText.trim().length === 0) {
    throw new Error("Sample fixture is empty — check fixtures/whatsapp/android-24h-dmy.txt");
  }

  const parsed = parseWhatsAppTxt(fixtureText);
  if (!parsed.ok) {
    const issue = parsed.issues.find((item) => item.severity === "error");
    throw new Error(
      `Sample fixture could not be parsed (${issue?.code ?? "unknown"}): ${issue?.message ?? "no details"}`,
    );
  }

  const mapping = createSpeakerMap(parsed.chat, {
    user: SAMPLE_SPEAKERS.user,
    partner: SAMPLE_SPEAKERS.partner,
  });
  if (mapping.status !== "confirmed") {
    throw new Error(`Sample fixture needs speaker confirmation: ${mapping.message}`);
  }

  const conversation = conversationFromChat(parsed.chat, mapping.map);
  const features = buildReportFeatures(conversation);
  const report = buildReportV2(features, conversation);

  return { report, features, conversation };
}
