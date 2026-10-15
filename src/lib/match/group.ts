import type { MatchHours, MatchRole } from "@/lib/schemas";
import { DEFAULT_MATCH_HOURS, MATCH_HOURS, MATCH_MAX_WEEKS } from "@/lib/schemas/constants";

/*
 * The browser half of Match: the hours select regroups the roles without a round trip. Constants and types only, so
 * Zod and the role profiles stay on the server (src/lib/client-bundle.test.ts).
 */

export type MatchGroups = {
  /** Every required skill met or proved. */
  ready: MatchRole[];
  /** Roles with goals still open, at most MATCH_MAX_WEEKS away, nearest first. */
  soon: { role: MatchRole; weeks: number }[];
  /** The largest number of weeks in `soon`, for the heading; null when it is empty. */
  within: number | null;
};

/** Path hours over hours a week, rounded up. At least a week while any goal is open, since only proof fills it. */
export const weeksAway = (hours: number, weeklyHours: number) => Math.max(1, Math.ceil(hours / weeklyHours));

/** Handoff 12i: Ready now, then Within N weeks sorted by weeks. Roles more than 26 weeks away stay off. */
export function groupMatches(roles: MatchRole[], weeklyHours: number): MatchGroups {
  const ready = roles
    .filter((r) => r.open.length === 0)
    .sort((a, b) => Number(b.onLine) - Number(a.onLine) || a.title.localeCompare(b.title));
  const soon = roles
    .filter((r) => r.open.length > 0)
    .map((role) => ({ role, weeks: weeksAway(role.hours, weeklyHours) }))
    .filter((s) => s.weeks <= MATCH_MAX_WEEKS)
    .sort((a, b) => a.weeks - b.weeks || Number(b.role.onLine) - Number(a.role.onLine) || a.role.hours - b.role.hours || a.role.title.localeCompare(b.role.title));
  return { ready, soon, within: soon.length ? soon[soon.length - 1].weeks : null };
}

/**
 * Where the select starts: the person's own hours a week (the ride setting on Today, 3, 5, 8 or 10) to the nearest of
 * Match's 3, 6 or 10, a tie going to the fewer hours so weeks are never promised too soon. 6 without one.
 */
export function matchHoursFor(saved: number | null | undefined): MatchHours {
  if (saved === null || saved === undefined || !Number.isFinite(saved)) return DEFAULT_MATCH_HOURS;
  return MATCH_HOURS.reduce<MatchHours>((best, h) => (Math.abs(h - saved) < Math.abs(best - saved) ? h : best), MATCH_HOURS[0]);
}
