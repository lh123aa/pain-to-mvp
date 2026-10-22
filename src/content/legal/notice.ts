/**
 * /notice —— 「致你聊天记录里的人」第三方告知页（英文正文）
 * 依据：UIUX §10 /notice 行（谁的数据·合法利益·不存原文·90 天删除·反对/删除邮箱）
 *      + PRD FR-9「第三方含未成年人数据」LIA 必答题；合法利益论证见 documentation/LIA-v1.md
 * 读者：没有购买产品、但出现在被分析对话里的人
 */
import {
  CONTACT_EMAIL,
  DATA_LAYERS,
  EFFECTIVE_DATE,
  LEGAL_VERSION,
  MIN_AGE,
  RETENTION_DAYS,
} from "./shared";
import type { LegalDoc } from "./types";

export const NOTICE: LegalDoc = {
  slug: "/notice",
  title: "Notice for people in your chats",
  description:
    "If someone analysed a conversation you were part of, this page explains exactly what The Tell holds about you, why, how long, and how to object or have it deleted.",
  eyebrow: "For the other person",
  version: LEGAL_VERSION,
  updated: EFFECTIVE_DATE,
  intro:
    "You are reading this because someone you talk to used The Tell on a conversation that includes you. You did not sign up for anything, you have no account with us, and this page exists to tell you exactly what that means — in plain English, without the flattery.",
  sections: [
    {
      id: "what-happened",
      heading: "What happened",
      blocks: [
        {
          kind: "steps",
          items: [
            {
              title: "Someone exported a conversation",
              text: "A person in a conversation you are part of exported their own copy of it, the same way anyone can in WhatsApp or iMessage.",
            },
            {
              title: "It was read on their device",
              text: "The Tell read that export inside their browser. The file was not uploaded to us, and we never saw the conversation.",
            },
            {
              title: "A reduced dataset reached us",
              text: "Only after they paid: computed statistics about the conversation, and a few short excerpts with phone numbers and email addresses masked.",
            },
            {
              title: "A report was generated for them",
              text: "The report is theirs, tied to their email address. We did not contact you, and we have no way to contact you.",
            },
          ],
        },
      ],
    },
    {
      id: "what-we-hold",
      heading: "What we hold about you",
      blocks: [
        {
          kind: "p",
          text: "Very little, and mostly not about you as an individual. Our dataset is about the conversation: aggregate measures such as reply timing, who initiated more often, and how conflicts were repaired. It is not a copy of the conversation and it is not a profile of you.",
        },
        {
          kind: "table",
          head: ["Layer", "What it holds", "How long", "Why"],
          rows: DATA_LAYERS.map((l) => [l.layer, l.what, l.retention, l.why]),
        },
        {
          kind: "list",
          items: [
            "**No full transcript.** We never receive the conversation, so there is nothing to read through.",
            "**No names, phone numbers, or email addresses of yours.** If they appeared in an excerpt, they were masked before upload.",
            "**No contact with you.** We do not email you, message you, or notify you in any way.",
            "**No sale, no sharing, no training.** Nothing from the conversation is sold, shared with advertisers, or used to train models.",
          ],
        },
      ],
    },
    {
      id: "lawful-basis",
      heading: "Why we are allowed to do this",
      blocks: [
        {
          kind: "p",
          text: "We rely on legitimate interests under Article 6(1)(f) of the GDPR. In plain terms, two interests, weighed against yours: the person who paid wants to reflect honestly on their own relationship, and we want to provide a tool that helps them do it.",
        },
        {
          kind: "p",
          text: "We are not claiming your consent. You never gave one, and we will not pretend otherwise. That is exactly why the design is minimal: the file stays on their device, only a reduced dataset reaches us, it is kept for a short, fixed period, and it is never shown to anyone else.",
        },
        {
          kind: "p",
          text: "We documented this balancing test before launch. If you want the reasoning, ask for it — that is a reasonable request and we will send it.",
        },
      ],
    },
    {
      id: "objection",
      heading: "Your right to object",
      blocks: [
        {
          kind: "p",
          text: `Email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) with “Objection” in the subject line. Tell us anything that helps locate the record: roughly when this happened, the other person's email address if you know it, or the email you think was used.`,
        },
        {
          kind: "p",
          text: "We will search for matching records and delete or restrict them. You do not need to prove who you are beyond what is necessary to find the right record, and you do not need to be a customer.",
        },
        {
          kind: "p",
          text: "We answer within 30 days and aim for 7. If we cannot find any record matching what you described, we will tell you that plainly rather than leave you guessing.",
        },
      ],
    },
    {
      id: "rights",
      heading: "Access, erasure, and complaints",
      blocks: [
        {
          kind: "list",
          items: [
            "**Access.** Ask what we hold that relates to you. Because our dataset is about a conversation rather than a person, we will explain the limits of what can be separated out.",
            "**Erasure.** Ask us to delete the analysis data. We delete within 7 days, and we confirm when it is done.",
            "**Restriction.** Ask us to stop processing while a request is being handled.",
            "**Complaint.** Complain to your local supervisory authority, without needing to contact us first.",
          ],
        },
        {
          kind: "p",
          text: `Anything not deleted on request is deleted automatically ${RETENTION_DAYS} days after the report was generated. The full data model is on the [privacy policy](/privacy).`,
        },
        {
          kind: "note",
          title: "Minors",
          text: `The Tell is sold to people aged ${MIN_AGE} and over, and we do not target data belonging to anyone younger. If you are a parent or guardian and believe a child's messages were processed, write to us and we will delete the analysis data.`,
        },
      ],
    },
    {
      id: "boundaries",
      heading: "What we cannot do",
      blocks: [
        {
          kind: "p",
          text: "Some requests are not ours to grant, and it is more respectful to say so than to sound helpful:",
        },
        {
          kind: "list",
          items: [
            "**We cannot tell you who uploaded it.** Confirming that would disclose another person's data, so we do not.",
            "**We cannot reach the uploader for you.** We do not mediate between people.",
            "**We cannot delete the copy on their device.** The export and the local preview live in their browser, outside our control.",
            "**We cannot send you the report.** It was purchased and addressed to them, and may contain their own words.",
          ],
        },
      ],
    },
    {
      id: "concerns",
      heading: "If you are worried about how it is being used",
      blocks: [
        {
          kind: "p",
          text: "Using a report to monitor, pressure, or shame another person is against our [terms](/terms). If that is what is happening to you, tell us — we can delete the data, and we can refuse future orders from that account.",
        },
        {
          kind: "p",
          text: "The product is designed as a mirror, and the report itself says that it is not ammunition for a fight. If someone is using it as a weapon, they are using it wrong, and we would rather know.",
        },
        {
          kind: "callout",
          tone: "info",
          title: "If this has left you feeling unsafe or overwhelmed",
          text: "You do not need to have used The Tell to use these. They are free. The Tell is not an emergency service and cannot watch over anyone.",
          links: [
            { label: "988 (US) — call or text", href: "tel:988" },
            { label: "findahelpline.com — anywhere else", href: "https://findahelpline.com" },
          ],
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          kind: "p",
          text: `Write to [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) with “Objection” or “Delete my data” in the subject line. A human answers within 48 hours.`,
        },
        {
          kind: "p",
          text: "If you are the person who used The Tell and you are reading this to understand what you agreed to: the [privacy policy](/privacy) and [terms](/terms) are the right pages.",
        },
      ],
    },
  ],
};
