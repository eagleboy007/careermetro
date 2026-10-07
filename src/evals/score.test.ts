import { describe, expect, it } from "vitest";
import type { EvalCase } from "@/lib/schemas";
import { scoreCase } from "./score";

const c: EvalCase = {
  id: "t",
  roleSlug: "data-analyst",
  persona: "test",
  resumeText: "x".repeat(200),
  expected: {
    totalYearsExperience: 1,
    skills: [
      { skillId: "excel", quote: "x" },
      { skillId: "sql", quote: "x" },
    ],
    gaps: [
      { skillId: "sql", status: "weak" },
      { skillId: "python", status: "missing" },
    ],
    mustNotClaim: ["tableau"],
  },
  reviewedBy: null,
};

describe("scoreCase", () => {
  it("gives a perfect score to a perfect prediction", () => {
    expect(scoreCase(c, { skillIds: ["excel", "sql"], gaps: c.expected.gaps })).toEqual({
      parseRecall: 1,
      gapPrecision: 1,
      gapRecall: 1,
      statusAccuracy: 1,
      hallucinations: [],
    });
  });

  it("penalises missed skills, wrong gaps, wrong statuses and hallucinations", () => {
    const score = scoreCase(c, {
      skillIds: ["excel", "tableau"],
      gaps: [
        { skillId: "sql", status: "missing" },
        { skillId: "statistics", status: "missing" },
      ],
    });
    expect(score).toEqual({ parseRecall: 0.5, gapPrecision: 0.5, gapRecall: 0.5, statusAccuracy: 0, hallucinations: ["tableau"] });
  });
});
