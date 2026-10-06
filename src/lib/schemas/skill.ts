import { z } from "zod";

export const skillCategory = z.enum([
  "programming",
  "web",
  "data",
  "ml",
  "cloud-devops",
  "testing",
  "product",
  "business",
  "marketing",
  "design",
  "tools",
  "workplace",
]);

/** One entry in the skill taxonomy. Aliases are matched exactly (after lowercasing) before any fuzzy matching. */
export const skill = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  category: skillCategory,
  aliases: z.array(z.string().min(1)),
});
export type Skill = z.infer<typeof skill>;
