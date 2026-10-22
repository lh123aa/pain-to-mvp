/**
 * /analyzer/whatsapp · 文案（P-10 SEO 落地页 1/3 · PRD FR-11）
 *
 * 目标词：whatsapp chat analyzer / whatsapp chat analysis。
 * 页面结构：导出教程（HowTo）· 隐私承诺 · 报告内容 · 诚实边界 · FAQ · CTA。
 * 所有字符串为英文；禁用词与"读取 iCloud/微信/QQ"式承诺由单测做 0 命中检查。
 */
import { SHARED_LINKS } from "./shared";
import type { SeoPageCopy } from "./types";

export const WHATSAPP_PAGE: SeoPageCopy = {
  slug: "/analyzer/whatsapp",
  metaTitle: "WhatsApp Chat Analyzer — Export, Analyze, Understand",
  metaDescription:
    "Export a WhatsApp conversation and get a private, evidence-based report on attachment patterns and communication health. Parsed in your browser, never uploaded.",
  eyebrow: "WhatsApp chat analyzer",
  h1: "WhatsApp chat analyzer: see what your messages actually show",
  lede:
    "Export a one-to-one WhatsApp conversation, confirm who said what, and read a report built from the messages themselves — reply timing, who starts conversations, attachment patterns, and a seven-day plan. The file is parsed in your browser, not on our servers.",
  cta: {
    href: "/analyze",
    label: "Analyze my WhatsApp chat",
    note: "Takes about 1–5 minutes · From $14.99 · No subscription · Your chat file stays in your browser",
  },
  trust: [
    "Parsed in your browser",
    "No account needed",
    "Deleted after 90 days",
  ],
  howTo: {
    eyebrow: "How to export",
    heading: "How to export a WhatsApp chat (Android and iPhone)",
    intro:
      "WhatsApp builds the export for you. The whole job takes under a minute, and you only need the text version — photos and voice notes add nothing to the analysis.",
    steps: [
      {
        number: "01",
        title: "Open the conversation",
        body: "Open the one-to-one WhatsApp chat you want to look at. Group chats are not supported — a report only works when every message can be attributed to one of two people.",
      },
      {
        number: "02",
        title: "Tap the chat name",
        body: "Open the contact or group header, scroll down, and choose Export chat. On iPhone the same option sits under Contact info at the bottom of the screen.",
      },
      {
        number: "03",
        title: "Choose Without media",
        body: "Text only. A media export becomes a zip file that the analyzer cannot read, and it is far larger than it needs to be.",
      },
      {
        number: "04",
        title: "Send the .txt file to your computer",
        body: "Share it with yourself, then open the analyzer and drop the file in. Your browser reads it locally — the file itself never travels to us.",
      },
    ],
    note: "Only export chats you have the right to share. It is your own copy of a conversation you took part in — see the notice for people in your chats.",
  },
  privacy: {
    eyebrow: "Privacy by architecture",
    heading: "Your export is parsed in your browser, never uploaded",
    intro:
      "This is the part most chat analyzers get wrong. Here is exactly what happens to your file, in the order it happens.",
    rows: [
      {
        number: "01",
        lead: "The file itself never leaves your device.",
        body: "Parsing happens inside this browser tab. You can turn off your internet mid-upload and the analysis still runs — that is the simplest way to check the claim yourself.",
      },
      {
        number: "02",
        lead: "After purchase, only the numbers travel.",
        body: "We receive computed statistics and a few short quoted excerpts, with phone numbers and emails masked automatically. Never your full chat, and never your contacts.",
      },
      {
        number: "03",
        lead: "Anything stored is deleted after 90 days.",
        body: "Automatic deletion, or one click from the report page at any time. You can also clear the local analysis from your browser without contacting us.",
      },
    ],
  },
  cards: {
    eyebrow: "Inside the report",
    heading: "Six chapters built from one export",
    intro:
      "Every observation is tied to a message you can check. When the evidence is thin, the report says so instead of guessing.",
    items: [
      {
        number: "01",
        title: "Attachment patterns",
        body: "How each of you reaches for closeness, and what happens when it is threatened. Written as a leaning — anxious, avoidant, secure or mixed — not as a fixed type.",
      },
      {
        number: "02",
        title: "Communication health",
        body: "Reply timing, who starts conversations, late-night share, message balance, and how conversations tend to end.",
      },
      {
        number: "03",
        title: "Turning points",
        body: "The moments the timeline itself supports — a quiet week, a repair, a change of pace — each anchored to the messages that show it.",
      },
      {
        number: "04",
        title: "Evidence and confidence",
        body: "Quoted messages with dates, a confidence level for each finding, and a plain list of what the report cannot see.",
      },
      {
        number: "05",
        title: "Next 7 days",
        body: "One concrete action a day, with the reason it was chosen for this conversation and a stop condition if it is not working.",
      },
      {
        number: "06",
        title: "What we do not know",
        body: "A full chapter on the limits of reading text — no mind-reading, no verdicts, no invented feelings.",
      },
    ],
  },
  limits: {
    eyebrow: "Honest limits",
    heading: "What a WhatsApp analyzer can and cannot do",
    intro:
      "You are about to make a decision based on this report. These are the constraints you should know before you start.",
    items: [
      "It reads text and timestamps. Photos, voice notes, stickers and calls are not analyzed.",
      "It works on one-to-one chats. Group conversations are refused because conclusions have to be attributable.",
      "It describes observable patterns in this export, not what either of you was feeling at any moment.",
      "It does not rate your relationship as good or bad, does not predict a breakup, and does not tell you what to do about your future.",
      "Tone is inferred from words, punctuation and timing. Sarcasm and inside jokes can read wrong — the report marks its confidence for that reason.",
      "Messages you deleted or never sent are not in the export, so they are not in the report.",
    ],
  },
  sampleTeaser: {
    tag: "Sample",
    heading: "Read a full report before you decide",
    body: "A synthetic WhatsApp conversation, run through the same parser and rules engine: six chapters, a real headline score, quoted evidence and the seven-day plan. Nothing on that page is a hand-written demo.",
    href: "/sample",
    label: "See the full sample report",
  },
  faq: {
    eyebrow: "Questions",
    heading: "Fair questions about the WhatsApp analyzer",
    items: [
      {
        question: "Is my WhatsApp chat uploaded anywhere?",
        answer:
          "No. The .txt export is opened and parsed by your browser, and the file itself never leaves your device. After purchase we upload only computed statistics and a few short quoted excerpts with phone numbers and emails masked. Anything stored on our side is deleted after 90 days automatically, or in one click.",
      },
      {
        question: "Which WhatsApp exports work?",
        answer:
          "WhatsApp's own .txt export from Android or iPhone, including 12-hour and 24-hour timestamps. If the date order cannot be inferred (for example 03/04/26), the analyzer asks you to confirm the format before any timing number is calculated. You can also paste a conversation as plain text.",
      },
      {
        question: "Can I analyze a group chat?",
        answer:
          "Not in this version. A report has to attribute every message to one of two people, so groups with more than two active participants are refused with a clear message rather than guessed at.",
      },
      {
        question: "Do I have to export without media?",
        answer:
          "Yes, choose Without media. With media, WhatsApp produces a zip archive that the analyzer cannot read. The text export is also far smaller and faster to process.",
      },
      {
        question: "What does the free preview include?",
        answer:
          "Three cards before you pay: reply pace gap, who starts the conversation, and late-night messages. The full six-chapter report adds attachment patterns, turning points, quoted evidence and the seven-day plan.",
      },
      {
        question: "Is this a professional assessment?",
        answer:
          "No. The Tell is a self-reflection tool. It describes message patterns, labels how confident it is, and is explicit about what it cannot see. It is not a substitute for professional advice.",
      },
    ],
  },
  finalCta: {
    heading: "You have read the messages enough times. See what they add up to.",
    label: "Analyze my WhatsApp chat",
    note: "Takes about 1–5 minutes · From $14.99 · No subscription",
  },
  links: [
    { href: "/analyzer/attachment-style-test", label: "Attachment style from texts" },
    { href: "/analyzer/imessage", label: "iMessage analyzer (beta)" },
    ...SHARED_LINKS,
  ],
};
