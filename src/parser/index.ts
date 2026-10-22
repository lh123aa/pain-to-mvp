/**
 * 解析层公共入口（M1 · FR-1 / FR-2）
 *
 * UI 只需 `import { ... } from "@/parser"`：
 *   parseWhatsAppTxt / parsePastedText → ParsedChat
 *   createSpeakerMap → 用户确认前一律 needsConfirmation
 *   conversationFromChat → Conversation（规则层唯一输入）
 *   detectInputFormat → 上传页 Tab / 文件护照卡
 */
export * from "./types";
export * from "./whatsapp-txt";
export * from "./paste";
export * from "./speaker-map";
