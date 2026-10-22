/**
 * 确定性词表 v0（M1 · FR-4 特征抽取 / 冲突修复词频 / 氛围维度）
 *
 * ⚠️ 版本与来源说明（诚实标注）：
 * - PRD §10.1 把「冲突/修复词表 v1」列为**泳道 B（创始人）交付物**，本文件是工程侧的
 *   **v0-draft 代理实现**：只覆盖 en/es/de 最常见的高信号词，不做情感词典（AFINN/NRC）集成。
 * - 词表是数据不是逻辑：M1 出口前由创始人替换/扩充时，只需改本文件并升 LEXICON_VERSION，
 *   指标公式与测试无需改动。
 * - 匹配前做「小写 + NFD 去变音符号」，因此词表条目写成 ASCII（wütend → wutend）。
 * - 所有词表只用于本地聚合计数，**不上传原文**；命中证据只引用 message id（PRD FR-4）。
 */

export const LEXICON_VERSION = "lexicon_v0-draft";

/** 冲突/负面互动信号（不含"否定式引用"白名单——v0 不做语境消歧，只在报告层措辞降级）。 */
const CONFLICT_TERMS: readonly string[] = [
  // en
  "angry",
  "anger",
  "annoyed",
  "annoying",
  "upset",
  "mad",
  "hate",
  "hated",
  "hates",
  "fight",
  "fighting",
  "argue",
  "argued",
  "arguing",
  "argument",
  "whatever",
  "shut up",
  "stop it",
  "leave me alone",
  "ignore",
  "ignored",
  "ignoring",
  "blocked",
  "blocking",
  "don't care",
  "dont care",
  "never mind",
  "ridiculous",
  "stupid",
  "selfish",
  "tired of",
  "i'm done",
  "im done",
  "silent treatment",
  "no offense",
  "sick of",
  // de
  "wutend",
  "sauer",
  "streit",
  "streiten",
  "egal",
  "hasse",
  "genervt",
  "nervt",
  "hor auf",
  // es
  "enfadado",
  "enojado",
  "molesto",
  "molesta",
  "discusion",
  "discutir",
  "pelea",
  "peleamos",
  "odio",
  "estupido",
  "me molesta",
  "harto",
  "harta",
];

/** 修复行为信号（道歉 / 认错 / 主动降温 / 认可对方）。 */
const REPAIR_TERMS: readonly string[] = [
  // en
  "sorry",
  "so sorry",
  "i'm sorry",
  "im sorry",
  "apologize",
  "apologise",
  "apology",
  "my bad",
  "my fault",
  "i was wrong",
  "i am wrong",
  "forgive",
  "forgive me",
  "didn't mean",
  "didnt mean",
  "let's talk",
  "lets talk",
  "can we talk",
  "i hear you",
  "i understand",
  "you're right",
  "you are right",
  "fair enough",
  "i shouldn't have",
  "i shouldnt have",
  // de
  "entschuldigung",
  "tut mir leid",
  "verzeih",
  "mein fehler",
  "du hast recht",
  // es
  "perdon",
  "lo siento",
  "disculpa",
  "disculpas",
  "mi culpa",
  "tienes razon",
  "tenias razon",
];

/** 正向情绪词（氛围维度，代理实现；不用于任何结论性判断）。 */
const POSITIVE_TERMS: readonly string[] = [
  "love",
  "loved",
  "loves",
  "miss you",
  "missed you",
  "happy",
  "glad",
  "nice",
  "fun",
  "great",
  "good",
  "cute",
  "sweet",
  "thank you",
  "thanks",
  "appreciate",
  "excited",
  "proud of you",
  "amazing",
  "wonderful",
  "liebe",
  "freude",
  "schoen",
  "danke",
  "toll",
  "super",
  "me gusta",
  "te quiero",
  "te extrano",
  "feliz",
  "gracias",
  "bonito",
  "genial",
];

/** 负向情绪词（氛围维度；与冲突词表有重叠是刻意的，两个指标回答不同问题）。 */
const NEGATIVE_TERMS: readonly string[] = [
  "sad",
  "cry",
  "crying",
  "hurt",
  "lonely",
  "alone",
  "tired",
  "exhausted",
  "awful",
  "terrible",
  "worried",
  "anxious",
  "stress",
  "stressed",
  "traurig",
  "mude",
  "allein",
  "einsam",
  "schlecht",
  "miedo",
  "triste",
  "cansado",
  "cansada",
  "preocupado",
  "preocupada",
  "ansioso",
  "ansiosa",
];

/** 匹配前的归一化：小写 + 去变音符号（保留标点，供 \b 边界使用）。 */
export function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildMatcher(terms: readonly string[]): RegExp {
  const alternatives = [...terms]
    .sort((a, b) => b.length - a.length) // 长短语优先，避免 "sorry" 抢先吃掉 "so sorry"
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(String.raw`\b(?:${alternatives})\b`, "g");
}

const CONFLICT_RE = buildMatcher(CONFLICT_TERMS);
const REPAIR_RE = buildMatcher(REPAIR_TERMS);
const POSITIVE_RE = buildMatcher(POSITIVE_TERMS);
const NEGATIVE_RE = buildMatcher(NEGATIVE_TERMS);

export interface LexiconCounts {
  conflict: number;
  repair: number;
  positive: number;
  negative: number;
}

/** 对单条已归一化文本统计四类词频（一条消息内重复命中也计数）。 */
export function countLexiconHits(normalizedText: string): LexiconCounts {
  return {
    conflict: normalizedText.match(CONFLICT_RE)?.length ?? 0,
    repair: normalizedText.match(REPAIR_RE)?.length ?? 0,
    positive: normalizedText.match(POSITIVE_RE)?.length ?? 0,
    negative: normalizedText.match(NEGATIVE_RE)?.length ?? 0,
  };
}

export const LEXICONS = {
  version: LEXICON_VERSION,
  conflict: CONFLICT_TERMS,
  repair: REPAIR_TERMS,
  positive: POSITIVE_TERMS,
  negative: NEGATIVE_TERMS,
} as const;
