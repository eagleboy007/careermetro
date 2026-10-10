import type { JobPost, WorkType } from "@/lib/schemas";

export type DepartureTab = "all" | "saved" | "applied";

export type DepartureFilters = {
  query: string;
  city: string | null;
  workType: WorkType | null;
  boardingOnly: boolean;
  tab: DepartureTab;
};

export const NO_FILTERS: DepartureFilters = {
  query: "",
  city: null,
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

/**
 * The roles a filter shows, in the order given (the server lists newest first). Search matches role, company, city
 * and skills, every word, ignoring case. Saved and Applied are the person's own lists.
 */
export function filterDepartures(jobs: JobPost[], f: DepartureFilters, saved: ReadonlySet<string>, applied: ReadonlyMap<string, number>): JobPost[] {
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter((j) => {
    if (f.tab === "saved" && !saved.has(j.id)) return false;
    if (f.tab === "applied" && !applied.has(j.id)) return false;
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

/** Cities to filter by, most roles first, with Remote last. */
export function citiesOf(jobs: JobPost[]): string[] {
  const count = new Map<string, number>();
  for (const j of jobs) count.set(j.city, (count.get(j.city) ?? 0) + 1);
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
