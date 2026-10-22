/**
 * content-guard tests (W5-3).
 *
 * The guard is the only thing standing between LLM wording and the product's
 * compliance promises, so these tests pin the banned vocabulary, English-only
 * rule, attachment-direction consistency (claim + negation) and the combined
 * `guardNarrative` result shape.
 */
import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_TERMS,
  assertCompliance,
  assertDirectionConsistency,
  guardNarrative,
  readRuleDirections,
} from "@/lib/content-guard";
import type { ReportDataV2 } from "@/lib/report-contract";
import type { AttachmentDirection } from "@/rules/attachment";

function directionReport(user: AttachmentDirection, partner: AttachmentDirection): ReportDataV2 {
  return {
    chapters: [
      { attachment: { direction: user } },
      { sides: [{ direction: user }, { direction: partner }] },
      {},
      {},
      {},
      {},
    ],
  } as unknown as ReportDataV2;
}

describe("assertCompliance · banned vocabulary", () => {
  it("flags clinical / therapy vocabulary", () => {
    const samples = [
      "You may want to talk to a therapist about this.",
      "This looks like therapy territory.",
      "Consider counseling for this pattern.",
      "It reads like a counselling referral.",
      "We can't diagnose anything from texts.",
      "That is a clinical observation.",
      "This is a mental health service.",
      "Mental-health language does not belong here.",
      "Your psychologist would say otherwise.",
      "A psychiatrist might frame it differently.",
    ];
    for (const sample of samples) {
      const violations = assertCompliance(sample);
      expect(violations.some((violation) => violation.code === "banned-term")).toBe(true);
    }
  });

  it("exposes the banned list for the prompt and the guard", () => {
    expect(FORBIDDEN_TERMS).toContain("therapy");
    expect(FORBIDDEN_TERMS).toContain("mental health");
  });

  it("accepts ordinary reflective English", () => {
    const text =
      "You both reply on a similar rhythm, and the conversation usually finds its way back after friction.";
    expect(assertCompliance(text)).toEqual([]);
  });

  it("rejects empty text and non-English characters", () => {
    expect(assertCompliance("   ")).toEqual([
      { code: "empty", detail: "Narrative text is empty." },
    ]);
    const cjk = assertCompliance("你们都回复得很快。");
    expect(cjk.some((violation) => violation.code === "non-english")).toBe(true);
  });

  it("is conservative even when the clinical word is negated", () => {
    // "This is not therapy" still uses the word; the product never wants it.
    expect(assertCompliance("This is not therapy.")[0]?.code).toBe("banned-term");
  });
});

describe("assertDirectionConsistency", () => {
  it("reads the stamped directions from the report", () => {
    const report = directionReport("anxious", "avoidant");
    expect(readRuleDirections(report)).toEqual({ user: "anxious", partner: "avoidant" });
    expect(readRuleDirections({} as ReportDataV2)).toBeNull();
    expect(readRuleDirections({ chapters: [] } as unknown as ReportDataV2)).toBeNull();
  });

  it("accepts copy that matches both stamped directions", () => {
    const report = directionReport("anxious", "avoidant");
    const text =
      "You read as anxious-leaning while your partner reads as avoidant-leaning; the pace explains most of it.";
    expect(assertDirectionConsistency(report, text)).toEqual([]);
    expect(assertDirectionConsistency(report, "Your partner is avoidant here.")).toEqual([]);
  });

  it("rejects a third direction that reverses the rules report", () => {
    const report = directionReport("anxious", "avoidant");
    const violations = assertDirectionConsistency(report, "You read as secure-leaning.");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe("direction-conflict");
    expect(violations[0]?.match).toBe("secure");
  });

  it("rejects negating the stamped direction", () => {
    const report = directionReport("anxious", "avoidant");
    const violations = assertDirectionConsistency(report, "You are not anxious at all.");
    expect(violations.some((violation) => violation.code === "direction-negation")).toBe(true);

    const after = assertDirectionConsistency(report, "The anxious pattern isn't really there.");
    expect(after.some((violation) => violation.code === "direction-negation")).toBe(true);
  });

  it("allows any direction word when a side is 'mixed' (scores were too close)", () => {
    const report = directionReport("mixed", "anxious");
    expect(assertDirectionConsistency(report, "Secure and avoidant patterns both appear.")).toEqual(
      [],
    );
    // Negating the stamped mixed label is still a violation.
    expect(
      assertDirectionConsistency(report, "This is not mixed signals.").some(
        (violation) => violation.code === "direction-negation",
      ),
    ).toBe(true);
  });
});

describe("guardNarrative", () => {
  it("combines compliance and direction checks", () => {
    const report = directionReport("anxious", "avoidant");
    const ok = guardNarrative(
      report,
      "You read as anxious-leaning and your partner as avoidant-leaning; repair attempts land.",
    );
    expect(ok.ok).toBe(true);
    expect(ok.violations).toEqual([]);

    const bad = guardNarrative(
      report,
      "You are not anxious - you are secure-leaning. This may need therapy.",
    );
    expect(bad.ok).toBe(false);
    const codes = bad.violations.map((violation) => violation.code);
    expect(codes).toContain("direction-negation");
    expect(codes).toContain("direction-conflict");
    expect(codes).toContain("banned-term");
  });
});
