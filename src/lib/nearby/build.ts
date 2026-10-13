import { roleProfiles, skills } from "@/content";
import { matchProfile, type MatchedSkill } from "@/lib/gaps/match";
import { formatExperience } from "@/lib/role-view";
import {
  NEARBY_MAX,
  NEARBY_MIN_SHARE,
  NEARBY_MIN_SHARED,
  nearbyLines,
  type NearbyLine,
  type NearbyLines,
  type Profile,
  type RoleProfile,
} from "@/lib/schemas";

export type NearbyInput = {
  profile: Profile;
  /** The person's target role: never a Nearby line of itself. */
  targetSlug: string;
  /** The live role profiles (the same list the role picker offers). */
  roles?: RoleProfile[];
  /** Skills with current accepted proof. Proof is per skill, so it carries over to every role. */
  proved?: ReadonlySet<string>;
  /** The skills of the goals on the person's line, in line order, for where a Nearby line crosses it on the Map. */
  lineSkillIds?: string[];
  now?: Date;
};

const skillNames = new Map(skills.map((s) => [s.id, s.name]));

/** The skills a matcher row stands for: a "one of these" group's skills, or the one skill. */
const unitSkills = (row: MatchedSkill) => row.group?.skillIds ?? [row.skillId];

/**
 * Nearby lines (pending item 24a, dev/nearby-lines-plan.md): the live roles that share at least half their key skills
 * with the person, and at least two. Plain code over the same deterministic matcher as the Gaps page, so "shares 6 of
 * its 9 key skills" says exactly what that role's Gaps page would. Only skills with evidence (or current accepted proof)
 * are shared; listed-only ones are kept apart. Nothing here changes goals, gaps or the match.
 */
export function nearbyLinesFor({ profile, targetSlug, roles = roleProfiles, proved = new Set(), lineSkillIds = [], now = new Date() }: NearbyInput): NearbyLines {
  const years = profile.totalYearsExperience ?? 0;
  const scored = roles
    .filter((r) => r.slug !== targetSlug)
    .map((role) => {
      const match = matchProfile(profile, role, now);
      const byProof = (row: MatchedSkill) => unitSkills(row).some((id) => proved.has(id));
      const open = match.gaps.filter((g) => !byProof(g));
      const sharedSkills = [
        ...match.met.map((m) => ({ name: m.skillName, byProof: false })),
        // A "one of these" group filled by proof is named by the proved skill, not by the group's label.
        ...match.gaps.filter(byProof).map((g) => {
          const provedId = g.group?.skillIds.find((id) => proved.has(id));
          return { name: provedId ? (skillNames.get(provedId) ?? g.skillName) : g.skillName, byProof: true };
        }),
      ];
      const openIds = new Set(open.flatMap(unitSkills));
      const line: NearbyLine = {
        slug: role.slug,
        title: role.title,
        experience: formatExperience(role.experienceBand),
        shared: sharedSkills.length,
        total: match.readiness.requiredTotal,
        sharedSkills,
        onResume: open.filter((g) => g.status === "weak").map((g) => g.skillName),
        toAdd: open.filter((g) => g.status !== "weak").map((g) => ({ name: g.skillName, outdated: g.status === "outdated" })),
        crossSkillIds: lineSkillIds.filter((id, i) => openIds.has(id) && lineSkillIds.indexOf(id) === i),
      };
      return {
        line,
        share: line.total ? line.shared / line.total : 0,
        // A year's grace, as role suggestions give: a role asking for more years than that goes after the ones that fit.
        fits: years >= role.experienceBand.minYears - 1,
      };
    })
    .filter((s) => s.line.total > 0)
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) ||
        b.share - a.share ||
        b.line.shared - a.line.shared ||
        a.line.toAdd.length - b.line.toAdd.length ||
        a.line.title.localeCompare(b.line.title),
    );

  const near = scored.filter((s) => s.share >= NEARBY_MIN_SHARE && s.line.shared >= NEARBY_MIN_SHARED).slice(0, NEARBY_MAX);
  if (near.length) return nearbyLines.parse({ lines: near.map((s) => s.line), closest: null });
  const best = scored
    .filter((s) => s.line.shared > 0)
    .sort((a, b) => b.share - a.share || b.line.shared - a.line.shared || a.line.title.localeCompare(b.line.title))[0];
  return nearbyLines.parse({
    lines: [],
    closest: best ? { slug: best.line.slug, title: best.line.title, shared: best.line.shared, total: best.line.total } : null,
  });
}
