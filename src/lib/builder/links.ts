import type { Skill } from "@/lib/schemas";

type SkillCategory = Skill["category"];

/*
 * The order of the profile links on the builder's Links card (T182). Plain code, free of content files so the client
 * can use it. The signal is the target role's required skills by taxonomy category, so a new role sorts itself: when
 * any of them is code (programming, web, ML, cloud and DevOps), GitHub comes first, since code counts as evidence
 * there. When most are design, the portfolio comes first. Otherwise, and with no role yet, LinkedIn comes first.
 */

export const PROFILE_LINKS = ["github", "portfolio", "linkedin"] as const;
export type ProfileLink = (typeof PROFILE_LINKS)[number];

/** Skill categories where a person's own code shows the skill. */
export const CODE_CATEGORIES: readonly SkillCategory[] = ["programming", "web", "ml", "cloud-devops"];

/** The links in the order to ask for them, from the categories of the role's required skills (none: no role picked). */
export function profileLinkOrder(requiredCategories: readonly SkillCategory[] = []): ProfileLink[] {
  if (requiredCategories.some((c) => CODE_CATEGORIES.includes(c))) return ["github", "linkedin", "portfolio"];
  const design = requiredCategories.filter((c) => c === "design").length;
  if (design > 0 && design * 2 >= requiredCategories.length) return ["portfolio", "linkedin", "github"];
  return ["linkedin", "portfolio", "github"];
}
