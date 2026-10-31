import "server-only";
import { and, asc, count, eq, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { blocks, connections, userGoals, userSettings, users } from "@/db/schema";
import { goalOnCurrentLine } from "@/lib/gaps/current";
import { DEFAULT_SETTINGS, DEFAULT_SHOW_ON_MAP, MAX_GAPS, pitstopRidersList, showOnMapInput, type PitstopRiders } from "@/lib/schemas";
import { PITSTOP_MIN_PEOPLE, PITSTOP_NAMES_SHOWN } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { shortName } from "./riders-text";

/*
 * On your line (C13, docs/plans/on-your-line-plan.md, section 10 decisions of 2026-10-31): "Show my pitstop on the map"
 * and the people on a viewer's pitstops. A pitstop is any active goal on the skill, on the person's current line (a goal
 * left on an earlier line after a change of destination doesn't count). Only people who turned the switch on are ever
 * counted, never anyone else, not even anonymously; the count shows at PITSTOP_MIN_PEOPLE or more. Names are the
 * viewer's own connections only. Read fresh on every Map load (no cache), so off takes the person out at once.
 *
 * Never read by company code, public profiles, email or Today's board: a test checks that nothing under corporate
 * imports this file or names the column. Nothing here logs: names, skills and counts never reach a log.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

export const MAP_SHARE_ERRORS = ["invalid", "limit"] as const;
export type MapShareError = (typeof MAP_SHARE_ERRORS)[number];
export type MapShareResult = { ok: true; on: boolean } | { ok: false; error: MapShareError };

export const MAP_SHARE_MESSAGES: Record<MapShareError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many changes as we allow in a day. Try again tomorrow.",
};

/** The person's own switch; off with no row. */
export async function showOnMapFor(userId: string, db: Db | Tx = getDb()): Promise<boolean> {
  const [row] = await db.select({ on: userSettings.showOnMap }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return row?.on ?? DEFAULT_SHOW_ON_MAP;
}

/**
 * "Show my pitstop on the map" on (true) or off (false), from Settings > Privacy or Me. Writes the person's own row
 * only, under a per-person lock, counting the try against the day's 20 changes. A first save makes the settings row
 * with a new user's other defaults (DEFAULT_SETTINGS), as the job search switch does.
 */
export async function setShowOnMap(userId: string, raw: unknown, deps: Deps = {}): Promise<MapShareResult> {
  const parsed = showOnMapInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const on = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx): Promise<MapShareResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-map-share:${userId}`}))`);
    if (!(await takeShared(LIMITS.mapShareChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    const { visibility, ...rest } = DEFAULT_SETTINGS;
    const [row] = await tx
      .insert(userSettings)
      .values({ userId, profileVisibility: visibility, ...rest, showOnMap: on, updatedAt: now })
      .onConflictDoUpdate({ target: userSettings.userId, set: { showOnMap: on, updatedAt: now } })
      .returning({ on: userSettings.showOnMap });
    return { ok: true, on: row?.on ?? on };
  });
}

const connectedTo = (viewerId: string): SQL =>
  sql`exists (select 1 from ${connections} c where (c.user_low = ${viewerId} and c.user_high = ${users.id}) or (c.user_high = ${viewerId} and c.user_low = ${users.id}))`;

/**
 * Who is counted on viewer V's pitstops, in SQL over `user_goals`, `users` and `user_settings` (plan section 2): another
 * person with an active goal on one of the skills, on their current line, who turned the switch on, isn't deleting or
 * suspended, has a name, and has no block either way with V.
 */
function countedOn(viewerId: string, skillIds: string[]): SQL {
  return and(
    inArray(userGoals.skillId, skillIds),
    eq(userGoals.status, "active"),
    goalOnCurrentLine,
    eq(userSettings.showOnMap, true),
    sql`${users.id} <> ${viewerId}`,
    isNull(users.deletionRequestedAt),
    isNull(users.suspendedAt),
    sql`${users.name} is not null and btrim(${users.name}) <> ''`,
    sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${users.id} and b.blocked_id = ${viewerId}) or (b.blocker_id = ${viewerId} and b.blocked_id = ${users.id}))`,
  )!;
}

/**
 * The people on each of the viewer's pitstops (`skillIds`, their line's goals), for the Map's side panel: one entry per
 * skill with PITSTOP_MIN_PEOPLE or more counted, none below. Names only for the viewer's connections whose profile
 * isn't "Only you" and whose gaps don't show to "Nobody" (a pitstop shows a gap), first PITSTOP_NAMES_SHOWN by name
 * and how many more; each with their username for /u/<handle> (a connection may open any profile but Only you).
 */
export async function pitstopRidersFor(viewerId: string, skillIds: readonly string[], db: Db = getDb()): Promise<PitstopRiders[]> {
  const skills = [...new Set(skillIds)].slice(0, MAX_GAPS);
  if (!skills.length) return [];
  // One goal row per person and skill (user_goals_skill), so this counts people.
  const totals = await db
    .select({ skillId: userGoals.skillId, n: count() })
    .from(userGoals)
    .innerJoin(users, eq(users.id, userGoals.userId))
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(countedOn(viewerId, skills))
    .groupBy(userGoals.skillId);
  const shown = totals.filter((t) => t.n >= PITSTOP_MIN_PEOPLE);
  if (!shown.length) return [];

  const named = db
    .select({
      skillId: sql<string>`${userGoals.skillId}`.as("skill_id"),
      name: sql<string>`${users.name}`.as("name"),
      handle: sql<string | null>`${users.username}`.as("handle"),
      rank: sql<number>`row_number() over (partition by ${userGoals.skillId} order by lower(${users.name}), ${users.id})`.as("rank"),
      total: sql<number>`count(*) over (partition by ${userGoals.skillId})`.as("total"),
    })
    .from(userGoals)
    .innerJoin(users, eq(users.id, userGoals.userId))
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(
      and(
        countedOn(
          viewerId,
          shown.map((t) => t.skillId),
        ),
        connectedTo(viewerId),
        sql`${userSettings.profileVisibility} <> 'only_me'`,
        sql`${userSettings.gapsVisibleTo} <> 'nobody'`,
      ),
    )
    .as("named");
  const rows = await db.select().from(named).where(lte(named.rank, PITSTOP_NAMES_SHOWN)).orderBy(asc(named.skillId), asc(named.rank));

  return pitstopRidersList.parse(
    shown
      .sort((a, b) => skills.indexOf(a.skillId) - skills.indexOf(b.skillId))
      .map((t) => {
        const mine = rows.filter((r) => r.skillId === t.skillId);
        const total = Number(mine[0]?.total ?? 0);
        return {
          skillId: t.skillId,
          count: t.n,
          names: mine.map((r) => ({ name: shortName(r.name).slice(0, 80) || "A connection", handle: r.handle })),
          more: Math.max(0, total - mine.length),
        };
      }),
  );
}
