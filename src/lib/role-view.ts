import { certifications, roleProfiles, skills } from "@/content";
import { skillGroups, type Certification, type RoleProfile } from "@/lib/schemas";

export type RoleSkillView = {
  skillId: string;
  name: string;
  expectation: string;
  /** Share of analysed postings that mention the skill, or null when not measured. */
  postingShare: number | null;
  /** A skill keywords can't judge (communication): never a gap, so counts and "top skills" leave it out. */
  context: boolean;
};

export type RoleCertificationView = Pick<Certification, "id" | "name" | "issuer" | "level" | "cost"> & {
  importance: "recommended" | "optional";
  why: string;
};

export type RoleView = {
  slug: string;
  title: string;
  /** What the role is, in two or three plain sentences, or null when the profile has none. */
  summary: string | null;
  /** What someone in the role does on a normal day; empty when the profile has none. */
  dailyDuties: string[];
  experience: string;
  required: RoleSkillView[];
  niceToHave: RoleSkillView[];
  certifications: RoleCertificationView[];
  /** Number of public job postings the shares were measured on, or null when none were analysed. */
  postingsAnalysed: number | null;
  sources: RoleProfile["sources"];
  reviewed: boolean;
  updatedOn: string;
};

const skillNames = new Map(skills.map((s) => [s.id, s.name]));
const contextSkills = new Set(skills.filter((s) => s.scoring === "context").map((s) => s.id));

/** The required skills the Gaps page scores, most asked first: what "core skills" counts and "top skills" shows. */
export const scoredSkills = (role: Pick<RoleView, "required">) => role.required.filter((s) => !s.context);
const certsById = new Map(certifications.map((c) => [c.id, c]));

/**
 * Years past a role's band that still allow suggesting it. Someone more than this past a role's band is never offered
 * it on any suggestion surface: role suggestions, Match, Nearby lines or the closest role (T179). An 11-year engineer
 * never sees a 0 to 2 year trainee role. The person's own target role is never hidden.
 */
export const PAST_BAND_GRACE = 2;

export function wellPastBand(years: number | null | undefined, { maxYears }: RoleProfile["experienceBand"]): boolean {
  return (years ?? 0) > maxYears + PAST_BAND_GRACE;
}

export function formatExperience({ minYears, maxYears }: RoleProfile["experienceBand"]): string {
  return minYears === 0 ? `Up to ${maxYears} years` : `${minYears} to ${maxYears} years`;
}

/** Reads the posting count from the miner's source line ("measured on N public job postings"). */
export function postingsAnalysed(sources: RoleProfile["sources"]): number | null {
  for (const s of sources) {
    const m = /measured on (\d+) public job postings?/.exec(s.description);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Most-asked skills first; unmeasured skills keep their authored order at the end. */
function byShare(a: RoleSkillView, b: RoleSkillView): number {
  return (b.postingShare ?? -1) - (a.postingShare ?? -1);
}

export function toRoleView(role: RoleProfile): RoleView {
  // A "one of these" group shows once, under its label, at its most asked skill's share.
  const groups = new Map(skillGroups(role).map((g) => [g.id, g]));
  const pick = (importance: "required" | "nice_to_have"): RoleSkillView[] =>
    role.skills
      .filter((s) => s.importance === importance)
      .flatMap((s): RoleSkillView[] => {
        const g = s.oneOf ? groups.get(s.oneOf) : undefined;
        if (g && g.skillIds[0] !== s.skillId) return [];
        const shares = g ? role.skills.filter((m) => m.oneOf === g.id).map((m) => m.postingShare) : [s.postingShare];
        const known = shares.filter((x): x is number => x !== null);
        return [
          {
            skillId: s.skillId,
            name: g?.label ?? skillNames.get(s.skillId) ?? s.skillId,
            expectation: s.expectation,
            postingShare: known.length ? Math.max(...known) : null,
            context: contextSkills.has(s.skillId),
          },
        ];
      })
      .sort(byShare);

  const certs = role.certifications.flatMap((rc) => {
    const c = certsById.get(rc.certId);
    if (!c) return [];
    return [{ id: c.id, name: c.name, issuer: c.issuer, level: c.level, cost: c.cost, importance: rc.importance, why: rc.why }];
  });
  certs.sort((a, b) => (a.importance === b.importance ? 0 : a.importance === "recommended" ? -1 : 1));

  return {
    slug: role.slug,
    title: role.title,
    summary: role.summary ?? null,
    dailyDuties: role.dailyDuties ?? [],
    experience: formatExperience(role.experienceBand),
    required: pick("required"),
    niceToHave: pick("nice_to_have"),
    certifications: certs,
    postingsAnalysed: postingsAnalysed(role.sources),
    sources: role.sources,
    reviewed: role.reviewedBy !== null,
    updatedOn: role.updatedOn,
  };
}

export const roleViews: RoleView[] = roleProfiles.map(toRoleView).sort((a, b) => a.title.localeCompare(b.title));

export function getRoleView(slug: string): RoleView | undefined {
  return roleViews.find((r) => r.slug === slug);
}
