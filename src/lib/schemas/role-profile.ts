import { z } from "zod";

/** A curated role profile (FR-8, FR-9). Every profile records where it came from and when it was reviewed. */
export const roleSkill = z.object({
  skillId: z.string().min(1),
  importance: z.enum(["required", "nice_to_have"]),
  /** What the role expects in plain words, shown next to each gap. */
  expectation: z.string().min(1),
  /** Share of analysed public job postings for this role that mention the skill, or null when not measured. */
  postingShare: z.number().min(0).max(1).nullable().default(null),
  /** The id of a "one of these" group from the role's `groups`: the role needs any one skill of the group, not all. */
  oneOf: z.string().min(1).optional(),
}).strict();

/** A set of required skills where any one will do, such as one cloud platform (dev/role-one-of-plan.md). */
export const roleSkillGroup = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Plain words for the group as a gap, for example "A cloud platform (AWS, Azure or GCP)". */
  label: z.string().min(1),
}).strict();

export const roleCertification = z.object({
  certId: z.string().min(1),
  /** recommended: the best-value pick for this role. optional: worth it for some employers or later in a career. */
  importance: z.enum(["recommended", "optional"]),
  /** Why it helps, in plain words. */
  why: z.string().min(1),
});

export const roleProfile = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  experienceBand: z.object({
    minYears: z.number().int().nonnegative(),
    maxYears: z.number().int().positive(),
  }),
  skills: z.array(roleSkill).min(3),
  groups: z.array(roleSkillGroup).default([]),
  certifications: z.array(roleCertification).default([]),
  sources: z
    .array(
      z.object({
        description: z.string().min(1),
        url: z.url().nullable(),
      }),
    )
    .min(1),
  reviewedBy: z.string().nullable(),
  updatedOn: z.iso.date(),
}).strict().superRefine((role, ctx) => {
  const ids = new Set(role.groups.map((g) => g.id));
  if (ids.size !== role.groups.length) ctx.addIssue({ code: "custom", path: ["groups"], message: "Group ids must be unique" });
  for (const s of role.skills) {
    if (s.oneOf === undefined) continue;
    if (!ids.has(s.oneOf)) ctx.addIssue({ code: "custom", path: ["skills"], message: `${s.skillId} names unknown group ${s.oneOf}` });
    if (s.importance !== "required") ctx.addIssue({ code: "custom", path: ["skills"], message: `${s.skillId}: only required skills form a group` });
  }
  for (const g of role.groups) {
    if (role.skills.filter((s) => s.oneOf === g.id).length < 2) {
      ctx.addIssue({ code: "custom", path: ["groups"], message: `Group ${g.id} needs at least two skills` });
    }
  }
});
export type RoleProfile = z.infer<typeof roleProfile>;

/** A role's "one of these" groups with their skills, in role order. */
export function skillGroups(role: Pick<RoleProfile, "skills" | "groups">): { id: string; label: string; skillIds: string[] }[] {
  return role.groups.map((g) => ({ ...g, skillIds: role.skills.filter((s) => s.oneOf === g.id).map((s) => s.skillId) }));
}

/**
 * The required skills of a role as the matcher counts them: a skill outside any group counts on its own, a group
 * counts once. Each unit lists its skills.
 */
export function requiredUnits(role: Pick<RoleProfile, "skills" | "groups">): string[][] {
  const groups = new Map(skillGroups(role).map((g) => [g.id, g.skillIds]));
  const seen = new Set<string>();
  const units: string[][] = [];
  for (const s of role.skills) {
    if (s.importance !== "required") continue;
    if (s.oneOf === undefined) units.push([s.skillId]);
    else if (!seen.has(s.oneOf)) {
      seen.add(s.oneOf);
      units.push(groups.get(s.oneOf)!);
    }
  }
  return units;
}
