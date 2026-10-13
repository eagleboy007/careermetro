import { roleProfiles, skills } from "@/content";
import { skillGroups, type RoleProfile } from "@/lib/schemas";
import { JOB_NICE_MAX, JOB_ONE_OF_GROUPS_MAX, JOB_ONE_OF_SIZE_MAX, JOB_REQUIRED_MAX } from "@/lib/schemas/constants";
import type { JobRequirementsView, RoleOptionView, SkillOptionView } from "./types";

/*
 * Jobs start from our role profiles and ask only for skills in our taxonomy (dev/corporate-plan.md build step 3,
 * handoff 12g). Server only: it reads the content files, which never ship to phones; the form gets plain lists.
 */

const byId = new Map(skills.map((s) => [s.id, s]));
const bySlug = new Map(roleProfiles.map((r) => [r.slug, r]));

export const roleBySlug = (slug: string): RoleProfile | undefined => bySlug.get(slug);

/** A skill's name, or its id if it has left the taxonomy since the job was saved. */
export const skillName = (id: string): string => byId.get(id)?.name ?? id;

/** Skill ids in the requirements that aren't in our taxonomy. */
export function unknownSkills(r: JobRequirementsView): string[] {
  return [...r.required, ...r.oneOf.flat(), ...r.nice].filter((id) => !byId.has(id));
}

/**
 * A role profile's skills as a job's starting requirements: required skills outside a group, its "one of these"
 * groups, and nice to have. A job asks for at most 8 required skills (handoff 12g), so a role's extra required skills
 * start as nice to have, where they never block; the person posting can move them back.
 */
export function requirementsFromRole(role: Pick<RoleProfile, "skills" | "groups">): JobRequirementsView {
  const solo = role.skills.filter((s) => s.importance === "required" && s.oneOf === undefined).map((s) => s.skillId);
  const nice = role.skills.filter((s) => s.importance === "nice_to_have").map((s) => s.skillId);
  return {
    required: solo.slice(0, JOB_REQUIRED_MAX),
    oneOf: skillGroups(role)
      .slice(0, JOB_ONE_OF_GROUPS_MAX)
      .map((g) => g.skillIds.slice(0, JOB_ONE_OF_SIZE_MAX)),
    nice: [...solo.slice(JOB_REQUIRED_MAX), ...nice].slice(0, JOB_NICE_MAX),
  };
}

/** Every role profile, by title, with its starting requirements. */
export const roleOptions = (): RoleOptionView[] =>
  roleProfiles.map((r) => ({ slug: r.slug, title: r.title, requirements: requirementsFromRole(r) })).sort((a, b) => a.title.localeCompare(b.title));

/** Our skill list for the pickers, by category then name. */
export const skillOptions = (): SkillOptionView[] =>
  skills.map((s) => ({ id: s.id, name: s.name, category: s.category })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

/** Requirements as names, for Departures. */
export const requirementNames = (r: JobRequirementsView) => ({
  required: r.required.map(skillName),
  oneOf: r.oneOf.map((g) => g.map(skillName)),
  nice: r.nice.map(skillName),
});
