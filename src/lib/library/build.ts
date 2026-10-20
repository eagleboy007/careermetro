import { certificatesFor } from "@/lib/proofs/eligible";
import { MAX_COURSES, type RideGoal } from "@/lib/ride/build";
import { libraryItem, libraryView, type LibraryGoal, type LibraryItem, type LibraryLanguage, type LibraryView, type Ride } from "@/lib/schemas";
import { clip } from "@/lib/text";

/** Resources on one goal card: the path's courses first, then the catalog's for the same skill. */
export const GOAL_RESOURCES = 6;

/** A healthy row of the resources table. */
export type CatalogRow = { id: string; title: string; url: string; provider: string; kind: string; minutes: number; free: boolean; skillIds: string[] };

export type LibraryInput = {
  /** The target role's title; null with no resume. */
  role: string | null;
  pathHref: string | null;
  /** The person's line, in goal order, proved and skipped goals included (they still take pitstop numbers). */
  goals: RideGoal[];
  /** The skill each goal learns, by goal id: its own, or the one "Not for me" swapped it to (FR-48). */
  learnSkill: ReadonlyMap<string, string>;
  catalog: CatalogRow[];
  languageByUrl: ReadonlyMap<string, LibraryLanguage>;
  skillNames: ReadonlyMap<string, string>;
  /** Every ride task id the person has ticked, on any day. */
  ticked: ReadonlySet<string>;
  /** Today's ride, for "On your ride". Null when there is none. */
  ride: Ride | null;
};

/** A catalog row as the Library shows it, or null when it can't be shown (a kind or link the schema refuses). */
function item(row: CatalogRow, input: LibraryInput): LibraryItem | null {
  const skills = [...new Set(row.skillIds.map((id) => clip(input.skillNames.get(id) ?? id, 80)))].filter(Boolean).slice(0, 12);
  const parsed = libraryItem.safeParse({
    id: row.id,
    title: clip(row.title, 160),
    provider: clip(row.provider, 60),
    kind: row.kind,
    minutes: row.minutes,
    url: row.url,
    language: input.languageByUrl.get(row.url) ?? "English",
    skills,
  });
  return parsed.success ? parsed.data : null;
}

/** Ride task ids are "<goal id>:r:<resource id>" (src/lib/ride/build.ts). */
const taskId = (goalId: string, resourceId: string) => `${goalId}:r:${resourceId}`;

/**
 * The Library for one person, in plain code (handoff 12a). One card per open goal in map order, each numbered like
 * the Map: a missing skill learns then proves, a weak or outdated one starts at proof ("Brush up"). Finished is only
 * the person's own ticks (ride tasks ticked, a learn pitstop marked done on the Path); nothing here fills a gap.
 */
export function buildLibrary(input: LibraryInput): LibraryView {
  const items = input.catalog.flatMap((r) => {
    const i = item(r, input);
    return i ? [i] : [];
  });
  const known = new Set(items.map((i) => i.id));
  const bySkill = new Map<string, CatalogRow[]>();
  for (const r of input.catalog) {
    if (!known.has(r.id)) continue;
    for (const s of r.skillIds) bySkill.set(s, [...(bySkill.get(s) ?? []), r]);
  }

  const onRide = (input.ride?.tasks ?? []).flatMap((t) => {
    const at = t.id.indexOf(":r:");
    const id = at > 0 ? t.id.slice(at + 3) : "";
    return id && known.has(id) ? [id] : [];
  });
  const rideGoalId = input.ride?.prove?.goalId ?? null;

  const finished = new Set<string>();
  const cards: LibraryGoal[] = [];
  let n = 1;
  for (const g of input.goals) {
    const learnPitstop = g.status === "missing" ? n++ : null;
    const provePitstop = n++;
    // A path course the catalog no longer lists as healthy stays out, so every id points at an item.
    const own = g.resources.map((r) => r.id).filter((id) => known.has(id));
    const courses = own.slice(0, MAX_COURSES);
    for (const id of own) if (input.ticked.has(taskId(g.goalId, id))) finished.add(id);
    // The Path's "done" tick counts as every task of the pitstop ticked.
    if (g.learnDone) for (const id of courses) finished.add(id);
    if (g.proved || g.skipped) continue;

    const skill = input.learnSkill.get(g.goalId) ?? g.skillId;
    const extras = (bySkill.get(skill) ?? [])
      .filter((r) => !own.includes(r.id))
      .sort((a, b) => Number(b.free) - Number(a.free) || a.minutes - b.minutes || a.id.localeCompare(b.id))
      .map((r) => r.id);
    const resourceIds = [...own, ...extras].slice(0, GOAL_RESOURCES);
    cards.push({
      goalId: clip(g.goalId, 60),
      skillId: g.skillId,
      name: clip(g.name, 80),
      status: g.status,
      learnPitstop,
      provePitstop,
      now: g.goalId === rideGoalId,
      // As on Today, the learn pitstop is done only when its practice is ticked too.
      learnDone: g.learnDone || (courses.length > 0 && courses.every((id) => input.ticked.has(taskId(g.goalId, id))) && input.ticked.has(`${g.goalId}:practice`)),
      resourceIds,
      certificates: certificatesFor(g.proofSkills ?? [g.skillId])
        .slice(0, 40)
        .map((c) => ({ name: clip(c.name, 120), issuer: clip(c.issuer, 80) })),
    });
  }
  return libraryView.parse({
    role: input.role ? clip(input.role, 120) : null,
    pathHref: input.pathHref,
    goals: cards,
    items,
    onRide: [...new Set(onRide)].slice(0, 3),
    finished: [...finished],
  });
}
