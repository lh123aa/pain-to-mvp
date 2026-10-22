/**
 * /refund —— 退款政策（英文正文）
 * 依据：PRD v1.1 FR-7「7 天自助一键 → 立即吊销访问 + 分析数据 7 天内删除」、
 *       FR-8 访问链逐次查库、UIUX §10 /refund 行（含争议前置说明）
 */
import {
  CONTACT_EMAIL,
  EFFECTIVE_DATE,
  LEGAL_VERSION,
  REFUND_DAYS,
  REFUND_DELETE_DAYS,
} from "./shared";
import type { LegalDoc } from "./types";

export const REFUND: LegalDoc = {
  slug: "/refund",
  title: "Refund policy",
  description:
    "Seven days, no conditions, one click. What happens to your access, your payment, and your data when you ask The Tell for a refund.",
  eyebrow: "Refund policy",
  version: LEGAL_VERSION,
  updated: EFFECTIVE_DATE,
  intro:
    "You get seven days and no questions. If the report is not what you hoped for — or you simply changed your mind — ask, and you get your money back. We would rather refund than argue.",
  sections: [
    {
      id: "promise",
      heading: "Seven days, no conditions",
      blocks: [
        {
          kind: "p",
          text: `Ask within ${REFUND_DAYS} days of purchase and you get a full refund. You do not need a reason. You do not need to explain yourself, and reading the whole report first does not cancel the offer.`,
        },
        {
          kind: "p",
          text: "There is one refund per order, and refunds are not available for orders that were already refunded. Repeated refunds used as a way to read reports for free may lead us to decline future orders — but a single honest request never costs you anything.",
        },
      ],
    },
    {
      id: "how",
      heading: "How to get one",
      blocks: [
        {
          kind: "steps",
          items: [
            {
              title: "One click from the report",
              text: "Open your report and choose “Refund this purchase”. Confirm once. That is the whole form.",
            },
            {
              title: "Or email us",
              text: `Write to ${CONTACT_EMAIL} with the address you used at checkout and the approximate purchase date. No order number is required.`,
            },
            {
              title: "We confirm by email",
              text: "You receive a confirmation when the refund is approved, and the payment provider sends its own receipt when the money is on its way.",
            },
          ],
        },
        {
          kind: "p",
          text: "There is no phone call, no retention offer, and no survey you have to finish first.",
        },
      ],
    },
    {
      id: "data",
      heading: "What happens to your access and your data",
      blocks: [
        {
          kind: "p",
          text: "A refund is not just money moving back. It also ends our access to your analysis:",
        },
        {
          kind: "steps",
          items: [
            {
              title: "Access is revoked immediately",
              text: "Your access link and any active session stop working as soon as the refund is approved. The old link returns a 404 rather than a stale report.",
            },
            {
              title: "Analysis data is deleted within 7 days",
              text: `Your report, the computed statistics, and the masked excerpts are deleted within ${REFUND_DELETE_DAYS} days. Deletion is logged so that we can prove it happened.`,
            },
            {
              title: "The order record stays",
              text: "A thin order record is kept for 7 years because tax and Merchant of Record rules require it. It contains the amount, an email hash, and the confirmations you gave — never any part of your chat.",
            },
            {
              title: "Your browser copy is yours to clear",
              text: "Because parsing happens on your device, a refund cannot reach the local preview stored in your browser. Use “Clear this analysis from this device” to remove it.",
            },
          ],
        },
        {
          kind: "p",
          text: "The full data model is on the [privacy policy](/privacy), and the person whose messages you analysed can read the [notice](/notice).",
        },
      ],
    },
    {
      id: "timing",
      heading: "How fast the money arrives",
      blocks: [
        {
          kind: "p",
          text: "We approve refund requests within one business day. After approval, Lemon Squeezy — our Merchant of Record — returns the money to the original payment method. Banks and card issuers typically take 5 to 10 business days to show it.",
        },
        {
          kind: "p",
          text: "Any sales tax or VAT charged is refunded with the purchase. If your bank applies a currency conversion, the exact amount you receive can differ slightly from what you paid; that difference is set by your bank, not by us.",
        },
        {
          kind: "p",
          text: "On your statement the purchase appears as THETELL*REPORT. Refund lines usually reference the same descriptor.",
        },
      ],
    },
    {
      id: "eu",
      heading: "Your statutory rights in the EU and UK",
      blocks: [
        {
          kind: "p",
          text: "Digital content that is delivered immediately is normally outside the 14-day withdrawal right, provided you agree to immediate delivery and acknowledge that the right ends. That is the checkbox you see at checkout.",
        },
        {
          kind: "p",
          text: "Our own seven-day window is wider than that and applies regardless of the checkbox. If the report was never delivered, your statutory rights apply in full and are not affected by this policy.",
        },
      ],
    },
    {
      id: "failed",
      heading: "If the report never generated",
      blocks: [
        {
          kind: "p",
          text: "Generation is retried once automatically. If it still fails, you are refunded in full without asking. You do not need to file a request, and you will receive an email confirming the automatic refund.",
        },
      ],
    },
    {
      id: "dispute",
      heading: "Before you open a dispute",
      blocks: [
        {
          kind: "p",
          text: `If anything feels wrong, email us first at [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). We reply within 48 hours, and a refund is usually the fastest way to end a bad experience. A chargeback takes weeks and freezes the money on both sides.`,
        },
        {
          kind: "p",
          text: "If we cannot resolve it, you are free to use your bank's dispute process or your local consumer protection body — nothing in this policy takes that right away.",
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          kind: "p",
          text: `Refunds and billing: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) with “Refund” in the subject line. Data deletion: same address, with “Delete my data”.`,
        },
      ],
    },
  ],
};
