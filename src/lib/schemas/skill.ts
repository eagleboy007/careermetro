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
  "security",
]);

/** One entry in the skill taxonomy. Aliases are matched exactly (after lowercasing) before any fuzzy matching. */
export const skill = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  category: skillCategory,
  aliases: z.array(z.string().min(1)),
  /**
   * Names or aliases that are also ordinary words or names ("react", "spring", "containers", "Apollo").
   * The matcher never looks for them in free text; they count only when the parser lists the skill.
   */
  ambiguous: z.array(z.string().min(1)).default([]),
  /** Broader skills that evidence of this one also shows: pivot tables show Excel, pandas shows Python. */
  implies: z.array(z.string()).default([]),
});
export type Skill = z.infer<typeof skill>;
