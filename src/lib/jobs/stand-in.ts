import { HOURS_BY_STATUS, matchProfile, OUTDATED_AFTER_YEARS, type MatchedSkill } from "@/lib/gaps/match";
import type { Gap, GapAnalysis, GapStatus, Profile } from "@/lib/schemas";
import { postingRole, type StoredJobCheck } from "./groups";

/**
 * A job check standing in as the target when our library doesn't have the role yet (role-suggest-plan.md part B,
 * point 4). The posting's required skills are the gaps against the resume, decided by the same deterministic matcher
 * as a library role; the words are fixed sentences, so no model is called and none decides a gap. It never makes goals,
 * a path or a match: those stay with library roles.
 */
export type StandInView = {
  id: string;
  company: string;
  title: string;
  /** ISO date-time the check was saved. */
  createdAt: string;
  readiness: GapAnalysis["readiness"];
  /** Every required skill of the posting the resume doesn't show, most important first, as the Gaps page shows gaps. */
  gaps: Gap[];
  /** Required skills the resume shows, or that accepted proof covers (an account's only). */
  met: { skillId: string; skillName: string; status: GapStatus; by: "resume" | "proof" }[];
  /** The posting's nice-to-haves, never counted as gaps. */
  goodToHave: { skillId: string; skillName: string; status: GapStatus }[];
  /** Names the posting asks for that aren't in our skill list yet. Not scored. */
  unknown: string[];
};

const YEARS: Record<number, string> = { 3: "three", 4: "four", 5: "five" };

function explanation(g: MatchedSkill): string {
  const asks = `This job posting asks for ${g.skillName}.`;
  return g.status === "outdated"
    ? `The latest use of ${g.skillName} on your resume is more than ${YEARS[OUTDATED_AFTER_YEARS] ?? OUTDATED_AFTER_YEARS} years old. ${asks}`
    : asks;
}

export function standInView(
  check: StoredJobCheck,
  profile: Profile,
  proved: ReadonlySet<string> = new Set(),
  { now = new Date() }: { now?: Date } = {},
): StandInView {
  const match = matchProfile(profile, postingRole(check, now), now);
  const open = match.gaps.filter((g) => !proved.has(g.skillId));
  const met: StandInView["met"] = [
    ...match.met.map((m) => ({ skillId: m.skillId, skillName: m.skillName, status: "met" as const, by: "resume" as const })),
    ...match.gaps.filter((g) => proved.has(g.skillId)).map((g) => ({ skillId: g.skillId, skillName: g.skillName, status: "met" as const, by: "proof" as const })),
  ];
  const hours = open.reduce((sum, g) => sum + HOURS_BY_STATUS[g.status as keyof typeof HOURS_BY_STATUS], 0);
  const total = match.readiness.requiredTotal;
  return {
    id: check.id,
    company: check.company,
    title: check.title,
    createdAt: check.createdAt.toISOString(),
    readiness: {
      headline: `You cover ${met.length} of the ${total} ${total === 1 ? "skill" : "skills"} this job asks for.`,
      explanation:
        open.length === 0
          ? "Your resume shows every skill this posting asks for."
          : `As a rough estimate, about ${hours} hours of focused work closes the remaining gaps.`,
      estimatedHours: hours,
    },
    gaps: open.map((g) => ({
      skillId: g.skillId,
      skillName: g.skillName,
      status: g.status as Gap["status"],
      resumeQuote: g.resumeQuote,
      requirement: g.requirement,
      explanation: explanation(g),
    })),
    met,
    goodToHave: match.niceToHave.map((n) => ({
      skillId: n.skillId,
      skillName: n.skillName,
      status: n.status !== "met" && proved.has(n.skillId) ? "met" : n.status,
    })),
    unknown: check.unknownSkills,
  };
}
