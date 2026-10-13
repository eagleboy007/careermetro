import { matchProfile } from "@/lib/gaps/match";
import { meFromProfile } from "@/lib/me/build";
import type { Profile, RoleProfile } from "@/lib/schemas";
import { skillName } from "./job-content";
export { matchSummary } from "./match-words";
import type { CandidateProfileView, JobMatchView, JobRequirementsView, MatchLineView, MatchState } from "./types";

/*
 * What a company sees of a candidate (dev/corporate-plan.md, Privacy rules; Milin, 9 Oct: job match only). Plain code:
 * the same deterministic matcher as Gaps reads the job's own requirements against the resume sent, and accepted proof
 * lifts a skill to Proved. The model is never asked. Nothing here returns a resume line, or the person's goals, gaps
 * or path; the job's extra skills never touch their goals.
 */

const RANK: Record<MatchState, number> = { not_on_resume: 0, on_resume: 1, proved: 2 };

/** The job as a role for the matcher: every skill it names, with no groups (each group is read below). */
function jobRole(r: JobRequirementsView, now: Date): RoleProfile {
  const required = [...new Set([...r.required, ...r.oneOf.flat()])];
  return {
    slug: "posted-job",
    title: "This job",
    experienceBand: { minYears: 0, maxYears: 50 },
    skills: [
      ...required.map((skillId) => ({ skillId, importance: "required" as const, expectation: "Asked for in this job", postingShare: null })),
      ...r.nice.filter((id) => !required.includes(id)).map((skillId) => ({ skillId, importance: "nice_to_have" as const, expectation: "Nice to have in this job", postingShare: null })),
    ],
    groups: [],
    certifications: [],
    sources: [{ description: "A job posted on CareerMetro", url: null }],
    reviewedBy: null,
    updatedOn: now.toISOString().slice(0, 10),
  };
}

/**
 * Match to this job, in words: each required skill, each "one of these" group (its best skill counts) and each nice to
 * have reads Proved (current accepted proof), On resume, not proved (the matcher finds it on the resume, however
 * weakly) or Not on resume. `profile` is null when no resume was sent.
 */
export function jobMatch(r: JobRequirementsView, profile: Profile | null, proved: ReadonlySet<string>, now = new Date()): JobMatchView {
  const onResume = new Set<string>();
  if (profile) {
    const m = matchProfile(profile, jobRole(r, now), now);
    for (const row of [...m.met, ...m.gaps, ...m.niceToHave]) if (row.status !== "missing") onResume.add(row.skillId);
  }
  const state = (id: string): MatchState => (proved.has(id) ? "proved" : onResume.has(id) ? "on_resume" : "not_on_resume");
  const lines: MatchLineView[] = [
    ...r.required.map((id) => ({ label: skillName(id), state: state(id), group: "required" as const })),
    ...r.oneOf.map((g) => ({
      label: `One of: ${g.map(skillName).join(", ")}`,
      state: g.map(state).reduce<MatchState>((best, s) => (RANK[s] > RANK[best] ? s : best), "not_on_resume"),
      group: "one_of" as const,
    })),
    ...r.nice.map((id) => ({ label: skillName(id), state: state(id), group: "nice" as const })),
  ];
  const required = lines.filter((l) => l.group !== "nice");
  return {
    lines,
    requiredProved: required.filter((l) => l.state === "proved").length,
    requiredOnResume: required.filter((l) => l.state === "on_resume").length,
    requiredTotal: required.length,
  };
}

/**
 * The public profile a company sees: name, and from the resume sent only job titles, employers, dates, education and
 * certification names. Never the lines under a job, the skills' evidence, or the person's gaps.
 */
export function publicProfile(name: string, profile: Profile | null, now = new Date()): CandidateProfileView {
  if (!profile) return { name, headline: null, experience: [], education: [], certifications: [] };
  const me = meFromProfile({ name, profile, analysis: null, line: null, skillName, joinedAt: now, resumeReadAt: null, now });
  const current = me.experience.find((e) => e.current);
  return {
    name: me.name,
    headline: current ? `Working at ${current.employer}` : "Looking for a next role",
    experience: me.experience.map(({ title, employer, dates }) => ({ title, employer, dates })),
    education: me.education,
    certifications: me.certifications.map((c) => c.name),
  };
}
