/**
 * /terms —— 服务条款（英文正文）
 * 依据：PRD v1.1 FR-7（16+/权利确认/欧盟数字内容弃权）、FR-9、UIUX §10 /terms 行
 * 定位红线：自助反思工具，非专业服务（禁用词作用域见 PRD §9）
 */
import {
  CONTACT_EMAIL,
  EFFECTIVE_DATE,
  LEGAL_VERSION,
  MIN_AGE,
  REFUND_DAYS,
} from "./shared";
import type { LegalDoc } from "./types";

export const TERMS: LegalDoc = {
  slug: "/terms",
  title: "Terms of service",
  description:
    "The rules for using The Tell: a self-reflection tool rather than professional care, for adults aged 16 and over, with honest limits on what the report can claim.",
  eyebrow: "Terms",
  version: LEGAL_VERSION,
  updated: EFFECTIVE_DATE,
  intro:
    `These terms are the agreement between you and The Tell. They are short because the product is deliberately small: one purchase, one report, no account. By buying or using a report, you agree to them.`,
  sections: [
    {
      id: "what",
      heading: "What The Tell is",
      blocks: [
        {
          kind: "p",
          text: "The Tell is a self-reflection tool. It reads a chat export you provide, measures observable patterns in how two people communicate, and turns those measurements into a readable report about your relationship dynamics.",
        },
        {
          kind: "p",
          text: "It is not professional care, and it is not a substitute for professional care. Nobody here assesses, labels, or makes decisions about you. The report describes behaviour it can see in text — it does not know what either person was feeling, and it says so where that matters.",
        },
        {
          kind: "p",
          text: "If you are making a decision about your safety or someone else's, do not rely on a report. Use real people instead — [crisis resources](/crisis-protocol) lists where to start, and they are free.",
        },
      ],
    },
    {
      id: "not",
      heading: "What The Tell is not",
      blocks: [
        {
          kind: "pull",
          text: "This report is a mirror for you — not ammunition for a fight.",
        },
        {
          kind: "list",
          items: [
            "**Not professional care.** No one is reviewing your case, and using the product creates no professional relationship of any kind.",
            "**Not a verdict about the other person.** The report describes patterns in a conversation, not character. It cannot tell you who is right.",
            "**Not a substitute for talking to each other.** If something matters, an honest conversation offline beats any report.",
            "**Not a monitoring or surveillance tool.** You may not use it to track, pressure, or build a file on another person.",
            "**Not an emergency service.** Nobody is watching your upload, and no one will be alerted.",
          ],
        },
      ],
    },
    {
      id: "age",
      heading: "Who can use it",
      blocks: [
        {
          kind: "p",
          text: `You must be at least ${MIN_AGE} years old to buy or use The Tell. By confirming age at checkout you state that you are. The product is for personal, non-commercial use unless we agree otherwise in writing.`,
        },
        {
          kind: "p",
          text: "You do not need an account. Access to your report is granted through an email link tied to the order. Keep that link private: anyone who has it can open the report until it expires or is revoked.",
        },
      ],
    },
    {
      id: "your-part",
      heading: "Your responsibilities",
      blocks: [
        {
          kind: "list",
          items: [
            "**You have the right to share the conversation.** Only upload chats you took part in, or that you otherwise have a lawful basis to process. By uploading, you confirm this.",
            "**You do not upload someone else's private material** to analyse them without a legitimate reason of your own.",
            "**You do not use the output to harm anyone.** No harassment, coercion, stalking, or decisions about a person's employment, housing, insurance, or credit.",
            "**You do not upload content that is illegal to possess.** If your export contains such material, do not upload it; delete the export instead.",
            "**You do not attack the service.** No scraping, no attempts to reach other people's reports, no automated bulk use.",
          ],
        },
        {
          kind: "p",
          text: "We may suspend or refuse service where these rules are broken. We will not delete data we are legally required to keep.",
        },
      ],
    },
    {
      id: "ai",
      heading: "AI-generated content",
      blocks: [
        {
          kind: "p",
          text: "Parts of the report are written by a large language model from computed measurements and a few short, masked excerpts. It can be wrong, incomplete, or awkwardly phrased. Each finding carries a confidence marker, and every report includes a chapter on what the analysis does not know.",
        },
        {
          kind: "p",
          text: "We do not warrant that any statement in a report is accurate for your situation. You are responsible for how you read it and for any decision you make afterwards.",
        },
      ],
    },
    {
      id: "payment",
      heading: "Price, payment, and refunds",
      blocks: [
        {
          kind: "p",
          text: "The report is a one-time purchase. There is no subscription and nothing renews automatically. The price is shown before you pay, including any applicable tax.",
        },
        {
          kind: "p",
          text: "Payments are processed by Lemon Squeezy, which acts as the Merchant of Record: it handles the transaction, sales tax, and the descriptor on your statement. We never receive your card details.",
        },
        {
          kind: "p",
          text: `You may request a refund within ${REFUND_DAYS} days of purchase, for any reason or none. The [refund policy](/refund) explains how, and what happens to your data when you do.`,
        },
        {
          kind: "note",
          title: "EU and UK customers",
          text: "By buying and starting delivery immediately, you agree to immediate supply of digital content and acknowledge that the statutory 14-day withdrawal right ends once the report is generated. Our own 7-day refund window applies on top of this and is not affected by it.",
        },
      ],
    },
    {
      id: "content",
      heading: "Your content and ours",
      blocks: [
        {
          kind: "p",
          text: "Your conversation stays yours. You give us a limited licence to process the reduced dataset solely to generate, deliver, and support your report — nothing else. Your data is not used to train models.",
        },
        {
          kind: "p",
          text: "The report is for you. You may save, print, and share it, but not resell it or present it as professional advice. The Tell name, the methodology text, and the visual system remain ours.",
        },
      ],
    },
    {
      id: "availability",
      heading: "Availability and changes",
      blocks: [
        {
          kind: "p",
          text: "The service is provided as it is. We may change features, pause the product, or stop it. If generation fails after our automatic retry, you are refunded in full without needing to ask.",
        },
        {
          kind: "p",
          text: "We may update these terms. Material changes are published on this page with a new version and date; the version live on your purchase date governs that purchase.",
        },
      ],
    },
    {
      id: "liability",
      heading: "Limits of liability",
      blocks: [
        {
          kind: "p",
          text: "To the maximum extent permitted by law, we are not liable for indirect or consequential losses, or for decisions you make after reading a report. Our total liability for any claim relating to the service is limited to the amount you paid for the report in question.",
        },
        {
          kind: "p",
          text: "Nothing in these terms limits liability that cannot be limited by law, including for fraud, or for death or personal injury caused by negligence. Nothing here removes mandatory consumer rights you have where you live.",
        },
      ],
    },
    {
      id: "law",
      heading: "Governing law and disputes",
      blocks: [
        {
          kind: "p",
          text: "These terms are governed by the laws that apply at our place of business, without regard to conflict-of-law rules. If you are a consumer, this does not remove the protection of mandatory rules in your country of residence.",
        },
        {
          kind: "p",
          text: `Before anything formal, email us at [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). We reply within 48 hours, and we would rather fix a problem than argue about it.`,
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          kind: "p",
          text: `Questions about these terms go to [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). For data requests, see the [privacy policy](/privacy); for the person whose messages you analysed, see the [notice](/notice).`,
        },
      ],
    },
  ],
};
