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
/** Communication, problem solving and the like: they count when shown, but never decide which role is nearest. */
const contextIds = new Set(skills.filter((s) => s.scoring === "context").map((s) => s.id));

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
      // Shared skills without the context ones, over the role's skills without them: the same counts the line shows,
      // but a role can't come first on "communication" alone.
      const contextShared = match.met.filter((m) => contextIds.has(m.skillId)).length;
      const key = line.shared - contextShared;
      const keyTotal = line.total - contextShared;
      return {
        line,
        key,
        keyShare: keyTotal ? key / keyTotal : 0,
        // How many of the resume's shown skills the role asks for at all, nice-to-have ones included.
        asks: key + match.niceToHave.filter((n) => n.status === "met" && !contextIds.has(n.skillId)).length,
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
        b.keyShare - a.keyShare ||
        b.asks - a.asks ||
        b.share - a.share ||
        b.line.shared - a.line.shared ||
        a.line.toAdd.length - b.line.toAdd.length ||
        b.like - a.like ||
        a.line.title.localeCompare(b.line.title),
    );

  // Near on key skills: a role isn't near because the resume shows communication. The line still shows every shared skill.
  const near = scored.filter((s) => s.keyShare >= NEARBY_MIN_SHARE && s.key >= NEARBY_MIN_SHARED).slice(0, NEARBY_MAX);
  if (near.length) return nearbyLines.parse({ lines: near.map((s) => s.line), closest: null });
  // Closest when none is near: the role holding the most of the resume's key skills (half for each one only listed),
  // at least two, then the one asking for more of the resume, then share, then likeness to the target role. So a small
  // role sharing 2 of its 6 doesn't beat a larger one the resume holds as much of, and one shared skill names nothing
  // (src/evals/closest-eval.test.ts).
  const held = (s: (typeof scored)[number]) => s.key + s.line.onResume.length / 2;
  const best = scored
    .filter((s) => s.key >= NEARBY_MIN_SHARED)
    .sort((a, b) => held(b) - held(a) || b.asks - a.asks || b.share - a.share || b.like - a.like || a.line.title.localeCompare(b.line.title))[0];
  return nearbyLines.parse({
    lines: [],
    closest: best ? { slug: best.line.slug, title: best.line.title, shared: best.line.shared, total: best.line.total } : null,
  });
}
