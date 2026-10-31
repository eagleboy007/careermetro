import { cutText } from "@/lib/cut-text";
import type { PitstopRiders } from "@/lib/schemas";

/*
 * On your line (C13, docs/plans/on-your-line-plan.md): the words for a pitstop's people, in the Map's side panel only.
 * Plain code, no database, so /design and the tests use it too.
 */

/** "Asha K." for "Asha Kulkarni": the first word and the first letter of the last one; a one-word name as it is. */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return cutText(words[0] ?? "", 40);
  const initial = Array.from(words[words.length - 1]).find((c) => /\p{L}/u.test(c));
  return initial ? `${cutText(words[0], 40)} ${initial.toUpperCase()}.` : cutText(words[0], 40);
}

/** "14 people on this pitstop". The server never sends fewer than 3. */
export const ridersCount = (r: Pick<PitstopRiders, "count">) => `${r.count} people on this pitstop`;

/** "and 2 more connections" after the names, or null when every named connection is shown. */
export const ridersMore = (r: Pick<PitstopRiders, "more">) => (r.more > 0 ? `and ${r.more} more ${r.more === 1 ? "connection" : "connections"}` : null);

/** The riders for one skill, or undefined when fewer than 3 people (or none) show there. */
export const ridersAt = (riders: readonly PitstopRiders[] | undefined, skillId: string) => riders?.find((r) => r.skillId === skillId);
