/**
 * Content guard for LLM-generated narrative (W5-3)
 * ================================================
 * The rules layer owns the numbers and the attachment direction. The LLM is
 * allowed to improve *wording only*, so every generated string passes through
 * this guard before it can replace the deterministic copy:
 *
 *   - `assertCompliance(text)` — banned clinical/therapy vocabulary + English-only.
 *   - `assertDirectionConsistency(report, text)` — generated copy may not claim
 *     or negate an attachment direction that contradicts the rules layer
 *     (e.g. the report says "anxious-leaning" but the narrative says
 *     "secure-leaning" or "not anxious").
 *   - `guardNarrative(report, text)` — `{ ok, violations }` combining both.
 *
 * The checkers return violation lists (no throws) so the narrative layer can
 * fall back to the deterministic report on the first failure. Text is English
 * product copy; comparisons are case-insensitive.
 */
import type { ReportDataV2 } from "./report-contract";

/**
 * Banned vocabulary. The product is a self-reflection tool, not care: these
 * words imply a clinical service or a diagnosis the product does not provide.
 * Kept exported so the prompt and the guard share one list.
 */
export const FORBIDDEN_TERMS: readonly string[] = [
  "therapist",
  "therapy",
  "therapeutic",
  "counseling",
  "counselling",
  "counselor",
  "counsellor",
  "diagnosis",
  "diagnose",
  "diagnosed",
  "diagnostic",
  "clinical",
  "clinically",
  "mental health",
  "mental-health",
  "mental illness",
  "psychotherapy",
  "psychiatrist",
  "psychologist",
  "psychiatric",
];

export type ComplianceViolationCode =
  | "banned-term"
  | "non-english"
  | "empty"
  | "direction-conflict"
  | "direction-negation";

export interface ComplianceViolation {
  code: ComplianceViolationCode;
  /** Human-readable diagnostic (English, safe to log; never shown as-is). */
  detail: string;
  /** The matched word/phrase or direction, when applicable. */
  match?: string;
}

export type GuardResult = {
  ok: boolean;
  violations: ComplianceViolation[];
};

export type RuleDirection = "anxious" | "avoidant" | "secure" | "mixed";

export interface RuleDirections {
  user: RuleDirection;
  partner: RuleDirection;
}

const DIRECTIONS: readonly RuleDirection[] = ["anxious", "avoidant", "secure", "mixed"];

const NON_ENGLISH_RE =
  /[\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/u;

function isRuleDirection(value: unknown): value is RuleDirection {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a tolerant regex: spaces/hyphens/underscores all match each other. */
function termRegExp(term: string): RegExp {
  const parts = term
    .trim()
    .split(/[\s_-]+/)
    .filter((part) => part.length > 0)
    .map(escapeRegExp);
  return new RegExp(`\\b${parts.join("[\\s_-]+")}\\b`, "gi");
}

/**
 * Banned-word + English-only check. Returns an empty array when the text is
 * compliant. An empty/blank string yields an `empty` violation.
 */
export function assertCompliance(text: string): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  if (typeof text !== "string" || text.trim().length === 0) {
    return [{ code: "empty", detail: "Narrative text is empty." }];
  }
  if (NON_ENGLISH_RE.test(text)) {
    violations.push({
      code: "non-english",
      detail: "Narrative text contains non-English (CJK) characters.",
    });
  }

  for (const term of FORBIDDEN_TERMS) {
    const regex = termRegExp(term);
    const match = regex.exec(text);
    if (match !== null) {
      violations.push({
        code: "banned-term",
        detail: `Narrative text contains banned clinical vocabulary ("${term}").`,
        match: match[0],
      });
    }
  }
  return violations;
}

/** Read the rule-layer attachment directions from a built report, if present. */
export function readRuleDirections(report: ReportDataV2): RuleDirections | null {
  const chapters = report?.chapters;
  if (!Array.isArray(chapters) || chapters.length < 2) return null;
  const user = (chapters[0] as { attachment?: { direction?: unknown } } | undefined)?.attachment
    ?.direction;
  const sides = (chapters[1] as { sides?: unknown } | undefined)?.sides;
  const partner = Array.isArray(sides)
    ? (sides[1] as { direction?: unknown } | undefined)?.direction
    : undefined;
  if (!isRuleDirection(user) || !isRuleDirection(partner)) return null;
  return { user, partner };
}

const DIRECTION_MENTION_RE = /\b(anxious|avoidant|secure|mixed)(?:ness|ly)?/gi;

const BEFORE_NEGATION_RE =
  /(?:\bnot|\bisn'?t|\bis not|\baren'?t|\bare not|\bnever|\bno longer|\bhardly|\bwithout|\bno signs? of|\bfew signs? of|\black(?:s|ing)?(?:\s+\w+){0,2}\s+of)\s+(?:really\s+|very\s+|particularly\s+|especially\s+)?$/i;

const AFTER_NEGATION_RE =
  /^[^.!?]{0,40}?\b(?:isn'?t|is not|aren'?t|are not|doesn'?t|does not|never|no longer)\b/i;

function isNegatedAround(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 60), start);
  if (BEFORE_NEGATION_RE.test(before)) return true;
  const after = text.slice(end, Math.min(text.length, end + 40));
  return AFTER_NEGATION_RE.test(after);
}

/**
 * Direction consistency check.
 *
 * The allowed vocabulary is `{user direction, partner direction}` from the
 * rules report. A narrative may mention both of those; it may not introduce a
 * third direction (that would reverse a rules conclusion) and it may not
 * negate either stamped direction. When either side is `mixed`, every
 * direction word is allowed (mixed means the scores were too close to claim
 * one), but negating the stamped direction is still a violation.
 */
export function assertDirectionConsistency(
  report: ReportDataV2,
  text: string,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  if (typeof text !== "string" || text.trim().length === 0) return violations;
  const rules = readRuleDirections(report);
  if (rules === null) return violations;

  const permissive = rules.user === "mixed" || rules.partner === "mixed";
  const allowed = new Set<RuleDirection>([rules.user, rules.partner]);
  if (permissive) for (const direction of DIRECTIONS) allowed.add(direction);

  const seen = new Set<string>();
  const regex = new RegExp(DIRECTION_MENTION_RE.source, "gi");
  let match: RegExpExecArray | null = regex.exec(text);
  while (match !== null) {
    const direction = match[1]?.toLowerCase() as RuleDirection;
    const start = match.index;
    const end = start + match[0].length;
    const negated = isNegatedAround(text, start, end);

    if (negated && (direction === rules.user || direction === rules.partner)) {
      const key = `direction-negation:${direction}`;
      if (!seen.has(key)) {
        seen.add(key);
        violations.push({
          code: "direction-negation",
          detail: `Narrative negates the rules-layer "${direction}" direction.`,
          match: direction,
        });
      }
    } else if (!allowed.has(direction)) {
      const key = `direction-conflict:${direction}`;
      if (!seen.has(key)) {
        seen.add(key);
        violations.push({
          code: "direction-conflict",
          detail:
            `Narrative claims "${direction}" but the rules layer says ` +
            `you: ${rules.user}, partner: ${rules.partner}.`,
          match: direction,
        });
      }
    }

    match = regex.exec(text);
  }
  return violations;
}

/** Combined gate used by `lib/report-narrative.ts` before accepting LLM copy. */
export function guardNarrative(report: ReportDataV2, text: string): GuardResult {
  const violations = [...assertCompliance(text), ...assertDirectionConsistency(report, text)];
  return { ok: violations.length === 0, violations };
}
