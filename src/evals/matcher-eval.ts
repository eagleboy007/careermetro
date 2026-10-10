import { roleProfiles, skills } from "@/content";
import { matchProfile } from "@/lib/gaps/match";
import type { EvalCase, Profile } from "@/lib/schemas";
import { scoreCase, type CaseScore } from "./score";

const nameById = new Map(skills.map((s) => [s.id, s.name]));
/** Skills the app never shows as gaps (communication, problem solving): labels for them don't count against the matcher. */
const context = new Set(skills.filter((s) => s.scoring === "context").map((s) => s.id));

/**
 * The profile a perfect parser would return for this case: each expected skill under its taxonomy name with
 * its labelled quote. It has no jobs or dates, so it isolates the matcher from parsing.
 */
export function expectedProfile(c: EvalCase): Profile {
  return {
    headline: null,
    totalYearsExperience: c.expected.totalYearsExperience,
    roles: [],
    skills: c.expected.skills.map((s) => ({ name: nameById.get(s.skillId) ?? s.skillId, lastUsed: null, evidence: [s.quote] })),
    education: [],
    certifications: [],
  };
}

export type MatcherCaseScore = CaseScore & { id: string };

/** Runs the matcher on every case's expected profile and scores the gaps against the labels (AI-4). Free and deterministic. */
export function runMatcherEval(cases: EvalCase[], now = new Date("2026-10-07T00:00:00Z")): MatcherCaseScore[] {
  return cases.map((c) => {
    const role = roleProfiles.find((r) => r.slug === c.roleSlug);
    if (!role) throw new Error(`Eval case ${c.id} names unknown role ${c.roleSlug}`);
    const result = matchProfile(expectedProfile(c), role, now);
    // A "one of these" group gap may name any of its skills on either side, so both score under the group.
    const groupOf = new Map(result.groups.flatMap((g) => g.skillIds.map((id) => [id, `group:${g.id}`] as const)));
    const key = (id: string) => groupOf.get(id) ?? id;
    const gaps = result.gaps.map((g) => ({ skillId: key(g.skillId), status: g.status as "missing" | "weak" | "outdated" }));
    const expectedGaps = c.expected.gaps
      .filter((g) => !context.has(g.skillId))
      .map((g) => ({ ...g, skillId: key(g.skillId) }));
    const scoredCase = { ...c, expected: { ...c.expected, gaps: expectedGaps } };
    return { id: c.id, ...scoreCase(scoredCase, { skillIds: c.expected.skills.map((s) => s.skillId), gaps }) };
  });
}
