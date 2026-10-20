import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { userPlans } from "@/db/schema";
import { logEvent } from "@/lib/log";
import { eliteBadgeInput, eliteSwitchInput, type EliteError, type EliteResult, type PlanRow, type PlanView } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { badgeOn, ELITE_MESSAGES, isElite, planViewOf, switchedPlan } from "./rules";

/*
 * Elite, free in the beta (FR-50, docs/plans/elite-plan.md). Every Elite page and action reads `eliteOn`; nothing
 * else decides who has Elite. No billing: turning it on is free and nothing renews. Logs carry no names or ids.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

const fail = (error: EliteError): EliteResult => ({ ok: false, error });

/** The words a screen shows for a refused change. */
export const eliteMessage = (error: EliteError): string => ELITE_MESSAGES[error];

async function rowOf(userId: string, db: Db | Tx): Promise<PlanRow | null> {
  const [row] = await db.select({ eliteSince: userPlans.eliteSince, badgeShown: userPlans.badgeShown }).from(userPlans).where(eq(userPlans.userId, userId));
  return row ?? null;
}

/** The one check every Elite page and action uses. No row is Free. */
export async function eliteOn(userId: string, db: Db | Tx = getDb()): Promise<boolean> {
  return isElite(await rowOf(userId, db));
}

/** The person's plan for /elite, Settings, the avatar menu and their own profile. */
export async function planFor(userId: string, db: Db = getDb()): Promise<PlanView> {
  return planViewOf(await rowOf(userId, db));
}

/** Whether the Elite badge shows next to this person's name on their profile (only while Elite is on). */
export async function eliteBadgeFor(userId: string, db: Db = getDb()): Promise<boolean> {
  return badgeOn(await rowOf(userId, db));
}

/**
 * For an Elite action: null when the person has Elite, otherwise "Turn on Elite to use this." for the screen to show.
 * Never throws for a Free person.
 */
export async function eliteNeeded(userId: string, db: Db | Tx = getDb()): Promise<string | null> {
  return (await eliteOn(userId, db)) ? null : ELITE_MESSAGES.not_elite;
}

const lockPlan = (userId: string, tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-plan:${userId}`}))`);

/**
 * "Turn on Elite, free in the beta" (true) and "Turn off" (false). Each try counts toward the 10 changes a day, so the
 * switch can't be scripted. Turning off sets `elite_since` back to null and keeps everything the person made.
 */
export async function setElite(userId: string, raw: unknown, deps: Deps = {}): Promise<EliteResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const on = eliteSwitchInput.safeParse(raw);
  if (!on.success) return fail("invalid");
  return db.transaction(async (tx): Promise<EliteResult> => {
    await lockPlan(userId, tx);
    if (!(await takeShared(LIMITS.eliteChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    const before = await rowOf(userId, tx);
    const next = switchedPlan(before, on.data, now);
    // Turning off with no row is already Free: nothing to write.
    if (before || on.data) {
      await tx
        .insert(userPlans)
        .values({ userId, ...next, updatedAt: now })
        .onConflictDoUpdate({ target: userPlans.userId, set: { ...next, updatedAt: now } });
    }
    logEvent("info", "elite_switched", { on: on.data, changed: isElite(before) !== on.data });
    return { ok: true, plan: planViewOf(next) };
  });
}

/** "Show the Elite badge on my profile": Elite only, off by default. */
export async function setEliteBadge(userId: string, raw: unknown, deps: Deps = {}): Promise<EliteResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const shown = eliteBadgeInput.safeParse(raw);
  if (!shown.success) return fail("invalid");
  return db.transaction(async (tx): Promise<EliteResult> => {
    await lockPlan(userId, tx);
    const before = await rowOf(userId, tx);
    if (!before || !isElite(before)) return fail("not_elite");
    if (!(await takeShared(LIMITS.eliteBadgePerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    await tx.update(userPlans).set({ badgeShown: shown.data, updatedAt: now }).where(eq(userPlans.userId, userId));
    return { ok: true, plan: planViewOf({ ...before, badgeShown: shown.data }) };
  });
}

/** For "Download your data": the plan as stored, or null for someone who never turned Elite on. */
export async function exportPlan(userId: string, db: Pick<Db, "select"> = getDb()) {
  const [row] = await db
    .select({ eliteSince: userPlans.eliteSince, badgeShown: userPlans.badgeShown, updatedAt: userPlans.updatedAt })
    .from(userPlans)
    .where(eq(userPlans.userId, userId));
  return row ? { plan: row.eliteSince ? ("elite" as const) : ("free" as const), ...row } : null;
}
