/**
 * /privacy —— 隐私政策（英文正文）
 * 依据：PRD v1.1 FR-8（三层边界）、FR-9（五件套）、FR-16（PostHog）、UIUX §10 表格
 * 数字单一来源：shared.ts（2h / 90d / 7y / 7d）
 */
import {
  CONTACT_EMAIL,
  DATA_LAYERS,
  EFFECTIVE_DATE,
  LEGAL_VERSION,
  LOCAL_TTL_HOURS,
  MIN_AGE,
  ORDER_KEEP_YEARS,
  REFUND_DELETE_DAYS,
  RETENTION_DAYS,
} from "./shared";
import type { LegalDoc } from "./types";

export const PRIVACY: LegalDoc = {
  slug: "/privacy",
  title: "Privacy policy",
  description:
    "What The Tell does with your data: parsing stays in your browser, only reduced data reaches us, everything is deleted after 90 days, and your GDPR rights are spelled out.",
  eyebrow: "Privacy",
  version: LEGAL_VERSION,
  updated: EFFECTIVE_DATE,
  intro:
    "The short version: your chat file is read in your browser, we never store the full conversation, and everything we do hold is deleted after 90 days. This page is the long version — written so that you can check it rather than take it on faith.",
  sections: [
    {
      id: "overview",
      heading: "The short version",
      blocks: [
        {
          kind: "p",
          text: "The Tell analyses a chat export you already have. The file is parsed on your device. What reaches us after a purchase is a small, reduced dataset: computed statistics, a few short excerpts with phone numbers and email addresses masked, and the report itself. All of it is deleted after 90 days, or in one click, whichever comes first.",
        },
        {
          kind: "list",
          items: [
            "**Parsed on your device.** The export file never leaves your browser. Turn off your internet after the page loads and a parse still works.",
            "**Reduced data only.** After purchase we receive numbers and short masked excerpts — not the conversation, and not anything that can be expanded back into it.",
            "**Three storage layers, three clocks.** Up to 2 hours in your browser, 90 days on our servers, 7 years for the order record required by tax law.",
            "**No sale, no training, no ad tracking.** Your data is not sold, not used to train models, and not shared with advertisers.",
          ],
        },
        {
          kind: "note",
          title: "This page is testable",
          text: "Most privacy policies ask to be believed. Every technical claim below has a check you can run in your own browser — see [Where your chat file goes](#file). If a claim here turns out to be false, we want to know before you find out.",
        },
      ],
    },
    {
      id: "file",
      heading: "Where your chat file goes",
      blocks: [
        {
          kind: "p",
          text: "Parsing happens inside the page you are looking at. Your browser reads the export, splits it into messages, attributes them to two speakers once you confirm who is who, and computes the metrics locally. The file itself is never sent anywhere.",
        },
        { kind: "p", text: "You can verify that in about a minute:" },
        {
          kind: "list",
          items: [
            "Load the analyzer, then set your browser to offline and run a parse. It still works.",
            "Open developer tools, go to the Network tab, clear it, then run a parse. No request carries your conversation.",
            "Run the same parse twice with the network blocked both times. The result is identical.",
          ],
        },
        {
          kind: "note",
          title: "What this does not mean",
          text: "It does not mean nothing ever leaves your device. After you pay, a reduced dataset — statistics and a few masked excerpts — is uploaded so a report can be generated and stored for your access link. [The three data layers](#layers) states exactly what that dataset contains.",
        },
      ],
    },
    {
      id: "layers",
      heading: "The three data layers",
      blocks: [
        {
          kind: "p",
          text: "This is the whole data model, not a summary of it. The same table appears in the [notice for people in your chats](/notice), because the person you were talking to deserves the same answer.",
        },
        {
          kind: "table",
          head: ["Layer", "What it holds", "How long", "Why"],
          rows: DATA_LAYERS.map((l) => [l.layer, l.what, l.retention, l.why]),
        },
        {
          kind: "p",
          text: `The browser layer carries a shared-device risk we would rather name than hide. Anything in localStorage is readable by anyone using the same browser profile. It is considered stale after ${LOCAL_TTL_HOURS} hours and there is a one-click clear button, but on a shared, work, or family computer, use a private window.`,
        },
        {
          kind: "p",
          text: `Order records are kept for ${ORDER_KEEP_YEARS} years because tax and Merchant of Record rules require them. They are deliberately thin: an order identifier, an email hash, the amount, the status, and the confirmations you gave at checkout. They do not contain any part of your chat.`,
        },
      ],
    },
    {
      id: "never",
      heading: "What we never store",
      blocks: [
        {
          kind: "list",
          items: [
            "**The full conversation.** Not on our servers, not in logs, not in backups beyond the normal 90-day lifecycle. The reduced dataset cannot be expanded back into your chat.",
            "**Phone numbers and email addresses from the conversation.** They are masked before anything is uploaded.",
            "**Your contacts, your full name, or advertising identifiers.** We do not ask for them and do not collect them.",
            "**Training data.** Your report and excerpts are not used to train any model. Our model provider is contractually bound to the same restriction.",
          ],
        },
        {
          kind: "p",
          text: "We do keep the email address you gave at checkout, so that we can send your access link and answer you. Those are the only two uses.",
        },
      ],
    },
    {
      id: "ai",
      heading: "AI processing, in plain terms",
      blocks: [
        {
          kind: "p",
          text: "Your report has two layers. The numbers are computed by a rule engine that runs deterministically on your device. The plain-language interpretation is written by a large language model, which receives only the reduced dataset: the computed metrics and a few short, masked excerpts.",
        },
        {
          kind: "p",
          text: "The model is instructed to interpret, not to invent facts, and a programmatic consistency check rejects text that contradicts the computed direction. Each report records the model and the weights version used, so a report can be traced to the exact setup that produced it. Failed generations are retried once, then refunded automatically.",
        },
        {
          kind: "p",
          text: "The model provider processes this data on our instructions and may not use it to train models. We do not send your email address to the model provider. AI-generated text can be wrong; [the methodology page](/methodology) explains how each claim is tied to evidence and where the limits are.",
        },
      ],
    },
    {
      id: "rights",
      heading: "Your rights under the GDPR",
      blocks: [
        {
          kind: "p",
          text: "If you are in the EU, the EEA, or the UK, you have the rights below. Exercise any of them by writing to us — no form, no account. We answer within 30 days and usually much faster.",
        },
        {
          kind: "list",
          items: [
            "**Access.** Ask what we hold about you and receive a copy.",
            "**Rectification.** Ask us to correct anything wrong.",
            "**Erasure.** Ask us to delete your report and analysis data. We do this within 7 days.",
            "**Restriction.** Ask us to stop processing while a question is being resolved.",
            "**Portability.** Ask for the data you gave us in a structured, machine-readable format.",
            "**Objection.** Object to processing based on legitimate interests. We stop unless we can show compelling grounds.",
            "**Complaint.** Complain to your local supervisory authority. You can do that without contacting us first.",
          ],
        },
        {
          kind: "p",
          text: `Email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) with “Privacy request” in the subject line. If we cannot identify the records you mean, we will tell you what we need — and we will never ask you to send a chat export to prove anything.`,
        },
        {
          kind: "p",
          text: "Nothing in your report is an automated decision with legal or similarly significant effect. You can ask for a human explanation of any finding, and we will explain the rule and the evidence behind it.",
        },
        {
          kind: "note",
          title: "EU representative",
          text: "If Article 27 of the GDPR applies to us, we will name our representative on this page. That assessment is being completed in writing now. Until it is published here, write to us directly and we will handle your request ourselves.",
        },
      ],
    },
    {
      id: "delete",
      heading: "How to delete your data",
      blocks: [
        {
          kind: "steps",
          items: [
            {
              title: "Delete a report",
              text: "Open the report and choose “Delete this analysis”. Access is revoked immediately and the analysis data is deleted within 7 days.",
            },
            {
              title: "Ask us",
              text: `Email ${CONTACT_EMAIL} from the address you used at checkout. We confirm when it is done.`,
            },
            {
              title: "Clear your browser",
              text: "Choose “Clear this analysis from this device” to remove the local copy. We cannot do this for you — that data is in your browser, not on our servers.",
            },
            {
              title: "Wait for the clock",
              text: `Anything left is deleted automatically ${RETENTION_DAYS} days after the report was generated.`,
            },
          ],
        },
        {
          kind: "p",
          text: `Refunds and deletion are linked: a refund revokes access immediately and deletes the analysis data within ${REFUND_DELETE_DAYS} days. Details are on the [refund policy](/refund).`,
        },
      ],
    },
    {
      id: "cookies",
      heading: "Cookies and tracking",
      blocks: [
        {
          kind: "p",
          text: "We do not run advertising or cross-site trackers, and we do not sell data. Product analytics run on PostHog's EU cloud with session replay and heatmaps disabled. Event properties never include nicknames, email addresses, or message content.",
        },
        {
          kind: "p",
          text: "What stays in your browser is functional: the reduced local parse state, and the session that keeps your report link working. No third party receives it.",
        },
        {
          kind: "p",
          text: "Where the law requires consent for a tracker, we ask before setting it, and you can decline without losing the product.",
        },
      ],
    },
    {
      id: "processors",
      heading: "Who processes data for us",
      blocks: [
        {
          kind: "p",
          text: "We use a small number of service providers. They process data on our instructions and under contract, and none of them may use it for their own purposes.",
        },
        {
          kind: "list",
          items: [
            "**Lemon Squeezy** — payments and Merchant of Record. It handles your payment details and sales tax; we never see your card number.",
            "**A large language model API provider** — generates the written interpretation from the reduced dataset.",
            "**Our cloud hosting provider** — stores the encrypted database and serves this site.",
            "**PostHog (EU cloud)** — product analytics, configured as described above.",
          ],
        },
        {
          kind: "p",
          text: "These providers may process data in the EU, the UK, or the United States. Where data leaves the EU or UK, transfers rely on an adequacy decision or standard contractual clauses. We will name the exact mechanism for any given provider on request.",
        },
      ],
    },
    {
      id: "age",
      heading: "Age and minors",
      blocks: [
        {
          kind: "p",
          text: `The Tell is for people aged ${MIN_AGE} and over. We do not knowingly collect data from anyone younger. Because the tool analyses a conversation, it can incidentally process messages written by someone younger; we do not target that data and we build no profile of it. If you believe a minor's data is in our systems, write to us and we will delete it.`,
        },
      ],
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      blocks: [
        {
          kind: "p",
          text: "We version this page. Material changes are published here with a new version number and date, and the previous version is available on request. The version that applies to a purchase is the one that was live on the date of that purchase.",
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          kind: "p",
          text: `Write to [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). For privacy requests, put “Privacy request” in the subject line. We reply to everyone within 48 hours and resolve formal requests within 30 days.`,
        },
        {
          kind: "p",
          text: "If you are reading this because someone analysed a conversation you were part of, start with [the notice written for you](/notice) — it explains what we hold and how to have it deleted.",
        },
      ],
    },
  ],
};
