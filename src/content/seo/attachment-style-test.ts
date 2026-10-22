/**
 * /analyzer/attachment-style-test · 文案（P-10 SEO 落地页 3/3 · PRD FR-11）
 *
 * 目标词：attachment style from texts / attachment style test。
 * 定位：免费三卡钩子（回复节奏差 / 谁先开启 / 夜间占比）+ 依恋方向预览 +
 * 方法论与局限说明；不承诺"性格测验"式结论，不出现临床词汇。
 * 所有字符串为英文，禁用词由单测做 0 命中检查。
 */
import { SHARED_LINKS } from "./shared";
import type { SeoPageCopy } from "./types";

export const ATTACHMENT_STYLE_PAGE: SeoPageCopy = {
  slug: "/analyzer/attachment-style-test",
  metaTitle: "Attachment Style From Texts — Free Three-Card Test",
  metaDescription:
    "An attachment style test that reads the messages instead of a questionnaire. Free three-card preview first, then an evidence-linked report when you want more.",
  eyebrow: "Attachment style test",
  h1: "Attachment style from texts: a free test with no questionnaire",
  lede:
    "Most attachment style tests ask you to rate yourself. This one reads the conversation: how fast each of you replies, who starts, and what happens after a gap. Start with three free cards — no account, no payment, no upload.",
  cta: {
    href: "/analyze",
    label: "See my free three cards",
    note: "Free preview · No account needed · Your chat file stays in your browser",
  },
  trust: [
    "Free three-card preview",
    "Parsed in your browser",
    "Evidence-linked findings",
  ],
  howTo: {
    eyebrow: "How it works",
    heading: "Four steps from export to three cards",
    intro:
      "You do not fill anything in. The cards come from counting rules applied to the messages themselves — which is also why they are reproducible and why they can quote their evidence.",
    steps: [
      {
        number: "01",
        title: "Export one conversation",
        body: "Use WhatsApp's own export (Without media) or paste the conversation as plain text. One-to-one chats only — a report needs exactly two speakers.",
      },
      {
        number: "02",
        title: "Let your browser parse it",
        body: "The file is read in the tab. Nothing is uploaded, and you can disconnect from the internet to prove it. If the date format is ambiguous, you confirm it before any timing number is calculated.",
      },
      {
        number: "03",
        title: "Confirm who is who",
        body: "Lock the two names so every number in the report is attributed correctly. The analyzer will not show results before you confirm.",
      },
      {
        number: "04",
        title: "Read your three cards",
        body: "Reply pace gap, who starts the conversation, and late-night messages — then decide whether the full six-chapter report is worth paying for.",
      },
    ],
    note: "Only export chats you have the right to share. The report is a mirror for you, not ammunition for a fight.",
  },
  privacy: {
    eyebrow: "Privacy by architecture",
    heading: "The test runs in your browser, not on our servers",
    intro:
      "A page that asks you to look closely at a relationship has to earn that trust. This is the mechanism, not a promise.",
    rows: [
      {
        number: "01",
        lead: "Your chat file is never uploaded.",
        body: "Parsing happens in this tab. Turn off your network and the analysis still runs — the free cards and the attachment preview are computed locally by deterministic rules.",
      },
      {
        number: "02",
        lead: "After purchase, only the numbers travel.",
        body: "We receive computed statistics and a few short quoted excerpts, with phone numbers and emails masked automatically. Never the full conversation.",
      },
      {
        number: "03",
        lead: "Anything stored is deleted after 90 days.",
        body: "Automatic deletion, or one click from the report page. The local analysis can be cleared from your browser without contacting us.",
      },
    ],
  },
  cards: {
    eyebrow: "The free preview",
    heading: "Three cards. No sign-up, no payment.",
    intro:
      "These are the hook, and they are honestly labelled hooks: three measured signals that are interesting on their own and become a full report only when you add the paid chapters.",
    items: [
      {
        number: "01",
        title: "Reply pace gap",
        body: "How long each of you takes to reply, and whether the gaps are balanced or consistently one-sided. Timing only — no inference about feelings.",
      },
      {
        number: "02",
        title: "Who starts the conversation",
        body: "The share of conversations each of you begins after a real break, counted from the first message rather than from midnight.",
      },
      {
        number: "03",
        title: "Late-night messages",
        body: "The fraction of messages sent late at night. Often where the more anxious side of a conversation shows up — and often where it does not, which the card says too.",
      },
    ],
  },
  limits: {
    eyebrow: "What the labels mean",
    heading: "Four leanings, described behaviourally",
    intro:
      "The rule engine assigns one direction per person from behavioural signals. Each label describes patterns in this chat — not a personality, and not a permanent trait.",
    items: [
      "Anxious-leaning: reaches for contact when distance appears — faster replies, more follow-ups, more re-opening of a topic.",
      "Avoidant-leaning: creates space when things get close or tense — slower replies, shorter answers, moving away from conflict.",
      "Secure-leaning: a steady pace — initiates and responds, repairs after conflict, without wild swings in either direction.",
      "Mixed signals: different patterns in different moments. Reported honestly when no direction dominates, instead of forcing a label.",
      "Not a type: attachment language here describes patterns in one conversation, not who someone is.",
      "Not a verdict: no compatibility score, no prediction of a breakup, no advice about whether to stay.",
    ],
  },
  faq: {
    eyebrow: "Questions",
    heading: "Fair questions about the attachment test",
    items: [
      {
        question: "How does attachment style from texts work?",
        answer:
          "The rules look at observable behaviour: reply latency, who initiates conversations, message balance, follow-up messages, question rate, late-night share and repair language after conflict. The direction label is computed deterministically in your browser and every claim in the paid report links back to the messages that support it.",
      },
      {
        question: "Is the three-card preview really free?",
        answer:
          "Yes. No account and no payment. You export or paste a conversation, confirm the two speakers, and read reply pace gap, who starts the conversation, and late-night messages without paying anything.",
      },
      {
        question: "Do I need to upload my chat?",
        answer:
          "No. The file is parsed in your browser and never uploaded. After purchase we receive only computed statistics and a few short quoted excerpts with phone numbers and emails masked, and that data is deleted after 90 days.",
      },
      {
        question: "Can I take the test without timestamps?",
        answer:
          "Yes. Pasted conversations without timestamps use alternative cards — message balance and double texts — and the report states that timing could not be measured instead of inventing it.",
      },
      {
        question: "Is an attachment style a fixed label?",
        answer:
          "No. Patterns shift with context and with who you are talking to. That is why the report uses leaning language, shows the scores behind the label, and marks how confident it is. It does not assign a permanent type.",
      },
      {
        question: "What do I get if I pay?",
        answer:
          "The full six-chapter report: at-a-glance scores, attachment patterns for both sides with the signals behind them, communication health with ten measures, turning points, evidence with confidence, and a seven-day action plan. It is a one-time $14.99 with a 7-day refund window.",
      },
    ],
  },
  finalCta: {
    heading: "Start with three cards. Pay only if the report earns it.",
    label: "See my free three cards",
    note: "Free preview · From $14.99 for the full report · No subscription",
  },
  links: [
    { href: "/analyzer/whatsapp", label: "WhatsApp chat analyzer" },
    { href: "/analyzer/imessage", label: "iMessage analyzer (beta)" },
    ...SHARED_LINKS,
  ],
};
