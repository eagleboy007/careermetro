import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { resources, rideDays } from "@/db/schema";
import { resources as catalog, roleProfiles, skillGroupMembers, skills } from "@/content";
import { swappedSkill } from "@/lib/goals/not-for-me";
import { goalsOf } from "@/lib/goals/store";
import { buildRide } from "@/lib/ride/build";
import { indiaDay } from "@/lib/ride/days";
import { rideGoalsFor } from "@/lib/ride/store";
import type { LibraryLanguage, LibraryView } from "@/lib/schemas";
import { buildLibrary } from "./build";

type Db = ReturnType<typeof getDb>;

const skillNames: ReadonlyMap<string, string> = new Map(skills.map((s) => [s.id, s.name]));
/** The language each catalog link is taught in. The table has no column for it, so it comes from the catalog file. */
const languageByUrl: ReadonlyMap<string, LibraryLanguage> = new Map(catalog.flatMap((r) => (r.language ? [[r.url, r.language] as const] : [])));

/** The healthy catalog, as the path builder reads it: only links the link check hasn't marked broken. Read only. */
async function healthyCatalog(db: Db) {
  return db
    .select({
      id: resources.id,
      title: resources.title,
      url: resources.url,
      provider: resources.provider,
      kind: resources.kind,
      minutes: resources.minutes,
      free: resources.free,
      skillIds: resources.skillIds,
    })
    .from(resources)
    .where(and(eq(resources.healthy, true), eq(resources.free, true)))
    .orderBy(asc(resources.title), asc(resources.id));
}

/**
 * The signed-in person's Library (FR-51, handoff 12a), read only: their open goals in map order with the path's
 * courses and more free ones from the catalog, the courses on today's ride, and what they ticked themselves (ride
 * tasks, or a learn pitstop marked done on the Path). With no current analysis it is the catalog alone, for search.
 * Nothing here writes: goals are synced the same way Today and the Map sync them.
 */
export async function libraryFor(userId: string, now = new Date(), db: Db = getDb()): Promise<LibraryView> {
  const [line, rows, days] = await Promise.all([
    rideGoalsFor(userId, db),
    healthyCatalog(db),
    db.select({ day: rideDays.day, taskIds: rideDays.taskIds }).from(rideDays).where(eq(rideDays.userId, userId)),
  ]);
  const today = indiaDay(now);
  const ticked = new Set(days.flatMap((d) => d.taskIds));
  if (!line) {
    return buildLibrary({ role: null, pathHref: null, goals: [], learnSkill: new Map(), catalog: rows, languageByUrl, skillNames, ticked, ride: null });
  }
  const own = await goalsOf(userId, db);
  const learnSkill = new Map(own.map((g) => [g.id, swappedSkill(g, skillGroupMembers) ?? g.skillId]));
  const ride = buildRide({
    goals: line.goals,
    path: line.path,
    doneBefore: new Set(days.filter((d) => d.day < today).flatMap((d) => d.taskIds)),
    doneToday: new Set(days.find((d) => d.day === today)?.taskIds ?? []),
    doneThisWeek: new Set(),
  });
  const role = roleProfiles.find((r) => r.slug === line.result.roleSlug);
  return buildLibrary({
    role: role?.title ?? line.result.roleSlug,
    pathHref: line.path.href,
    goals: line.goals,
    learnSkill,
    catalog: rows,
    languageByUrl,
    skillNames,
    ticked,
    ride,
  });
}
