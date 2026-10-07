import type { EvalCase, GapStatus } from "@/lib/schemas";

/** What the pipeline produced for one eval case, reduced to what we score. */
export type EvalPrediction = {
  skillIds: string[];
  gaps: { skillId: string; status: Exclude<GapStatus, "met"> }[];
};

export type CaseScore = {
  /** Share of expected skills the parser found. */
  parseRecall: number;
  /** Share of predicted gaps that are real gaps. */
  gapPrecision: number;
  /** Share of real gaps the pipeline reported. */
  gapRecall: number;
  /** Of the gaps found on both sides, the share with the right status. */
  statusAccuracy: number;
  /** Skills claimed that the resume gives no evidence for. */
  hallucinations: string[];
};

const ratio = (hit: number, total: number) => (total === 0 ? 1 : hit / total);

export function scoreCase(c: EvalCase, p: EvalPrediction): CaseScore {
  const predictedSkills = new Set(p.skillIds);
  const expectedGaps = new Map(c.expected.gaps.map((g) => [g.skillId, g.status]));
  const matchedGaps = p.gaps.filter((g) => expectedGaps.has(g.skillId));

  return {
    parseRecall: ratio(c.expected.skills.filter((s) => predictedSkills.has(s.skillId)).length, c.expected.skills.length),
    gapPrecision: ratio(matchedGaps.length, p.gaps.length),
    gapRecall: ratio(matchedGaps.length, expectedGaps.size),
    statusAccuracy: ratio(matchedGaps.filter((g) => expectedGaps.get(g.skillId) === g.status).length, matchedGaps.length),
    hallucinations: c.expected.mustNotClaim.filter((id) => predictedSkills.has(id)),
  };
}
