import { roleProfiles } from "@/content";
import { HOURS_BY_STATUS, matchProfile, type MatchedSkill } from "@/lib/gaps/match";
import { MIN_SHARE } from "@/lib/gaps/suggest";
import { matchList, type MatchHours, type MatchList, type MatchRole, type Profile, type RoleProfile } from "@/lib/schemas";
import { clip } from "@/lib/text";

export type MatchInput = {
  profile: Profile;
  /** The person's target role: tagged "on your line", and always listed. */
  targetSlug: string;
  /** The resume behind the current gaps, for "Gaps for this role". Null in example data. */
  resumeId: string | null;
  weeklyHours: MatchHours;
  /** The live role profiles (the same list the role picker offers). */
  roles?: RoleProfile[];
  /** Skills with current accepted proof. Proof is per skill, so it carries over to every role. */
  proved?: ReadonlySet<string>;
  /**
   * Learning hours left on the newest path's steps, by skill: the step's hours, or 0 once it is marked done. A step is
   * per skill, so it counts for every role that needs that skill.
   */
  pathHours?: ReadonlyMap<string, number>;
  /** Open jobs in Departures by role slug. Null when they couldn't be read. */
  openJobs?: ReadonlyMap<string, number> | null;
  now?: Date;
};

/** The skills a matcher row stands for: a "one of these" group's skills, or the one skill. */
const unitSkills = (row: MatchedSkill) => row.group?.skillIds ?? [row.skillId];

/**
 * Path hours left on one open goal. Stored paths exist only for the target role (and hold at most 6 steps), so a goal
 * the path has a step for takes that step's hours, and any other goal, on any role, takes the Gaps page's estimate by
 * status (HOURS_BY_STATUS, the table the path builder caps its steps with). No path is built or stored here.
 */
function goalHours(row: MatchedSkill, pathHours: ReadonlyMap<string, number>): number {
  for (const id of [row.skillId, ...unitSkills(row)]) {
    const h = pathHours.get(id);
    if (h !== undefined) return h;
  }
  return HOURS_BY_STATUS[row.status as keyof typeof HOURS_BY_STATUS];
}

/**
 * Match (FR-24, handoff 12i): every live role with how many of its required skills the person has met or proved, the
 * goals it still needs and the path hours left on them. Plain code over the same deterministic matcher as the Gaps
 * page, Nearby lines and "Closest to your resume", so "4 of 6 met" says exactly what that role's Gaps page would. A
 * role the resume barely covers (no required skill, or under MIN_SHARE of them, as "Closest to your resume" rules) is
 * left off, except the target role. Weeks follow the hours a week on the page (src/lib/match/group.ts). No AI, and
 * nothing here changes goals, gaps or the train.
 */
export function matchListFor({
  profile,
  targetSlug,
  resumeId,
  weeklyHours,
  roles = roleProfiles,
  proved = new Set(),
  pathHours = new Map(),
  openJobs = new Map(),
  now = new Date(),
}: MatchInput): MatchList {
  const out: MatchRole[] = roles.flatMap((role) => {
    const match = matchProfile(profile, role, now);
    const required = match.readiness.requiredTotal;
    if (required === 0) return [];
    const open = match.gaps.filter((g) => !unitSkills(g).some((id) => proved.has(id)));
    const met = required - open.length;
    const onLine = role.slug === targetSlug;
    if (!onLine && (met === 0 || met / required < MIN_SHARE)) return [];
    return [
      {
        slug: role.slug,
        title: role.title,
        onLine,
        required,
        met,
        open: open.map((g) => clip(g.skillName, 80)),
        hours: open.reduce((sum, g) => sum + goalHours(g, pathHours), 0),
        jobs: openJobs === null ? null : (openJobs.get(role.slug) ?? 0),
      },
    ];
  });
  return matchList.parse({ resumeId, weeklyHours, roles: out });
}
