import { skills } from "@/content";

const impliesById = new Map(skills.map((s) => [s.id, s.implies]));

/** Whether one skill implies another, directly or through a chain (pivot tables → Excel). */
export const implies = (from: string, to: string, seen = new Set<string>()): boolean =>
  (impliesById.get(from) ?? []).some((id) => id === to || (!seen.has(id) && (seen.add(id), implies(id, to, seen))));

/**
 * Shared skills counted as separate abilities: one that another shared skill implies isn't counted again, so Excel and
 * pivot tables are one (business batch B1). Used wherever a count of shared skills decides whether a role is offered.
 */
export const countAbilities = (ids: readonly string[]): number =>
  ids.filter((id) => !ids.some((other) => other !== id && implies(other, id))).length;
