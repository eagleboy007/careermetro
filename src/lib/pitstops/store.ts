import "server-only";
import { and, arrayOverlaps, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { gapAnalyses, paths, pathSteps, profiles, resources, resumes, userGoals } from "@/db/schema";
import { skillGroupMembers } from "@/content";
import { goalsOf } from "@/lib/goals/store";
import { swappedSkill } from "@/lib/goals/not-for-me";
import { fillingSkills } from "@/lib/goals/sync";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import {
  OWN_PITSTOP_OPTIONS_MAX,
  OWN_PITSTOP_TITLE_MAX,
  OWN_PITSTOPS_MAX,
  OWN_PITSTOPS_PER_GOAL,
  ownPitstopAdd,
  ownPitstopEdit,
  ownPitstopInputError,
  type OwnPitstop,
  type OwnPitstopError,
  type OwnPitstopOption,
  type UserGoal,
} from "@/lib/schemas";

/*
 * Add a pitstop on the Map (FR-58). A pitstop of the person's own is a `path_steps` row with source "user": kind
 * "learn", the goal's skill and goal id, the name in `reason`, at most one free catalog course in `resource_ids`, no
 * hours, no practice task and never a done date. Every other reader of path steps (path, Map line, ride, match,
 * Network, goal links, the path's done carry-over) reads only source "app", so these rows never change gaps,
 * readiness, the match, the train, the ride or the estimate. They are read by goal, not by path, and move to each new
 * path the person gets, so a new upload or hours setting keeps them. The name is the person's own words: it is never
 * logged, and errors are codes.
 */

type Db = ReturnType<typeof getDb>;
export type OwnPitstopResult = { ok: true; id: string } | { ok: false; error: OwnPitstopError };

/** Own pitstops sit after every app step of a path: app positions run from 1 to the path's step count (at most 20). */
export const OWN_POSITION_BASE = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: OwnPitstopError): OwnPitstopResult => ({ ok: false, error });
const hours = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 30) / 2} h`);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const courseOf = (r: { id: string; title: string; provider: string; kind: string; minutes: number }) => ({
  id: r.id,
  title: clip(r.title.trim(), 160),
  detail: clip(`${r.provider} · ${r.kind} · ${hours(r.minutes)}`, 120),
});

/** The person's own pitstop rows, through their goals. */
const mineWhere = (userId: string) => and(eq(pathSteps.source, "user"), eq(userGoals.userId, userId));

/** A goal that is met, proved or skipped takes no new pitstops. */
const isOpen = (g: UserGoal) => !g.proved && g.status !== "met" && g.status !== "skipped";

/** The skill a goal is learning now: the swapped-to skill after "Not for me" (FR-48), else its own. */
const learning = (g: UserGoal) => swappedSkill(g, skillGroupMembers) ?? g.skillId;

/**
 * The person's own pitstops, by goal id, oldest first. A course whose link broke or an admin hid shows as none, like
 * the Map's other courses.
 */
export async function ownPitstopsByGoal(userId: string, db: Db | Tx = getDb()): Promise<Map<string, OwnPitstop[]>> {
  const rows = await db
    .select({ id: pathSteps.id, goalId: pathSteps.goalId, title: pathSteps.reason, resourceIds: pathSteps.resourceIds })
    .from(pathSteps)
    .innerJoin(userGoals, eq(userGoals.id, pathSteps.goalId))
    .where(mineWhere(userId))
    .orderBy(asc(pathSteps.position));
  const ids = [...new Set(rows.flatMap((r) => r.resourceIds.slice(0, 1)))];
  const courses = ids.length
    ? await db
        .select({ id: resources.id, title: resources.title, provider: resources.provider, kind: resources.kind, minutes: resources.minutes })
        .from(resources)
        .where(and(inArray(resources.id, ids), eq(resources.healthy, true), isNull(resources.hiddenAt)))
    : [];
  const byId = new Map(courses.filter((c) => c.title.trim()).map((c) => [c.id, courseOf(c)]));
  const out = new Map<string, OwnPitstop[]>();
  for (const r of rows) {
    if (!r.goalId) continue;
    const list = out.get(r.goalId) ?? [];
    if (list.length >= OWN_PITSTOPS_PER_GOAL) continue;
    list.push({ id: r.id, title: clip(r.title, OWN_PITSTOP_TITLE_MAX) || "Your pitstop", course: byId.get(r.resourceIds[0] ?? "") ?? null });
    out.set(r.goalId, list);
  }
  return out;
}

/**
 * The free courses offered when adding a pitstop to each open goal: the next unused catalog links for the skill it is
 * learning (handoff section 6, rule 8), so not those already on its path step or on its own pitstops. Free, live and
 * not hidden only, cheapest in time first, at most three a goal.
 */
export async function pitstopOptionsFor(
  goals: { goalId: string; skillId: string; used: readonly string[] }[],
  db: Db | Tx = getDb(),
): Promise<Map<string, OwnPitstopOption[]>> {
  const out = new Map<string, OwnPitstopOption[]>();
  const skillIds = [...new Set(goals.map((g) => g.skillId))];
  if (!skillIds.length) return out;
  const rows = await db
    .select({ id: resources.id, title: resources.title, provider: resources.provider, kind: resources.kind, minutes: resources.minutes, skillIds: resources.skillIds })
    .from(resources)
    .where(and(eq(resources.healthy, true), eq(resources.free, true), isNull(resources.hiddenAt), arrayOverlaps(resources.skillIds, skillIds)));
  const sorted = rows.filter((r) => r.title.trim()).sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id));
  for (const g of goals) {
    const used = new Set(g.used);
    out.set(
      g.goalId,
      sorted
        .filter((r) => r.skillIds.includes(g.skillId) && !used.has(r.id))
        .slice(0, OWN_PITSTOP_OPTIONS_MAX)
        .map(courseOf),
    );
  }
  return out;
}

/** The skill each goal is learning, for `pitstopOptionsFor`; null for a goal that takes no new pitstops. */
export function learningSkill(goal: UserGoal): string | null {
  return isOpen(goal) ? learning(goal) : null;
}

/** A course id checked against the catalog: free, live, not hidden, and for a skill that fills the goal. */
async function courseFits(tx: Tx, resourceId: string | null, goal: UserGoal): Promise<boolean> {
  if (!resourceId) return true;
  const [row] = await tx
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.id, resourceId),
        eq(resources.healthy, true),
        eq(resources.free, true),
        isNull(resources.hiddenAt),
        arrayOverlaps(resources.skillIds, fillingSkills(goal, skillGroupMembers)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The person's newest path, whatever its analysis: own pitstops are read by goal, so any of their paths holds them. */
async function newestPath(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: paths.id })
    .from(paths)
    .innerJoin(gapAnalyses, eq(gapAnalyses.id, paths.gapAnalysisId))
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(eq(resumes.userId, userId))
    .orderBy(desc(paths.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** One change at a time per person, each try counted against the day's changes. */
async function locked(db: Db, userId: string, now: Date, fn: (tx: Tx) => Promise<OwnPitstopResult>): Promise<OwnPitstopResult> {
  return db.transaction(async (tx): Promise<OwnPitstopResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-pitstops:${userId}`}))`);
    if (!(await takeShared(LIMITS.ownPitstopChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    return fn(tx);
  });
}

/** Adds a pitstop of the person's own to one of their open goals, at most 3 a goal and 30 in all. */
export async function addOwnPitstop(userId: string, raw: unknown, deps: { db?: Db; now?: Date } = {}): Promise<OwnPitstopResult> {
  const input = ownPitstopAdd.safeParse(raw);
  if (!input.success) return fail(ownPitstopInputError(input.error));
  const { goalId, title, resourceId } = input.data;
  return locked(deps.db ?? getDb(), userId, deps.now ?? new Date(), async (tx) => {
    const goal = (await goalsOf(userId, tx)).find((g) => g.id === goalId);
    if (!goal) return fail("not_found");
    if (!isOpen(goal)) return fail("goal_closed");
    const mine = await tx
      .select({ goalId: pathSteps.goalId, position: pathSteps.position })
      .from(pathSteps)
      .innerJoin(userGoals, eq(userGoals.id, pathSteps.goalId))
      .where(mineWhere(userId));
    if (mine.length >= OWN_PITSTOPS_MAX) return fail("max");
    if (mine.filter((m) => m.goalId === goal.id).length >= OWN_PITSTOPS_PER_GOAL) return fail("per_goal");
    if (!(await courseFits(tx, resourceId, goal))) return fail("course");
    const pathId = await newestPath(tx, userId);
    if (!pathId) return fail("no_path");
    // One number a person across all their paths, so moving them all to a new path never collides.
    const position = Math.max(OWN_POSITION_BASE, ...mine.map((m) => m.position)) + 1;
    const [row] = await tx
      .insert(pathSteps)
      .values({
        pathId,
        position,
        skillId: goal.skillId,
        reason: title,
        hours: 0,
        resourceIds: resourceId ? [resourceId] : [],
        proofTask: "",
        goalId: goal.id,
        kind: "learn",
        source: "user",
      })
      .returning({ id: pathSteps.id });
    return { ok: true as const, id: row.id };
  });
}

/** Renames one of the person's own pitstops and sets or clears its course. Someone else's id is not found. */
export async function editOwnPitstop(userId: string, stepId: string, raw: unknown, deps: { db?: Db; now?: Date } = {}): Promise<OwnPitstopResult> {
  if (!UUID.test(stepId)) return fail("not_found");
  const input = ownPitstopEdit.safeParse(raw);
  if (!input.success) return fail(ownPitstopInputError(input.error));
  const { title, resourceId } = input.data;
  return locked(deps.db ?? getDb(), userId, deps.now ?? new Date(), async (tx) => {
    const [step] = await tx
      .select({ id: pathSteps.id, goalId: pathSteps.goalId })
      .from(pathSteps)
      .innerJoin(userGoals, eq(userGoals.id, pathSteps.goalId))
      .where(and(eq(pathSteps.id, stepId), mineWhere(userId)));
    if (!step) return fail("not_found");
    const goal = (await goalsOf(userId, tx)).find((g) => g.id === step.goalId);
    if (!goal) return fail("not_found");
    if (!(await courseFits(tx, resourceId, goal))) return fail("course");
    await tx
      .update(pathSteps)
      .set({ reason: title, resourceIds: resourceId ? [resourceId] : [] })
      .where(and(eq(pathSteps.id, step.id), eq(pathSteps.source, "user")));
    return { ok: true as const, id: step.id };
  });
}

/** Removes one of the person's own pitstops. Someone else's id, or an app step, is not found. */
export async function removeOwnPitstop(userId: string, stepId: string, deps: { db?: Db; now?: Date } = {}): Promise<OwnPitstopResult> {
  if (!UUID.test(stepId)) return fail("not_found");
  return locked(deps.db ?? getDb(), userId, deps.now ?? new Date(), async (tx) => {
    const mineGoals = tx.select({ id: userGoals.id }).from(userGoals).where(eq(userGoals.userId, userId));
    const gone = await tx
      .delete(pathSteps)
      .where(and(eq(pathSteps.id, stepId), eq(pathSteps.source, "user"), inArray(pathSteps.goalId, mineGoals)))
      .returning({ id: pathSteps.id });
    return gone.length ? { ok: true as const, id: stepId } : fail("not_found");
  });
}

/**
 * Moves the person's own pitstops onto a path just built for them (the path store calls it in the same transaction),
 * so deleting an older resume, with its analyses and paths, never takes them away.
 */
export async function moveOwnPitstops(tx: Tx, userId: string, pathId: string): Promise<void> {
  const mineGoals = tx.select({ id: userGoals.id }).from(userGoals).where(eq(userGoals.userId, userId));
  await tx.update(pathSteps).set({ pathId }).where(and(eq(pathSteps.source, "user"), inArray(pathSteps.goalId, mineGoals)));
}
