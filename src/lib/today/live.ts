import "server-only";
import { and, asc, count, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { blocks, connections, userGoals, userSettings, users } from "@/db/schema";
import { roleProfiles } from "@/content";
import { postViews } from "@/lib/departures/fit";
import { logEvent } from "@/lib/log";
import { departuresBoard, fitContextFor, type DeparturesBoard } from "@/lib/departures/store";
import { goalOnCurrentLine, type CurrentAnalysis } from "@/lib/gaps/current";
import { onYourLine, type Departure, type OnYourLine } from "@/lib/schemas";
import { boardRows } from "./live-board";

/*
 * Today's live cards (v44 gap items 9 and 10, docs/plans/departures-live-plan.md): the Departures board from the daily
 * feed's open posts, and "On your line right now" from people who chose to be found. Read only. Nothing here logs:
 * names, posts and goals never reach a log.
 */

type Db = ReturnType<typeof getDb>;

const roleTitles = new Map(roleProfiles.map((r) => [r.slug, r.title]));

/**
 * The board's rows for a signed-in person: the open posts /departures lists (the newest 300), each read for fit by the
 * same matcher, grouped by role and city. Empty when fit can't be read (no confirmed resume) or no post matched a
 * library role. The caller leaves it out with job search off. Today hands in `analysis`, the `currentAnalysis` it
 * already read (null for none), and `posts`, the open posts it started reading beside the ride (docs/plans/perf-pass.md);
 * left out, each is read here. Fit is read here either way, after the ride has synced the goals it reads.
 */
export async function todayBoardFor(
  userId: string,
  now: Date,
  db: Db = getDb(),
  { analysis, posts }: { analysis?: CurrentAnalysis | null; posts?: Promise<DeparturesBoard> } = {},
): Promise<Departure[]> {
  const [board, ctx] = await Promise.all([posts ?? departuresBoard(null, { db }), fitContextFor(userId, db, analysis)]);
  if (!ctx) return [];
  const { jobs, skipped } = postViews(board.posts, ctx, now);
  if (skipped.length) logEvent("error", "today_posts_skipped", { count: skipped.length, first: skipped[0] });
  return boardRows(
    jobs,
    (slug) => roleTitles.get(slug) ?? null,
  );
}

/** Below this many people the card is hidden, so a count can't point at one person. */
export const LINE_MIN_PEOPLE = 3;
/** Faces the card shows; the rest are "+N". */
const LINE_FACES = 4;
const WEEK = 7 * 24 * 60 * 60 * 1000;

/** "AM" for "Arjun Mehta": the first letter of the first two words, letters only. */
export function lineInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => Array.from(w).find((c) => /\p{L}/u.test(c)))
    .filter((c): c is string => Boolean(c))
    .slice(0, 2)
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

/**
 * Who "On your line" may count for a viewer, in SQL over `users` and `user_settings`: another active account (not
 * suspended, not deleting, with a name) with no block either way, who turned on "Let people find me", whose profile the
 * viewer may open and whose gaps the viewer may see (handoff 12j "Who sees what"): gaps shown to everyone who can open
 * the profile on a profile open to everyone signed in, or gaps shown to connections (or more) for a connection on any
 * profile but Only you. "People on your line" profiles count only for connections, since the goal alone doesn't say
 * the two aim at the same role.
 */
function countedBy(viewerId: string): SQL {
  const connected = sql`exists (select 1 from ${connections} c where (c.user_low = ${viewerId} and c.user_high = ${users.id}) or (c.user_high = ${viewerId} and c.user_low = ${users.id}))`;
  return and(
    sql`${users.id} <> ${viewerId}`,
    isNull(users.deletionRequestedAt),
    isNull(users.suspendedAt),
    sql`${users.name} is not null and btrim(${users.name}) <> ''`,
    sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${users.id} and b.blocked_id = ${viewerId}) or (b.blocker_id = ${viewerId} and b.blocked_id = ${users.id}))`,
    eq(userSettings.peopleCanFind, true),
    sql`${userSettings.profileVisibility} <> 'only_me'`,
    sql`((${userSettings.gapsVisibleTo} = 'profile' and ${userSettings.profileVisibility} = 'signed_in') or (${userSettings.gapsVisibleTo} in ('profile', 'connections') and ${connected}))`,
  )!;
}

/**
 * "On your line right now" (handoff section 5): other people with an active goal on the skill of the viewer's current
 * goal, among those `countedBy` allows. On the first day, only people who took that goal on in the last 7 days. Null
 * below LINE_MIN_PEOPLE, and the card is hidden. Up to four initials, connections first; never a name, handle or link.
 * The tip waits for Junction.
 */
export async function onYourLineFor(
  viewerId: string,
  goal: { skillId: string; name: string },
  { firstDay = false, now = new Date(), db = getDb() }: { firstDay?: boolean; now?: Date; db?: Db } = {},
): Promise<OnYourLine | null> {
  const where = and(
    eq(userGoals.skillId, goal.skillId),
    eq(userGoals.status, "active"),
    // A goal left on someone's earlier line after a change of destination isn't on their line now.
    goalOnCurrentLine,
    firstDay ? gte(userGoals.createdAt, new Date(now.getTime() - WEEK)) : undefined,
    countedBy(viewerId),
  );
  // One goal row per person and skill (user_goals_skill), so this counts people.
  const [total] = await db
    .select({ n: count() })
    .from(userGoals)
    .innerJoin(users, eq(users.id, userGoals.userId))
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(where);
  const n = total?.n ?? 0;
  if (n < LINE_MIN_PEOPLE) return null;
  const connectedFirst = sql<number>`case when exists (select 1 from ${connections} c where (c.user_low = ${viewerId} and c.user_high = ${users.id}) or (c.user_high = ${viewerId} and c.user_low = ${users.id})) then 0 else 1 end`;
  const faces = await db
    .select({ name: users.name })
    .from(userGoals)
    .innerJoin(users, eq(users.id, userGoals.userId))
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(where)
    .orderBy(asc(connectedFirst), desc(userGoals.createdAt), asc(users.id))
    .limit(LINE_FACES);
  const initials = faces.map((f) => lineInitials(f.name ?? "")).filter((i) => i.length > 0);
  return onYourLine.parse({ goalName: goal.name.slice(0, 80), count: n, initials, tip: null });
}
