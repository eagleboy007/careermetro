import "server-only";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { gapProofs, meEducation, meRoles, stories, storyBoxes, userGoals, userInterests } from "@/db/schema";
import { skills } from "@/content";
import { currentAnalysis } from "@/lib/gaps/current";
import { getResumeForOwner } from "@/lib/resume/store";
import {
  interestInput,
  interestRemoveInput,
  meEducationInput,
  meRoleInput,
  meRowId,
  storyInput,
  type InterestExport,
  type MeEducationExport,
  type MeRoleExport,
  type StoryBox,
  type StoryExport,
} from "@/lib/schemas";
import { INTERESTS_MAX, ME_EDUCATION_MAX, ME_ROLES_MAX, STORIES_MAX, STORY_BOXES, type STORY_SOURCES } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import type { AddedRole, AddedStory, MeAdditions } from "./build";
import { interestKey, oneLine } from "./text";

/*
 * Me editing (docs/plans/me-editing-plan.md, v44 gap item 23): roles, education, stories and interests the person adds
 * on /me. Every write takes Zod-checked input, takes the user id from the caller (the session), matches edits and
 * deletes on (id, user_id) so someone else's row is not found, and counts against 100 Me edits a day inside its
 * transaction. The caps are checked under a per-person lock. Nothing here logs: story text, names and interests never
 * reach a log or analytics.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };
type Reader = Pick<Db, "select" | "selectDistinct">;

export const ME_EDIT_ERRORS = ["invalid", "limit", "not_found", "full", "on_resume", "bad_goal", "duplicate"] as const;
export type MeEditError = (typeof ME_EDIT_ERRORS)[number];
/** `message` is the schema's own words for a field ("Add the job title."), shown under it. */
export type MeEditResult = { ok: true; id?: string } | { ok: false; error: MeEditError; message?: string; field?: string };

export const ME_EDIT_MESSAGES: Record<MeEditError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many changes as we take in a day. Try again tomorrow.",
  not_found: "That isn't on your profile any more. Refresh the page to see the latest.",
  full: "That's as many as a profile holds. Delete one to add another.",
  on_resume: "That role is already on your resume.",
  bad_goal: "Pick one of your own goals, or none.",
  duplicate: "That one is already on your list.",
};

/** The caps per person (plan: 20 roles, 12 education rows, 50 stories and 30 interests). */
export const FULL_MESSAGES = {
  roles: `You can add up to ${ME_ROLES_MAX} roles. Delete one to add another.`,
  education: `You can add up to ${ME_EDUCATION_MAX}. Delete one to add another.`,
  stories: `You can keep up to ${STORIES_MAX} stories. Delete one to add another.`,
  interests: `You can list up to ${INTERESTS_MAX} interests. Remove one to add another.`,
} as const;

const skillNames: ReadonlyMap<string, string> = new Map(skills.map((s) => [s.id, s.name]));

/** The first problem Zod found, as the result the form shows. */
function refused(issues: { message: string; path: PropertyKey[] }[]): MeEditResult {
  const first = issues[0];
  return { ok: false, error: "invalid", message: first?.message, field: first?.path.length ? String(first.path[0]) : undefined };
}

/** One change on Me: counted, then run under the person's lock, all in one transaction. */
async function change(userId: string, deps: Deps, work: (tx: Tx, now: Date) => Promise<MeEditResult>): Promise<MeEditResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx): Promise<MeEditResult> => {
    if (!(await takeShared(LIMITS.meEditsPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-me:${userId}`}))`);
    return work(tx, now);
  });
}

const notFound: MeEditResult = { ok: false, error: "not_found" };

/* Roles ------------------------------------------------------------------------------------------------------------ */

/** The roles on the person's current confirmed resume, as "title|employer" keys, ignoring case and spacing. */
async function resumeRoleKeys(userId: string, db: Db): Promise<Set<string>> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return new Set();
  const resume = await getResumeForOwner(analysis.resumeId, { userId }, db);
  return new Set((resume?.profile?.roles ?? []).map((r) => roleKey(r.title, r.employer)));
}

const roleKey = (title: string, employer: string) => `${oneLine(title).toLowerCase()}|${oneLine(employer).toLowerCase()}`;

/**
 * Ticking "I work here now" on one role clears it on the others: each ends the month the new current role started,
 * or the month it started itself when that is later, so its end never comes before its start.
 */
async function endOtherCurrent(tx: Tx, userId: string, keepId: string | null, startMonth: string, now: Date) {
  const others = await tx
    .select({ id: meRoles.id, startMonth: meRoles.startMonth })
    .from(meRoles)
    .where(and(eq(meRoles.userId, userId), eq(meRoles.isCurrent, true), keepId ? ne(meRoles.id, keepId) : undefined));
  for (const o of others) {
    await tx
      .update(meRoles)
      .set({ isCurrent: false, endMonth: o.startMonth > startMonth ? o.startMonth : startMonth, updatedAt: now })
      .where(and(eq(meRoles.id, o.id), eq(meRoles.userId, userId)));
  }
}

/** "+ Add role", or Edit on an added role when `id` is given. A role already on the resume is refused. */
export async function saveMeRole(userId: string, id: string | null, raw: unknown, deps: Deps = {}): Promise<MeEditResult> {
  if (id !== null && !meRowId.safeParse(id).success) return notFound;
  const input = meRoleInput.safeParse(raw);
  if (!input.success) return refused(input.error.issues);
  const role = input.data;
  const db = deps.db ?? getDb();
  // Read before the transaction, as other stores read the line: the resume doesn't change under a Me edit.
  const onResume = await resumeRoleKeys(userId, db);
  return change(userId, deps, async (tx, now) => {
    if (onResume.has(roleKey(role.title, role.employer))) return { ok: false, error: "on_resume", message: ME_EDIT_MESSAGES.on_resume, field: "title" };
    const values = { title: role.title, employer: role.employer, startMonth: role.startMonth, endMonth: role.isCurrent ? null : role.endMonth, isCurrent: role.isCurrent, updatedAt: now };
    if (id === null) {
      const [{ n }] = await tx.select({ n: count() }).from(meRoles).where(eq(meRoles.userId, userId));
      if (n >= ME_ROLES_MAX) return { ok: false, error: "full", message: FULL_MESSAGES.roles };
      if (role.isCurrent) await endOtherCurrent(tx, userId, null, role.startMonth, now);
      const [row] = await tx.insert(meRoles).values({ userId, ...values, createdAt: now }).returning({ id: meRoles.id });
      return { ok: true, id: row.id };
    }
    const [own] = await tx.select({ id: meRoles.id }).from(meRoles).where(and(eq(meRoles.id, id), eq(meRoles.userId, userId))).limit(1);
    if (!own) return notFound;
    if (role.isCurrent) await endOtherCurrent(tx, userId, id, role.startMonth, now);
    await tx.update(meRoles).set(values).where(and(eq(meRoles.id, id), eq(meRoles.userId, userId)));
    return { ok: true, id };
  });
}

export async function deleteMeRole(userId: string, id: string, deps: Deps = {}): Promise<MeEditResult> {
  if (!meRowId.safeParse(id).success) return notFound;
  return change(userId, deps, async (tx) => {
    const gone = await tx.delete(meRoles).where(and(eq(meRoles.id, id), eq(meRoles.userId, userId))).returning({ id: meRoles.id });
    return gone.length ? { ok: true } : notFound;
  });
}

/* Education -------------------------------------------------------------------------------------------------------- */

/** "+ Add" under Education, or Edit on an added row when `id` is given. */
export async function saveMeEducation(userId: string, id: string | null, raw: unknown, deps: Deps = {}): Promise<MeEditResult> {
  if (id !== null && !meRowId.safeParse(id).success) return notFound;
  const input = meEducationInput.safeParse(raw);
  if (!input.success) return refused(input.error.issues);
  const values = { ...input.data };
  return change(userId, deps, async (tx, now) => {
    if (id === null) {
      const [{ n }] = await tx.select({ n: count() }).from(meEducation).where(eq(meEducation.userId, userId));
      if (n >= ME_EDUCATION_MAX) return { ok: false, error: "full", message: FULL_MESSAGES.education };
      const [row] = await tx.insert(meEducation).values({ userId, ...values, createdAt: now, updatedAt: now }).returning({ id: meEducation.id });
      return { ok: true, id: row.id };
    }
    const done = await tx
      .update(meEducation)
      .set({ ...values, updatedAt: now })
      .where(and(eq(meEducation.id, id), eq(meEducation.userId, userId)))
      .returning({ id: meEducation.id });
    return done.length ? { ok: true, id } : notFound;
  });
}

export async function deleteMeEducation(userId: string, id: string, deps: Deps = {}): Promise<MeEditResult> {
  if (!meRowId.safeParse(id).success) return notFound;
  return change(userId, deps, async (tx) => {
    const gone = await tx.delete(meEducation).where(and(eq(meEducation.id, id), eq(meEducation.userId, userId))).returning({ id: meEducation.id });
    return gone.length ? { ok: true } : notFound;
  });
}

/* Stories ---------------------------------------------------------------------------------------------------------- */

/** "+ Add story", or Edit when `id` is given. The goal, when given, must be one of the person's own. */
export async function saveStory(userId: string, id: string | null, raw: unknown, deps: Deps = {}): Promise<MeEditResult> {
  if (id !== null && !meRowId.safeParse(id).success) return notFound;
  const input = storyInput.safeParse(raw);
  if (!input.success) return refused(input.error.issues);
  const { boxes, where, goalId, ...parts } = input.data;
  return change(userId, deps, async (tx, now) => {
    if (goalId !== null) {
      const [goal] = await tx.select({ id: userGoals.id }).from(userGoals).where(and(eq(userGoals.id, goalId), eq(userGoals.userId, userId))).limit(1);
      if (!goal) return { ok: false, error: "bad_goal", message: ME_EDIT_MESSAGES.bad_goal, field: "goalId" };
    }
    const values = { ...parts, whereText: where, goalId, updatedAt: now };
    let storyId: string;
    if (id === null) {
      const [{ n }] = await tx.select({ n: count() }).from(stories).where(eq(stories.userId, userId));
      if (n >= STORIES_MAX) return { ok: false, error: "full", message: FULL_MESSAGES.stories };
      const [row] = await tx.insert(stories).values({ userId, ...values, source: "user", createdAt: now }).returning({ id: stories.id });
      storyId = row.id;
    } else {
      const done = await tx.update(stories).set(values).where(and(eq(stories.id, id), eq(stories.userId, userId))).returning({ id: stories.id });
      if (!done.length) return notFound;
      storyId = id;
      await tx.delete(storyBoxes).where(eq(storyBoxes.storyId, storyId));
    }
    await tx.insert(storyBoxes).values(boxes.map((box) => ({ storyId, box })));
    return { ok: true, id: storyId };
  });
}

export async function deleteStory(userId: string, id: string, deps: Deps = {}): Promise<MeEditResult> {
  if (!meRowId.safeParse(id).success) return notFound;
  return change(userId, deps, async (tx) => {
    const gone = await tx.delete(stories).where(and(eq(stories.id, id), eq(stories.userId, userId))).returning({ id: stories.id });
    return gone.length ? { ok: true } : notFound;
  });
}

/* Interests -------------------------------------------------------------------------------------------------------- */

/** Interests' "Add": one per key, so "Photography" and " photography " are one. */
export async function addInterest(userId: string, raw: unknown, deps: Deps = {}): Promise<MeEditResult> {
  const input = interestInput.safeParse(raw);
  if (!input.success) return refused(input.error.issues);
  const { name } = input.data;
  const nameKey = interestKey(name);
  return change(userId, deps, async (tx, now) => {
    const [{ n }] = await tx.select({ n: count() }).from(userInterests).where(eq(userInterests.userId, userId));
    if (n >= INTERESTS_MAX) return { ok: false, error: "full", message: FULL_MESSAGES.interests };
    const added = await tx.insert(userInterests).values({ userId, name, nameKey, createdAt: now }).onConflictDoNothing().returning({ key: userInterests.nameKey });
    return added.length ? { ok: true } : { ok: false, error: "duplicate", message: ME_EDIT_MESSAGES.duplicate, field: "name" };
  });
}

/** An interest chip's remove ×, by the name shown. Removing one that is already gone is fine. */
export async function removeInterest(userId: string, raw: unknown, deps: Deps = {}): Promise<MeEditResult> {
  const input = interestRemoveInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  return change(userId, deps, async (tx) => {
    await tx.delete(userInterests).where(and(eq(userInterests.userId, userId), eq(userInterests.nameKey, input.data.name)));
    return { ok: true };
  });
}

/* Reading ---------------------------------------------------------------------------------------------------------- */

/** The person's added roles, newest start first. Also read by the work-email check (FR-47). */
export async function addedRolesOf(userId: string, db: Pick<Db, "select"> = getDb()): Promise<AddedRole[]> {
  return db
    .select({ id: meRoles.id, title: meRoles.title, employer: meRoles.employer, startMonth: meRoles.startMonth, endMonth: meRoles.endMonth, isCurrent: meRoles.isCurrent })
    .from(meRoles)
    .where(eq(meRoles.userId, userId))
    .orderBy(desc(meRoles.startMonth), asc(meRoles.createdAt));
}

/** The person's interests as typed, oldest first. */
export async function interestsOf(userId: string, db: Pick<Db, "select"> = getDb()): Promise<string[]> {
  const rows = await db.select({ name: userInterests.name }).from(userInterests).where(eq(userInterests.userId, userId)).orderBy(asc(userInterests.createdAt), asc(userInterests.nameKey));
  return rows.map((r) => r.name);
}

/** The person's stories, newest edit first, with their boxes, linked goal and whether that goal's skill has accepted work proof. */
async function storiesOf(userId: string, db: Reader): Promise<AddedStory[]> {
  const rows = await db
    .select({
      id: stories.id,
      title: stories.title,
      where: stories.whereText,
      situation: stories.situation,
      task: stories.task,
      action: stories.action,
      result: stories.result,
      goalId: stories.goalId,
      skillId: userGoals.skillId,
      swappedTo: userGoals.swappedTo,
    })
    .from(stories)
    .leftJoin(userGoals, and(eq(userGoals.id, stories.goalId), eq(userGoals.userId, stories.userId)))
    .where(eq(stories.userId, userId))
    .orderBy(desc(stories.updatedAt), asc(stories.id));
  if (!rows.length) return [];
  const goalSkills = [...new Set(rows.flatMap((r) => (r.skillId ? [r.swappedTo ?? r.skillId] : [])))];
  const [boxes, proved] = await Promise.all([
    db
      .select({ storyId: storyBoxes.storyId, box: storyBoxes.box })
      .from(storyBoxes)
      .where(
        inArray(
          storyBoxes.storyId,
          rows.map((r) => r.id),
        ),
      ),
    goalSkills.length
      ? db
          .selectDistinct({ skillId: gapProofs.skillId })
          .from(gapProofs)
          .where(and(eq(gapProofs.userId, userId), eq(gapProofs.type, "work"), eq(gapProofs.status, "accepted"), inArray(gapProofs.skillId, goalSkills)))
      : Promise.resolve([] as { skillId: string }[]),
  ]);
  const confirmed = new Set(proved.map((p) => p.skillId));
  return rows.map((r) => {
    const mine = new Set(boxes.filter((b) => b.storyId === r.id).map((b) => b.box));
    const skill = r.skillId ? (r.swappedTo ?? r.skillId) : null;
    return {
      id: r.id,
      title: r.title,
      where: r.where,
      situation: r.situation,
      task: r.task,
      action: r.action,
      result: r.result,
      boxes: STORY_BOXES.filter((b) => mine.has(b)) as StoryBox[],
      goalId: r.skillId ? r.goalId : null,
      confirmed: skill !== null && confirmed.has(skill),
    };
  });
}

/** Everything the person added on Me, for their profile and the public one (which cuts it to their switches). */
export async function meAdditionsFor(userId: string, db: Reader = getDb()): Promise<MeAdditions> {
  const [roles, education, storyRows, interests] = await Promise.all([
    addedRolesOf(userId, db),
    db
      .select({ id: meEducation.id, qualification: meEducation.qualification, institution: meEducation.institution, year: meEducation.year })
      .from(meEducation)
      .where(eq(meEducation.userId, userId))
      .orderBy(asc(meEducation.createdAt), asc(meEducation.id)),
    storiesOf(userId, db),
    interestsOf(userId, db),
  ]);
  return { roles, education, stories: storyRows, interests };
}

/** "From a goal" on the story form: the person's goals by skill name, in map order. */
export async function storyGoalOptions(userId: string, db: Pick<Db, "select"> = getDb()): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: userGoals.id, skillId: userGoals.skillId, swappedTo: userGoals.swappedTo })
    .from(userGoals)
    .where(eq(userGoals.userId, userId))
    .orderBy(asc(userGoals.position), asc(userGoals.id));
  return rows.map((r) => ({ id: r.id, name: skillNames.get(r.swappedTo ?? r.skillId) ?? r.skillId }));
}

/** Download your data (export v28): what the person added on Me, with each story's boxes and its goal's skill by name. */
export async function exportMeEdits(
  userId: string,
  db: Pick<Db, "select"> = getDb(),
): Promise<{ meRoles: MeRoleExport[]; meEducation: MeEducationExport[]; stories: StoryExport[]; interests: InterestExport[] }> {
  const [roles, education, storyRows, boxes, interests] = await Promise.all([
    db.select().from(meRoles).where(eq(meRoles.userId, userId)).orderBy(asc(meRoles.createdAt), asc(meRoles.id)),
    db.select().from(meEducation).where(eq(meEducation.userId, userId)).orderBy(asc(meEducation.createdAt), asc(meEducation.id)),
    db
      .select({ story: stories, skillId: userGoals.skillId, swappedTo: userGoals.swappedTo })
      .from(stories)
      .leftJoin(userGoals, eq(userGoals.id, stories.goalId))
      .where(eq(stories.userId, userId))
      .orderBy(asc(stories.createdAt), asc(stories.id)),
    db
      .select({ storyId: storyBoxes.storyId, box: storyBoxes.box })
      .from(storyBoxes)
      .innerJoin(stories, eq(stories.id, storyBoxes.storyId))
      .where(eq(stories.userId, userId)),
    db.select().from(userInterests).where(eq(userInterests.userId, userId)).orderBy(asc(userInterests.createdAt), asc(userInterests.nameKey)),
  ]);
  return {
    meRoles: roles.map((r) => ({
      title: r.title,
      employer: r.employer,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      isCurrent: r.isCurrent,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    })),
    meEducation: education.map((e) => ({
      qualification: e.qualification,
      institution: e.institution,
      year: e.year,
      created_at: e.createdAt.toISOString(),
      updated_at: e.updatedAt.toISOString(),
    })),
    stories: storyRows.map(({ story: s, skillId, swappedTo }) => {
      const mine = new Set(boxes.filter((b) => b.storyId === s.id).map((b) => b.box));
      const skill = skillId ? (swappedTo ?? skillId) : null;
      return {
        title: s.title,
        where: s.whereText,
        situation: s.situation,
        task: s.task,
        action: s.action,
        result: s.result,
        boxes: STORY_BOXES.filter((b) => mine.has(b)) as StoryBox[],
        goalSkill: skill ? (skillNames.get(skill) ?? skill) : null,
        source: s.source as (typeof STORY_SOURCES)[number],
        created_at: s.createdAt.toISOString(),
        updated_at: s.updatedAt.toISOString(),
      };
    }),
    interests: interests.map((i) => ({ name: i.name, created_at: i.createdAt.toISOString() })),
  };
}
