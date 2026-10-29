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

/** A role's required skills, for how alike two roles are. */
const requiredIds = (role: RoleProfile) => new Set(role.skills.filter((s) => s.importance === "required").map((s) => s.skillId));
/** Shared required skills over all required skills of the two roles (0 to 1). */
const likeness = (a: Set<string>, b: Set<string>) => {
  let both = 0;
  for (const id of a) if (b.has(id)) both++;
  return both / (a.size + b.size - both || 1);
};
/** What the person holds of a role: shared skills, and half for each skill only on the resume (listed, not yet shown). */
const held = (line: NearbyLine) => line.shared + line.onResume.length / 2;

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
  const target = roles.find((r) => r.slug === targetSlug) ?? roleProfiles.find((r) => r.slug === targetSlug);
  const targetIds = target ? requiredIds(target) : new Set<string>();
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
        // How alike the role is to the one the person is heading for: breaks ties between roles that share as much.
        like: likeness(targetIds, requiredIds(role)),
      };
    })
    .filter((s) => s.line.total > 0)
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) ||
        b.share - a.share ||
        b.line.shared - a.line.shared ||
        a.line.toAdd.length - b.line.toAdd.length ||
        b.like - a.like ||
        a.line.title.localeCompare(b.line.title),
    );

  const near = scored.filter((s) => s.share >= NEARBY_MIN_SHARE && s.line.shared >= NEARBY_MIN_SHARED).slice(0, NEARBY_MAX);
  if (near.length) return nearbyLines.parse({ lines: near.map((s) => s.line), closest: null });
  // Closest when none is near: the most held, not the highest share, so a small role sharing 2 of its 6 skills doesn't
  // beat a larger one the resume also lists more of; then share, then likeness to the target role
  // (src/evals/closest-eval.test.ts).
  const best = scored
    .filter((s) => s.line.shared > 0)
    .sort((a, b) => held(b.line) - held(a.line) || b.share - a.share || b.like - a.like || a.line.title.localeCompare(b.line.title))[0];
  return nearbyLines.parse({
    lines: [],
    closest: best ? { slug: best.line.slug, title: best.line.title, shared: best.line.shared, total: best.line.total } : null,
  });
}
