import type { JobPost, WorkType } from "@/lib/schemas";

/** What the Departures header says under the title (prototype v44), also on the paused page while job search is off. */
export const DEPARTURES_LEDE =
  "Roles from public company job boards and posts you paste. Apply on the company's site, or with Express apply where the company takes it.";

export type DepartureTab = "all" | "saved" | "applied";

export type DepartureFilters = {
  query: string;
  city: string | null;
  /**
   * "Your places" (FR-55): only roles whose city is one of the person's "Open to work in" places (Remote matches a
   * remote role). Roles that name no city ("India") are left out. Picked when Departures opens if any place is set.
   */
  yourPlaces: boolean;
  workType: WorkType | null;
  boardingOnly: boolean;
  tab: DepartureTab;
};

export const NO_FILTERS: DepartureFilters = {
  query: "",
  city: null,
  yourPlaces: false,
  workType: null,
  boardingOnly: false,
  tab: "all",
};

const WORDS = ["Ready now", "One gap away", "Two gaps away", "Three gaps away", "Four gaps away", "Five gaps away"];

/** Readiness in words, never a score: "Ready now", "Two gaps away", or "Your destination" for the role the line is built for. */
export function readiness(job: Pick<JobPost, "gaps" | "destination">): string {
  if (job.destination && job.gaps.length > 0) return "Your destination";
  return WORDS[job.gaps.length] ?? `${job.gaps.length} gaps away`;
}

/** The filters Departures opens with: "Your places" when the person set any in Settings, else none (FR-55). */
export const startFilters = (places: readonly string[]): DepartureFilters => ({ ...NO_FILTERS, yourPlaces: places.length > 0 });

/**
 * The roles a filter shows, in the order given (the server lists newest first). Search matches role, company, city
 * and skills, every word, ignoring case. Saved and Applied are the person's own lists. A role that left its company's
 * board drops off All and stays in Saved and Applied. "Your places" keeps roles whose city is one of `places`.
 */
export function filterDepartures(
  jobs: JobPost[],
  f: DepartureFilters,
  saved: ReadonlySet<string>,
  applied: ReadonlyMap<string, number>,
  places: readonly string[] = [],
): JobPost[] {
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter((j) => {
    if (f.tab === "all" && j.closed) return false;
    if (f.tab === "saved" && !saved.has(j.id)) return false;
    if (f.tab === "applied" && !applied.has(j.id)) return false;
    if (f.yourPlaces && places.length && !places.includes(j.city)) return false;
    if (f.city && j.city !== f.city) return false;
    if (f.workType && j.workType !== f.workType) return false;
    if (f.boardingOnly && j.goalsBefore > 0) return false;
    if (words.length) {
      const hay = [j.role, j.company, j.city, ...j.have, ...j.gaps.map((g) => g.name)].join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/**
 * Why Departures shows no roles, and the next step the list offers: `places` "Show every city" (and Settings, and
 * "Clear filters" too when `clear` says a search or another filter is also on), `filtered` "Clear filters",
 * `no_roles` the paste box, `no_saved` and `no_applied` "See all roles".
 */
export type DeparturesEmpty = { kind: "places" | "filtered" | "no_roles" | "no_saved" | "no_applied"; text: string; clear?: true };

export const EMPTY_SAVED = "Nothing saved yet. Tap the bookmark on anything you want to come back to.";

/** The empty list's words for these filters. `open` counts the open roles; `places` are the person's "Open to work in". */
export function departuresEmpty(
  f: DepartureFilters,
  { open, places, saved, applied }: { open: number; places: readonly string[]; saved: number; applied: number },
): DeparturesEmpty {
  if (f.tab === "saved" && saved === 0) return { kind: "no_saved", text: EMPTY_SAVED };
  if (f.tab === "applied" && applied === 0)
    return { kind: "no_applied", text: "Nothing marked applied yet. Open a role, apply on the company's site, then tell us here to track it." };
  if (f.tab !== "all") return { kind: "filtered", text: `Nothing ${f.tab} matches these filters.` };
  if (open === 0)
    return { kind: "no_roles", text: "No roles from company job boards yet. They arrive with the next daily update. You can still paste a job post below." };
  if (f.yourPlaces && places.length > 0) {
    // T110: with a search or another filter on too, every city alone may still show nothing, so say so and offer both.
    const more = f.query.trim() !== "" || f.city !== null || f.workType !== null || f.boardingOnly;
    return more ? { kind: "places", text: "No roles in your places match these filters.", clear: true } : { kind: "places", text: "No roles in your places yet." };
  }
  return { kind: "filtered", text: "No roles match. Try another city or type, or clear the filters." };
}

/** Cities to filter by, most roles first, with Remote last. Closed roles don't add a city. */
export function citiesOf(jobs: JobPost[]): string[] {
  const count = new Map<string, number>();
  for (const j of jobs) if (!j.closed) count.set(j.city, (count.get(j.city) ?? 0) + 1);
  return [...count.entries()]
    .sort(([a, x], [b, y]) => Number(a === "Remote") - Number(b === "Remote") || y - x || a.localeCompare(b))
    .map(([c]) => c);
}

/** "SC" for "Sahyadri Fintech": the first letters of the first two words. */
export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}
