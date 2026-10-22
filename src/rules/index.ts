/**
 * 规则层公共入口（M1 · FR-4 / FR-3 依恋预览 / §5.3 五维）
 *
 * UI / 报告层只需 `import { ... } from "@/rules"`：
 *   buildReportFeatures(conversation) → 全部特征（10 指标 + 依恋方向 + 五维 + 免费三卡）
 * 纯确定性：无 LLM、无随机、无 Date.now（报告层才注入生成时间）。
 */
export * from "./lexicons";
export * from "./metrics";
export * from "./attachment";
export * from "./health";
