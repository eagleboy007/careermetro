import { roleProfiles, skills } from "@/content";
import { profileLinkOrder } from "./links";
import type { BuilderData } from "./types";

const skillNames = new Map(skills.map((s) => [s.id, s.name]));
const skillCategories = new Map(skills.map((s) => [s.id, s.category]));

/** The roles to pick on the Role card, by title. */
export const builderRoles: BuilderData["roles"] = roleProfiles.map((r) => ({ slug: r.slug, title: r.title })).sort((a, b) => a.title.localeCompare(b.title, "en"));

/** Each role's skills by taxonomy name for the Tools chips: required first, then nice to have. */
export const builderRoleTools: BuilderData["roleTools"] = Object.fromEntries(
  roleProfiles.map((r) => [
    r.slug,
    [...r.skills.filter((s) => s.importance === "required"), ...r.skills.filter((s) => s.importance !== "required")].map((s) => skillNames.get(s.skillId) ?? s.skillId),
  ]),
);

/** Each role's profile links in the order the Links card asks for them, from its required skills' categories (T182). */
export const builderRoleLinks: NonNullable<BuilderData["roleLinks"]> = Object.fromEntries(
  roleProfiles.map((r) => [
    r.slug,
    profileLinkOrder(r.skills.filter((s) => s.importance === "required").flatMap((s) => {
      const category = skillCategories.get(s.skillId);
      return category ? [category] : [];
    })),
  ]),
);
