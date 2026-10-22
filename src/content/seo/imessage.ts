/**
 * /analyzer/imessage · 文案（P-10 SEO 落地页 2/3 · PRD FR-11）
 *
 * 目标词：imessage analyzer / text message analyzer from an iPhone.
 * 诚实定位：iMessage 支持仍在 beta 验证（W0-A1 spike 的 go/no-go 尚未出结论）。
 * 因此本页只承诺"今天能用的"（WhatsApp .txt 与粘贴文本），把 chat.db 的 Mac
 * 路径写成教程 + beta 说明；绝不承诺读取 iCloud、Apple ID 或任何账号。
 * 所有字符串为英文，禁用词由单测做 0 命中检查。
 */
import { SHARED_LINKS } from "./shared";
import type { SeoPageCopy } from "./types";

export const IMESSAGE_PAGE: SeoPageCopy = {
  slug: "/analyzer/imessage",
  metaTitle: "iMessage Analyzer (Beta) — Export chat.db From a Mac",
  metaDescription:
    "An honest iMessage analyzer: how to find chat.db on a Mac, what beta means here, and why most tools skip iMessage. WhatsApp exports and pasted text work today.",
  eyebrow: "iMessage chat analyzer · Beta",
  h1: "iMessage analyzer: the honest beta version",
  lede:
    "iMessage is harder to export than WhatsApp, and pretending otherwise would waste your time. Here is the real Mac path to chat.db, what our beta does and does not do yet, and the two formats that work today.",
  badge: "Beta",
  cta: {
    href: "/analyze",
    label: "Open the analyzer",
    note: "WhatsApp .txt exports and pasted text work today · iMessage chat.db is in beta",
  },
  trust: [
    "Parsed in your browser",
    "No Apple ID or iCloud login",
    "Deleted after 90 days",
  ],
  howTo: {
    eyebrow: "The Mac path",
    heading: "How to get an iMessage database off a Mac",
    intro:
      "There is no one-tap iMessage export like WhatsApp's. If you already use Messages on a Mac, chat.db is a local file you can copy yourself — you do not need to give anyone access to your account.",
    steps: [
      {
        number: "01",
        title: "Find the Messages database",
        body: "On a Mac that already has your Messages history: open Finder, press Shift + Command + G, and enter ~/Library/Messages. If the folder is empty, Messages has never been signed in on this Mac and there is nothing to copy.",
      },
      {
        number: "02",
        title: "Copy chat.db and its companion files",
        body: "Copy chat.db together with chat.db-wal and chat.db-shm. The two companion files hold recent messages that have not been merged into the main database yet; copying only chat.db can silently lose the last few weeks.",
      },
      {
        number: "03",
        title: "Do not copy an encrypted backup",
        body: "If the database came from an encrypted iPhone backup, it cannot be read without the backup password. The Tell never asks you to decrypt anything or to remove encryption — a local copy from a signed-in Mac is the only path we support.",
      },
      {
        number: "04",
        title: "Keep the copy on your own device",
        body: "Once iMessage support leaves beta, the analyzer will read chat.db locally in your browser, the same way it reads a WhatsApp export. Until then, use a WhatsApp .txt export or paste the conversation as text.",
      },
    ],
    note: "Only export chats you have the right to share. The database is your copy of a conversation you took part in — see the notice for people in your chats.",
  },
  privacy: {
    eyebrow: "Privacy by architecture",
    heading: "No iCloud access, no Apple ID, no upload",
    intro:
      "iMessage is sensitive enough that the export path itself deserves scrutiny. Here is what we do and do not touch.",
    rows: [
      {
        number: "01",
        lead: "You copy the database yourself.",
        body: "We never log into your Apple account, never connect to iCloud, and never ask for an Apple ID or password. The file goes from your Mac to your browser — nowhere else.",
      },
      {
        number: "02",
        lead: "Parsing stays on your device.",
        body: "When the beta opens, chat.db will be read in the browser tab, like the WhatsApp export is today. After purchase only computed statistics and a few short quoted excerpts travel to us, with phone numbers and emails masked.",
      },
      {
        number: "03",
        lead: "Anything stored is deleted after 90 days.",
        body: "Automatic deletion, or one click from the report page. You can clear the local analysis from your browser at any time without contacting us.",
      },
    ],
  },
  cards: {
    eyebrow: "Why it is hard",
    heading: "Why most chat analyzers skip iMessage",
    intro:
      "The gap is not laziness. iMessage stores conversations in a format that was never designed for export.",
    items: [
      {
        number: "01",
        title: "It is a SQLite database, not a text file",
        body: "chat.db stores message bodies, timestamps, reactions and attachments across several tables. Some message text lives in an encoded field rather than plain text.",
      },
      {
        number: "02",
        title: "It lives inside a Mac library folder",
        body: "There is no share sheet for Messages. Getting the file means finding ~/Library/Messages, or restoring an unencrypted backup.",
      },
      {
        number: "03",
        title: "Encrypted backups are unreadable",
        body: "Most people have encryption turned on, which is good security and bad exportability. We will not ask you to weaken it.",
      },
      {
        number: "04",
        title: "Beta means beta",
        body: "Our parser is in validation against real databases. Until that completes, iMessage is labeled beta everywhere in the product, and the analyzer tells you before you upload anything.",
      },
    ],
  },
  limits: {
    eyebrow: "Current status",
    heading: "What works today, and what the beta does not do",
    intro:
      "We would rather lose a signup than let you plan around a feature that is not finished.",
    items: [
      "Working today: WhatsApp .txt exports (Android and iPhone) and pasted plain text.",
      "In beta: reading an exported chat.db in the browser. It is not offered as a normal upload path yet.",
      "Not planned: reading iCloud, Messages in iCloud, or any Apple account. There is no account connection of any kind.",
      "Not planned: iPhone-only export without a Mac. If you have no Mac with your Messages history, the paste and WhatsApp paths are the honest alternatives.",
      "Beta limitations to expect: reactions, edits and unsent messages may be dropped, and confidence is lower than a clean WhatsApp export.",
      "One-to-one conversations only. Group threads are not analyzed in any format.",
    ],
  },
  faq: {
    eyebrow: "Questions",
    heading: "Fair questions about the iMessage beta",
    items: [
      {
        question: "Does The Tell read my iCloud or Apple ID?",
        answer:
          "No. There is no iCloud connection, no Apple ID login, and no account linking anywhere in the product. If you use the beta you copy chat.db from your own Mac, and it is parsed in your browser.",
      },
      {
        question: "Is iMessage support available right now?",
        answer:
          "It is in beta and marked as such on this page and in the app. WhatsApp .txt exports and pasted text work today. chat.db support is being validated on real databases before it is offered as a normal path.",
      },
      {
        question: "Where is chat.db on a Mac?",
        answer:
          "Open Finder, press Shift + Command + G, and enter ~/Library/Messages. Copy chat.db along with chat.db-wal and chat.db-shm so recent messages are included.",
      },
      {
        question: "Can I use this without a Mac?",
        answer:
          "Not for chat.db. Without a Mac that has your Messages history there is nothing to copy, so use a WhatsApp .txt export or paste the conversation as plain text. The paste path also gets the free three-card preview.",
      },
      {
        question: "Why not just ask for my Apple ID?",
        answer:
          "Because asking for account credentials is exactly the kind of access a private analyzer should never need. Your messages are yours; a local copy you control is the only model we are willing to build on.",
      },
      {
        question: "Can I analyze a group thread?",
        answer:
          "No, in any format. A report has to attribute every message to one of two people, so threads with more than two active participants are refused with a clear message.",
      },
    ],
  },
  finalCta: {
    heading: "Want a real report today? Start with WhatsApp or paste.",
    label: "Open the analyzer",
    note: "WhatsApp .txt exports and pasted text work today · No account needed",
  },
  links: [
    { href: "/analyzer/whatsapp", label: "WhatsApp chat analyzer" },
    { href: "/analyzer/attachment-style-test", label: "Attachment style from texts" },
    ...SHARED_LINKS,
  ],
};
