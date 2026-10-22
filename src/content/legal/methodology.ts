/**
 * /methodology —— 方法论页（英文正文）
 * 依据：PRD v1.1 §5（指标/六章/五维权重/被发现的措辞原则）、URIUX §8.3（证据链与置信度图例）、
 *       文档 documentation/权重表-v1.md（25/20/15/25/15，权重版本化走 ADR）
 * 首页文案承诺 "135 sources reviewed"，本页是其可信度落点（来源索引入口）
 */
import { EFFECTIVE_DATE, LEGAL_VERSION } from "./shared";
import type { LegalDoc } from "./types";

const WEIGHTS = [
  ["Reciprocity", "25", "Whether effort is mutual — who gives more, who takes more", "15–35"],
  ["Responsiveness", "20", "How quickly and fully each person answers — delay and completeness", "15–30"],
  ["Atmosphere", "15", "The overall tone — the share of warm, neutral, and cold turns", "10–25"],
  ["Conflict repair", "25", "What happens after friction — apology, de-escalation, return to normal", "15–35"],
  ["Investment consistency", "15", "Whether effort holds over time — drift, gaps, sudden cooling", "10–25"],
];

export const METHODOLOGY: LegalDoc = {
  slug: "/methodology",
  title: "Methodology",
  description:
    "How The Tell builds a report: the five weighted dimensions, the evidence behind every claim, the limits we state plainly, and where the sources come from.",
  eyebrow: "Methodology",
  version: LEGAL_VERSION,
  updated: EFFECTIVE_DATE,
  intro:
    "Every number in your report comes from a rule you could inspect, and every sentence is tied to something you can check. This page explains how the report is built, what it cannot know, and how to verify us.",
  sections: [
    {
      id: "two-layers",
      heading: "Two layers, one report",
      blocks: [
        {
          kind: "p",
          text: "The report is built in two deliberately separated layers. Keeping them apart is what stops a plausible sentence from inventing a fact.",
        },
        {
          kind: "list",
          items: [
            "**The evidence layer.** A rule engine, running in your browser, computes the measurements directly from your messages. It is deterministic: the same input produces the same numbers. It outputs direction labels and scores, and it never paraphrases.",
            "**The interpretation layer.** A language model turns those measurements and a few short masked excerpts into readable prose. It is instructed to interpret only what was measured. A consistency check rejects any paragraph whose claims contradict the computed direction; a rejected paragraph is regenerated once, and if it still contradicts the evidence, it is dropped.",
          ],
        },
        {
          kind: "p",
          text: "Wording follows the evidence layer, always: findings are described as leaning or as a pattern, never as a fixed type and never as a certainty. Each report records the weights version and the model that produced it, so any report can be traced to the exact setup behind it.",
        },
      ],
    },
    {
      id: "dimensions",
      heading: "The five dimensions and their weights",
      blocks: [
        {
          kind: "p",
          text: "The overall picture is a weighted mix of five dimensions. The weights are published because a score you cannot decompose is just an opinion with a number attached.",
        },
        {
          kind: "table",
          head: ["Dimension", "Weight", "What it measures", "Typical range"],
          rows: WEIGHTS,
          caption: "Weights version v1 — the five weights sum to 100.",
        },
        {
          kind: "p",
          text: "These weights are versioned. A change requires a written decision record rather than a quiet edit, and every report states which version it used. The typical ranges show where the weight for each dimension has been set so far; they are not secret dials that move between customers.",
        },
      ],
    },
    {
      id: "numbers",
      heading: "What the numbers mean — and do not",
      blocks: [
        {
          kind: "list",
          items: [
            "**The score is a composite, not a percentile.** A 68 does not mean you are better than 68% of anyone. There is no population of other users behind that number, because the analysis never compares you to other people.",
            "**Direction words are leanings, not types.** A label describes the balance of behaviour in the window you uploaded. It is not an identity, and it can change with the window.",
            "**Confidence is stated per finding.** Fairly sure means many consistent messages support it. Somewhat sure means the pattern exists but is thinner or noisier. Less sure means we are telling you because it is visible, not because we are confident.",
            "**Short windows are weaker.** A few weeks of messages can show a bad patch as easily as a pattern. The report says when the window is thin.",
          ],
        },
      ],
    },
    {
      id: "evidence",
      heading: "The evidence chain",
      blocks: [
        {
          kind: "p",
          text: "Every finding carries a reference to the messages it came from. Open the reference and you see the exact excerpts, their dates, and a note that phone numbers and email addresses have been masked. A claim with no supporting messages is not shipped.",
        },
        {
          kind: "pull",
          text: "These are the exact messages this conclusion is based on.",
        },
        {
          kind: "p",
          text: "This is also why we decline to be more certain than the text allows. If the messages do not support a sentence, the honest move is to say less — not to write something that sounds insightful.",
        },
      ],
    },
    {
      id: "unknown",
      heading: "What I Don't Know",
      blocks: [
        {
          kind: "p",
          text: "Every report ends with a chapter listing what the analysis cannot establish. It is not fine print; it is the part that keeps the rest honest.",
        },
        {
          kind: "list",
          items: [
            "**Feelings and intentions.** The report describes observable behaviour in text. It cannot tell you what either of you was thinking at any moment, and it does not try.",
            "**Everything outside the chat.** Context that lives in person, on calls, in other apps, or in someone's week is invisible to the analysis.",
            "**Sarcasm, irony, memes, and code-switching.** Text metrics are weakest exactly where language is most playful or most coded.",
            "**Group chats.** Only one-to-one conversations are supported, because a conclusion has to be attributable to two people.",
            "**Languages we do not parse.** The analysis covers English, Spanish, and German. Other languages are not scored.",
            "**Who is right.** There is no verdict in the report, and no version of this product will produce one.",
          ],
        },
      ],
    },
    {
      id: "sources",
      heading: "Where this comes from",
      blocks: [
        {
          kind: "p",
          text: "The rules were built from published research on attachment, communication patterns, and how relationships repair after conflict. We reviewed 135 sources while writing them. The strands we lean on most:",
        },
        {
          kind: "list",
          items: [
            "Bowlby, J. (1969). Attachment and Loss, Vol. 1: Attachment.",
            "Ainsworth, M. D. S., Blehar, M. C., Waters, E., & Wall, S. (1978). Patterns of Attachment.",
            "Hazan, C., & Shaver, P. (1987). Romantic love conceptualized as an attachment process. Journal of Personality and Social Psychology.",
            "Gottman, J. M., & Levenson, R. W. (1992). Marital processes predictive of later dissolution. Journal of Personality and Social Psychology.",
            "Mikulincer, M., & Shaver, P. R. (2016). Attachment in Adulthood: Structure, Dynamics, and Change (2nd ed.).",
          ],
        },
        {
          kind: "note",
          title: "The full index",
          text: "The complete 135-entry reference index, including the studies we chose not to build on, is available on request. Ask for it the same way you would ask for anything else on these pages, and we will send it.",
        },
        {
          kind: "p",
          text: "Research describes groups. Your report describes one conversation. Where the research is uncertain, the report says so rather than borrowing authority it has not earned.",
        },
      ],
    },
    {
      id: "verify",
      heading: "How to check us",
      blocks: [
        {
          kind: "steps",
          items: [
            {
              title: "Read a sample report",
              text: "A full anonymised report is public — see the [sample report](/sample), including its confidence markers and its What I Don't Know chapter.",
            },
            {
              title: "Parse with the network off",
              text: "Load the analyzer, go offline, and run a parse. If it works, the processing really is local — that is a check, not a slogan.",
            },
            {
              title: "Audit the requests",
              text: "Run a parse with the Network tab open. No request should contain your conversation.",
            },
            {
              title: "Challenge a finding",
              text: "If a claim in your report looks wrong, email us with the reference number. Disagreements about specific findings are the most useful feedback we get.",
            },
          ],
        },
      ],
    },
    {
      id: "limits",
      heading: "Limits of this page",
      blocks: [
        {
          kind: "p",
          text: "This page describes how the report is produced. It is not professional care, and nothing in a report is a substitute for professional care. The output is an AI-assisted reflection aid: it can be wrong, and it should be read as a prompt for thinking rather than an answer.",
        },
        {
          kind: "p",
          text: "If a finding raises something that feels bigger than a report, [there are real people to talk to](/crisis-protocol) — free, and available now.",
        },
      ],
    },
  ],
};
