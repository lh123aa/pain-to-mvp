/**
 * /crisis-protocol —— 危机协议说明页（英文正文）
 * 依据：PRD v1.1 FR-10（词表+正则双层、免费层资源卡不阻断不记录、报告页+邮件、误报率测试集 <5%）、
 *       UIUX §5.6（资源卡文案）、§10 /crisis-protocol 行（不是 24/7 的醒目声明 + 误报率说明）
 */
import { CONTACT_EMAIL, CRISIS, EFFECTIVE_DATE, LEGAL_VERSION } from "./shared";
import type { LegalDoc } from "./types";

export const CRISIS_PROTOCOL: LegalDoc = {
  slug: "/crisis-protocol",
  title: "Crisis protocol",
  description:
    "How The Tell looks for signs of crisis, what happens when it finds them, how we measure false positives, and where to get real help — 988 and findahelpline.",
  eyebrow: "Crisis protocol",
  version: LEGAL_VERSION,
  updated: EFFECTIVE_DATE,
  intro:
    "The Tell is not an emergency service and cannot watch over anyone. But when a conversation contains language that suggests someone may be at risk, we would rather point toward real help than stay silent. This page explains exactly what we do — and what we cannot do.",
  sections: [
    {
      id: "help-now",
      heading: "If you need help right now",
      blocks: [
        {
          kind: "callout",
          tone: "crisis",
          title: CRISIS.headline,
          text: `${CRISIS.line} ${CRISIS.notEmergency}`,
          links: [CRISIS.us, CRISIS.intl],
        },
        { kind: "p", text: CRISIS.emergency },
        {
          kind: "p",
          text: "These lines are free, and you do not need a report, a purchase, or an explanation to use them. You also do not need to be in the country where the number is based to read its website: findahelpline lists vetted services by country.",
        },
      ],
    },
    {
      id: "detection",
      heading: "What we look for",
      blocks: [
        {
          kind: "p",
          text: "Two layers run independently. The first is a word list; the second is a set of patterns that catch phrasing the list alone would miss. Together they look for language suggesting someone may be thinking about suicide or self-harm, or about hurting another person.",
        },
        {
          kind: "list",
          items: [
            "**In your browser first.** The free preview runs the check locally, on your device, in the same pass that computes the preview metrics.",
            "**Again on our side.** For a paid report, the check runs on the reduced dataset before the report is finalised, so the resources can also be included in the delivery email.",
            "**Three languages.** The check covers the languages we parse: English, Spanish, and German.",
            "**A signal, not a conclusion.** A match means the language looked like risk. It does not mean a person is in danger, and it does not label anyone.",
          ],
        },
        {
          kind: "note",
          title: "Why we do not publish the word list",
          text: "A published list invites people to write around it, and a list that is easy to game protects nobody. The list is versioned, reviewed before release, and audited against the test set described below.",
        },
      ],
    },
    {
      id: "response",
      heading: "What happens when something matches",
      blocks: [
        {
          kind: "steps",
          items: [
            {
              title: "A resource card appears",
              text: "It sits above the results. It does not block the flow, does not open a pop-up, and can be dismissed for the session.",
            },
            {
              title: "Nothing about the hit is recorded in the card flow",
              text: "The content that matched is not stored, not uploaded, and not shown to anyone. Dismissal is recorded as an anonymous event with no content attached.",
            },
            {
              title: "The paid report gets the same card",
              text: "The report includes the resources, and the delivery email carries them too, so they are still reachable later.",
            },
            {
              title: "An anonymous flag is kept",
              text: "For the paid report only, we record that a flag fired and when — not what matched, and not who you are — so we can watch the false-positive rate.",
            },
          ],
        },
        {
          kind: "p",
          text: "We never contact the other person in the conversation, and we never tell anyone that a flag fired.",
        },
      ],
    },
    {
      id: "limits",
      heading: "What we are not",
      blocks: [
        {
          kind: "list",
          items: [
            "**Not a 24/7 service.** There is no one on call, no hotline, and no monitoring of uploads.",
            "**Not able to contact emergency services.** We cannot and do not dispatch help.",
            "**Not able to detect everything.** Sarcasm, irony, indirect phrasing, memes, and languages we do not parse can all slip past.",
            "**Not a substitute for professional care.** If you are struggling, a real person is better than any report, including ours.",
          ],
        },
        {
          kind: "p",
          text: "If you are in immediate danger, do not email us and do not wait for a report. Call your local emergency number.",
        },
      ],
    },
    {
      id: "accuracy",
      heading: "How we measure false positives",
      blocks: [
        {
          kind: "p",
          text: "A crisis check that cries wolf is worse than useless: it teaches people to ignore the card. So we test it against a fixed set: 20 carefully reviewed reports and 50 desensitised ordinary conversations, in which nothing suggests risk.",
        },
        {
          kind: "list",
          items: [
            "**Definition.** A false positive is the card appearing on a conversation from the ordinary set.",
            "**Target.** Under 5% of that set. The suite runs as a regression test before every release that touches detection.",
            "**The trade-off we accept.** Some false positives are the price of not missing real risk. We tune toward sensitivity, then reduce noise.",
            "**Dismissing is fine.** If the card appears and it does not fit, dismiss it. That is a useful signal to us, not a mistake you need to fix.",
          ],
        },
      ],
    },
    {
      id: "privacy",
      heading: "What happens to crisis signals",
      blocks: [
        {
          kind: "p",
          text: "Crisis signals are never used for marketing, never sold, and never shared with the other person. They do not change what you are charged. They are deleted with the rest of the analysis data, on the same 90-day schedule as everything else.",
        },
        {
          kind: "p",
          text: "The full picture of what we hold is on the [privacy policy](/privacy). If you are the other person in the conversation, read the [notice](/notice).",
        },
      ],
    },
    {
      id: "contact",
      heading: "If you think the check got it wrong",
      blocks: [
        {
          kind: "p",
          text: `Tell us at [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) with “Crisis flag” in the subject line. False positives are how the list gets better, and we read every report. Please do not include the messages themselves — a description of the language is enough.`,
        },
        {
          kind: "p",
          text: "If you are in danger now, please do not email us first. Call your local emergency number, or use the lines at the top of this page.",
        },
      ],
    },
  ],
};
