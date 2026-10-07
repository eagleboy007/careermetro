import { certifications, roleProfiles, skills } from "@/content";
import type { Certification, RoleProfile } from "@/lib/schemas";

export type RoleSkillView = {
  skillId: string;
  name: string;
  expectation: string;
  /** Share of analysed postings that mention the skill, or null when not measured. */
  postingShare: number | null;
};

export type RoleCertificationView = Pick<Certification, "id" | "name" | "issuer" | "level" | "cost"> & {
  importance: "recommended" | "optional";
  why: string;
};

export type RoleView = {
  slug: string;
  title: string;
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
const certsById = new Map(certifications.map((c) => [c.id, c]));

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
  const pick = (importance: "required" | "nice_to_have"): RoleSkillView[] =>
    role.skills
      .filter((s) => s.importance === importance)
      .map((s) => ({
        skillId: s.skillId,
        name: skillNames.get(s.skillId) ?? s.skillId,
        expectation: s.expectation,
        postingShare: s.postingShare,
      }))
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
