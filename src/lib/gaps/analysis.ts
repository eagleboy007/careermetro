import { gapAnalysis, type GapAnalysis } from "@/lib/schemas";
import type { MatchedSkill, MatchResult } from "./match";
import { OUTDATED_AFTER_YEARS } from "./match";

/** FR-11: the Gaps page shows the top five gaps. */
export const SHOWN_GAPS = 5;

export type Explanations = { readiness: string; bySkill: Map<string, string> };

/** A plain sentence for a gap, used when the model's explanation is not available. */
export function templateExplanation(g: MatchedSkill): string {
  // Role expectations are written as instructions ("Write user stories..."), so they follow "expects you to".
  const task = g.requirement.replace(/\.$/, "").replace(/^(\p{Lu})(?=\p{Ll})/u, (c) => c.toLowerCase());
  const expects = `This role expects you to ${task}.`;
  switch (g.status) {
    case "weak":
      return `Your resume names ${g.skillName} but shows no example of using it. ${expects}`;
    case "outdated":
      return `The latest use of ${g.skillName} on your resume is more than ${YEARS[OUTDATED_AFTER_YEARS] ?? OUTDATED_AFTER_YEARS} years old. ${expects}`;
    default:
      // The Gaps card already says nothing in the resume shows it.
      return expects;
  }
}

const YEARS: Record<number, string> = { 3: "three", 4: "four", 5: "five" };

export function readinessHeadline(match: MatchResult): string {
  const { requiredMet, requiredTotal } = match.readiness;
  return `You cover ${requiredMet} of the ${requiredTotal} skills this role requires.`;
}

export function templateReadiness(match: MatchResult): string {
  const hours = match.readiness.estimatedHours;
  return hours === 0
    ? "Your resume shows every required skill for this role."
    : `As a rough estimate, about ${hours} hours of focused work closes the rest.`;
}

/** The stored and displayed analysis: the matcher's decisions with the model's words, or template words. */
export function buildGapAnalysis(match: MatchResult, explanations: Explanations | null): GapAnalysis {
  return gapAnalysis.parse({
    roleSlug: match.roleSlug,
    gaps: match.gaps.slice(0, SHOWN_GAPS).map((g) => ({
      skillId: g.skillId,
      skillName: g.skillName,
      status: g.status,
      resumeQuote: g.resumeQuote,
      requirement: g.requirement,
      explanation: explanations?.bySkill.get(g.skillId) ?? templateExplanation(g),
    })),
    metSkillIds: match.met.map((m) => m.skillId),
    niceToHave: match.niceToHave.map(({ skillId, skillName, status }) => ({ skillId, skillName, status })),
    readiness: {
      headline: readinessHeadline(match),
      explanation: explanations?.readiness ?? templateReadiness(match),
      estimatedHours: match.readiness.estimatedHours,
    },
  });
}
