import "server-only";
import { and, asc, count, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import {
  blocks,
  consents,
  interests,
  junctionCommentVotes,
  junctionComments,
  junctionPins,
  junctionPostInterests,
  junctionPosts,
  junctionReshares,
  junctionSaves,
  junctionVotes,
  reports,
  resources,
  userGoals,
  userSettings,
  users,
} from "@/db/schema";
import { linkKey } from "@/lib/library/links";
import { errorFields, logEvent } from "@/lib/log";
import { targetRoleSlugOf } from "@/lib/network/store";
import { notify } from "@/lib/notifications/store";
import { DEFAULT_SETTINGS } from "@/lib/schemas/account-settings";
import { JUNCTION_PINS_MAX, JUNCTION_RULES_PURPOSE, JUNCTION_RULES_VERSION, JUNCTION_TAGS_MAX } from "@/lib/schemas/constants";
import {
  commentInput,
  commentRef,
  pinInput,
  postEditInput,
  postInput,
  postRef,
  type PostData,
} from "@/lib/schemas/junction";
import { DUPLICATE_WINDOW_HOURS, HOUR_MS } from "@/lib/schemas/legal-timings";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { ensureInterests } from "./interests";
import { recordRemoval } from "./moderation";
import { countsInTop, postingProblem, withinEditWindow, type PostingProblem } from "./rules";

/*
 * Junction's writes (docs/plans/junction-plan.md sections 1, 3 and 4; FR-61). Every function takes the signed-in
 * person's user id from the caller (the session, never the browser), checks the input with Zod, refuses a suspended or
 * deleting account, and counts the try against its daily limit inside the transaction. Counts on a post change in the
 * same transaction as the vote, comment or reshare, under a row lock on the post (`for update`), so two at once can't
 * lose one. Nobody votes on, comments on or reshares a post across a block either way, or their own (except comments).
 * Logs carry event names, kinds and counts only: never a title, body, comment, tag or link.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

export type JunctionError =
  | "invalid"
  | "unavailable"
  | "limit"
  | "not_found"
  | "own"
  | "duplicate"
  | "edit_window"
  | "no_route"
  | "tags"
  | "pins_full"
  | PostingProblem;

export const JUNCTION_ERROR_TEXT: Record<JunctionError, string> = {
  invalid: "That didn't work. Check what you wrote and try again.",
  unavailable: "Junction isn't available on your account right now.",
  limit: "That's enough for today. Try again tomorrow.",
  not_found: "That post isn't there any more.",
  own: "You can't do that on your own post.",
  duplicate: "You posted this already.",
  edit_window: "Posts can be edited for 30 minutes. After that you can delete it.",
  no_route: "Add your resume to post to My route, or pick an interest instead.",
  tags: "Pick at most 3 interests, and only ones that are still listed.",
  pins_full: "You can pin 3 posts. Unpin one first.",
  no_name: "Add your name in Settings before you post.",
  new_account: "New accounts can post after their first day.",
  link_wait: "New accounts can add links after their first week.",
};

export type JunctionWrite<T = object> = ({ ok: true } & T) | { ok: false; error: JunctionError; message: string };
const fail = (error: JunctionError, message?: string): { ok: false; error: JunctionError; message: string } => ({ ok: false, error, message: message ?? JUNCTION_ERROR_TEXT[error] });

/** The first Zod message, for the composer to show under its field. */
const zodMessage = (issues: { message: string }[]) => issues[0]?.message;

type Account = { name: string | null; createdAt: Date };

/** The account, when it may use Junction now: there, not suspended and not being deleted. */
async function activeAccount(userId: string, db: Db | Tx): Promise<Account | null> {
  const [a] = await db
    .select({ name: users.name, createdAt: users.createdAt, suspendedAt: users.suspendedAt, deletionRequestedAt: users.deletionRequestedAt })
    .from(users)
    .where(eq(users.id, userId));
  return a && !a.suspendedAt && !a.deletionRequestedAt ? a : null;
}

/** True when either person blocked the other. */
export async function blockedEither(a: string, b: string, db: Db | Tx): Promise<boolean> {
  if (a === b) return false;
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(blocks)
    .where(sql`(${blocks.blockerId} = ${a} and ${blocks.blockedId} = ${b}) or (${blocks.blockerId} = ${b} and ${blocks.blockedId} = ${a})`)
    .limit(1);
  return !!row;
}

/** The post, locked, when others may act on it: visible, not deleted, its author active. */
async function lockPost(postId: string, tx: Tx) {
  const [p] = await tx
    .select({ id: junctionPosts.id, authorId: junctionPosts.authorId, status: junctionPosts.status, deletedAt: junctionPosts.deletedAt, kind: junctionPosts.kind, createdAt: junctionPosts.createdAt })
    .from(junctionPosts)
    .where(eq(junctionPosts.id, postId))
    .for("update");
  if (!p || p.deletedAt) return null;
  const author = await activeAccount(p.authorId, tx);
  return author ? p : null;
}

/* Posts ------------------------------------------------------------------------------------------------------------ */

/** The Library item a link matches, for the post's catalog card. */
async function catalogItem(url: string, tx: Tx): Promise<string | null> {
  const key = linkKey(url);
  if (!key) return null;
  const candidates = [url, url.endsWith("/") ? url.slice(0, -1) : `${url}/`];
  const rows = await tx.select({ id: resources.id, url: resources.url }).from(resources).where(and(inArray(resources.url, candidates), isNull(resources.hiddenAt)));
  return rows.find((r) => linkKey(r.url) === key)?.id ?? null;
}

/** The person's current goal for "Show where I am on my line": the first active one on their line. */
async function currentGoal(userId: string, tx: Tx): Promise<string | null> {
  const [g] = await tx.select({ id: userGoals.id }).from(userGoals).where(and(eq(userGoals.userId, userId), eq(userGoals.status, "active"))).orderBy(asc(userGoals.position)).limit(1);
  return g?.id ?? null;
}

/**
 * A new post (plan section 1). Needs an account a day old with a name (a week old for a link), one of the day's 5, not
 * the same title and body as one in the last 24 hours, and an audience: My route (the person's target role) and/or up
 * to 3 interests that are listed. The "where I am" line stores the goal's id only.
 */
export async function createPost(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite<{ postId: string }>> {
  const parsed = postInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", zodMessage(parsed.error.issues));
  const p: PostData = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite<{ postId: string }>> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`junction-post:${userId}`}))`);
    const account = await activeAccount(userId, tx);
    if (!account) return fail("unavailable");
    const problem = postingProblem(account, now, !!p.link);
    if (problem) return fail(problem);
    if (!(await takeShared(LIMITS.junctionPostsPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    const [same] = await tx
      .select({ id: junctionPosts.id })
      .from(junctionPosts)
      .where(
        and(
          eq(junctionPosts.authorId, userId),
          eq(junctionPosts.title, p.title),
          eq(junctionPosts.body, p.body),
          isNull(junctionPosts.deletedAt),
          gte(junctionPosts.createdAt, new Date(now.getTime() - DUPLICATE_WINDOW_HOURS * HOUR_MS)),
        ),
      )
      .limit(1);
    if (same) return fail("duplicate");
    const routeSlug = p.toRoute ? await targetRoleSlugOf(userId, tx) : null;
    const picked = [...new Set(p.interestIds)];
    const listed = picked.length
      ? await tx.select({ id: interests.id }).from(interests).where(and(inArray(interests.id, picked), isNull(interests.hiddenAt)))
      : [];
    if (listed.length !== picked.length) return fail("tags");
    const made = await ensureInterests(userId, p.newInterests, tx, now);
    if (!made) return fail("tags");
    const tags = [...new Set([...picked, ...made])];
    if (tags.length > JUNCTION_TAGS_MAX) return fail("tags");
    if (!routeSlug && !tags.length) return fail("no_route");
    const [post] = await tx
      .insert(junctionPosts)
      .values({
        authorId: userId,
        kind: p.kind,
        title: p.title,
        body: p.body,
        linkUrl: p.link?.url ?? null,
        linkHost: p.link?.host ?? null,
        resourceId: p.link ? await catalogItem(p.link.url, tx) : null,
        routeSlug,
        goalId: p.showGoal ? await currentGoal(userId, tx) : null,
        createdAt: now,
      })
      .returning({ id: junctionPosts.id });
    if (tags.length) await tx.insert(junctionPostInterests).values(tags.map((interestId) => ({ postId: post!.id, interestId })));
    return { ok: true, postId: post!.id };
  });
  logEvent("info", "junction_post", { outcome: out.ok ? "created" : out.error, kind: p.kind, tags: p.interestIds.length + p.newInterests.length });
  return out;
}

/** An edit, within 30 minutes of posting, of a post that isn't hidden or deleted. A Resource keeps a link. */
export async function editPost(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite> {
  const parsed = postEditInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", zodMessage(parsed.error.issues));
  const e = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite> => {
    const account = await activeAccount(userId, tx);
    if (!account) return fail("unavailable");
    const [post] = await tx
      .select({ kind: junctionPosts.kind, status: junctionPosts.status, createdAt: junctionPosts.createdAt, linkUrl: junctionPosts.linkUrl })
      .from(junctionPosts)
      .where(and(eq(junctionPosts.id, e.postId), eq(junctionPosts.authorId, userId), isNull(junctionPosts.deletedAt)))
      .for("update");
    if (!post || post.status === "hidden") return fail("not_found");
    if (!withinEditWindow(post.createdAt, now)) return fail("edit_window");
    if (post.kind === "resource" && !e.link) return fail("invalid", "A Resource post needs its link.");
    if (e.link && e.link.url !== post.linkUrl) {
      const problem = postingProblem(account, now, true);
      if (problem) return fail(problem);
    }
    await tx
      .update(junctionPosts)
      .set({
        title: e.title,
        body: e.body,
        linkUrl: e.link?.url ?? null,
        linkHost: e.link?.host ?? null,
        resourceId: e.link ? await catalogItem(e.link.url, tx) : null,
        editedAt: now,
      })
      .where(and(eq(junctionPosts.id, e.postId), eq(junctionPosts.authorId, userId)));
    return { ok: true };
  });
  logEvent("info", "junction_post_edit", { outcome: out.ok ? "edited" : out.error });
  return out;
}

/** The open reports on a post or comment, by id. */
async function openReportIds(target: "post" | "comment", targetId: string, tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.target, target), eq(reports.targetId, targetId), eq(reports.status, "open")));
  return rows.map((r) => r.id);
}

/**
 * The author's delete: the post leaves every feed at once (soft delete) and its pins go; the daily cleanup deletes it
 * 30 days later with its comments, votes, reshares, saves and tags. A post with an open report is copied into the
 * removal records first, so a complaint isn't defeated by deleting (plan section 3).
 */
export async function deletePost(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite> {
  const parsed = postRef.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { postId } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite> => {
    const [post] = await tx
      .update(junctionPosts)
      .set({ deletedAt: now })
      .where(and(eq(junctionPosts.id, postId), eq(junctionPosts.authorId, userId), isNull(junctionPosts.deletedAt)))
      .returning({ id: junctionPosts.id });
    if (!post) return fail("not_found");
    await tx.delete(junctionPins).where(eq(junctionPins.postId, postId));
    const open = await openReportIds("post", postId, tx);
    if (open.length) await recordRemoval(tx, { target: "post", targetId: postId, cause: "author_deleted_reported", rule: null, removedBy: null, reportIds: open, now });
    return { ok: true };
  });
  logEvent("info", "junction_post_delete", { outcome: out.ok ? "deleted" : out.error });
  return out;
}

/* Votes, reshares and saves ---------------------------------------------------------------------------------------- */

/** An account's created time, for whether its action counts in Top. */
async function createdAtOf(userId: string, tx: Tx): Promise<Date> {
  const [u] = await tx.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  return u!.createdAt;
}

/** Upvote a post, or take the upvote back. Not your own, not across a block. */
export async function toggleVote(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite<{ voted: boolean }>> {
  const parsed = postRef.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { postId } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite<{ voted: boolean }>> => {
    if (!(await activeAccount(userId, tx))) return fail("unavailable");
    const post = await lockPost(postId, tx);
    if (!post || post.status !== "visible" || (await blockedEither(userId, post.authorId, tx))) return fail("not_found");
    if (post.authorId === userId) return fail("own");
    if (!(await takeShared(LIMITS.junctionVotesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    const points = countsInTop(await createdAtOf(userId, tx), now) ? 1 : 0;
    const gone = await tx.delete(junctionVotes).where(and(eq(junctionVotes.userId, userId), eq(junctionVotes.postId, postId))).returning({ postId: junctionVotes.postId });
    if (gone.length) {
      await tx
        .update(junctionPosts)
        .set({ upvoteCount: sql`greatest(${junctionPosts.upvoteCount} - 1, 0)`, topPoints: sql`greatest(${junctionPosts.topPoints} - ${points}, 0)` })
        .where(eq(junctionPosts.id, postId));
      return { ok: true, voted: false };
    }
    await tx.insert(junctionVotes).values({ userId, postId, createdAt: now });
    await tx
      .update(junctionPosts)
      .set({ upvoteCount: sql`${junctionPosts.upvoteCount} + 1`, topPoints: sql`${junctionPosts.topPoints} + ${points}` })
      .where(eq(junctionPosts.id, postId));
    return { ok: true, voted: true };
  });
  logEvent("info", "junction_vote", { outcome: out.ok ? (out.voted ? "on" : "off") : out.error });
  return out;
}

/** Upvote a comment, or take it back. Not your own, not across a block with its writer or the post's author. */
export async function toggleCommentVote(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite<{ voted: boolean }>> {
  const parsed = commentRef.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { commentId } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite<{ voted: boolean }>> => {
    if (!(await activeAccount(userId, tx))) return fail("unavailable");
    const [comment] = await tx
      .select({ postId: junctionComments.postId, authorId: junctionComments.authorId, status: junctionComments.status, deletedAt: junctionComments.deletedAt })
      .from(junctionComments)
      .where(eq(junctionComments.id, commentId))
      .for("update");
    if (!comment || comment.deletedAt || comment.status !== "visible") return fail("not_found");
    const post = await lockPost(comment.postId, tx);
    if (!post || post.status !== "visible" || !(await activeAccount(comment.authorId, tx))) return fail("not_found");
    if ((await blockedEither(userId, comment.authorId, tx)) || (await blockedEither(userId, post.authorId, tx))) return fail("not_found");
    if (comment.authorId === userId) return fail("own");
    if (!(await takeShared(LIMITS.junctionVotesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    const gone = await tx
      .delete(junctionCommentVotes)
      .where(and(eq(junctionCommentVotes.userId, userId), eq(junctionCommentVotes.commentId, commentId)))
      .returning({ commentId: junctionCommentVotes.commentId });
    if (gone.length) {
      await tx.update(junctionComments).set({ upvoteCount: sql`greatest(${junctionComments.upvoteCount} - 1, 0)` }).where(eq(junctionComments.id, commentId));
      return { ok: true, voted: false };
    }
    await tx.insert(junctionCommentVotes).values({ userId, commentId, createdAt: now });
    await tx.update(junctionComments).set({ upvoteCount: sql`${junctionComments.upvoteCount} + 1` }).where(eq(junctionComments.id, commentId));
    return { ok: true, voted: true };
  });
  logEvent("info", "junction_comment_vote", { outcome: out.ok ? (out.voted ? "on" : "off") : out.error });
  return out;
}

/** Reshare a post into your connections' Following, or take it back. Not your own, not across a block. */
export async function toggleReshare(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite<{ reshared: boolean }>> {
  const parsed = postRef.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { postId } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite<{ reshared: boolean }>> => {
    if (!(await activeAccount(userId, tx))) return fail("unavailable");
    const post = await lockPost(postId, tx);
    if (!post || post.status !== "visible" || (await blockedEither(userId, post.authorId, tx))) return fail("not_found");
    if (post.authorId === userId) return fail("own");
    if (!(await takeShared(LIMITS.junctionResharesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    const points = countsInTop(await createdAtOf(userId, tx), now) ? 3 : 0;
    const gone = await tx.delete(junctionReshares).where(and(eq(junctionReshares.userId, userId), eq(junctionReshares.postId, postId))).returning({ postId: junctionReshares.postId });
    if (gone.length) {
      await tx
        .update(junctionPosts)
        .set({ reshareCount: sql`greatest(${junctionPosts.reshareCount} - 1, 0)`, topPoints: sql`greatest(${junctionPosts.topPoints} - ${points}, 0)` })
        .where(eq(junctionPosts.id, postId));
      return { ok: true, reshared: false };
    }
    await tx.insert(junctionReshares).values({ userId, postId, createdAt: now });
    await tx
      .update(junctionPosts)
      .set({ reshareCount: sql`${junctionPosts.reshareCount} + 1`, topPoints: sql`${junctionPosts.topPoints} + ${points}` })
      .where(eq(junctionPosts.id, postId));
    return { ok: true, reshared: true };
  });
  logEvent("info", "junction_reshare", { outcome: out.ok ? (out.reshared ? "on" : "off") : out.error });
  return out;
}

/** Save a post for yourself, or unsave it. Private: no count anywhere. */
export async function toggleSave(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite<{ saved: boolean }>> {
  const parsed = postRef.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { postId } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite<{ saved: boolean }>> => {
    if (!(await activeAccount(userId, tx))) return fail("unavailable");
    if (!(await takeShared(LIMITS.junctionSavesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    const gone = await tx.delete(junctionSaves).where(and(eq(junctionSaves.userId, userId), eq(junctionSaves.postId, postId))).returning({ postId: junctionSaves.postId });
    if (gone.length) return { ok: true, saved: false };
    const post = await lockPost(postId, tx);
    if (!post || (post.status !== "visible" && post.authorId !== userId) || (await blockedEither(userId, post.authorId, tx))) return fail("not_found");
    await tx.insert(junctionSaves).values({ userId, postId, createdAt: now }).onConflictDoNothing();
    return { ok: true, saved: true };
  });
  logEvent("info", "junction_save", { outcome: out.ok ? (out.saved ? "on" : "off") : out.error });
  return out;
}

/** Pin one of your own posts at a place (1 to 3; a post already there moves off), or unpin it with null. */
export async function setPin(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite> {
  const parsed = pinInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { postId, position } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`junction-pins:${userId}`}))`);
    if (!(await activeAccount(userId, tx))) return fail("unavailable");
    if (!(await takeShared(LIMITS.junctionSavesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    if (position === null) {
      await tx.delete(junctionPins).where(and(eq(junctionPins.userId, userId), eq(junctionPins.postId, postId)));
      return { ok: true };
    }
    const [own] = await tx
      .select({ id: junctionPosts.id })
      .from(junctionPosts)
      .where(and(eq(junctionPosts.id, postId), eq(junctionPosts.authorId, userId), isNull(junctionPosts.deletedAt), ne(junctionPosts.status, "hidden")));
    if (!own) return fail("not_found");
    await tx.delete(junctionPins).where(and(eq(junctionPins.userId, userId), eq(junctionPins.postId, postId)));
    await tx.delete(junctionPins).where(and(eq(junctionPins.userId, userId), eq(junctionPins.position, position)));
    const [{ n }] = await tx.select({ n: count() }).from(junctionPins).where(eq(junctionPins.userId, userId));
    if (n >= JUNCTION_PINS_MAX) return fail("pins_full");
    await tx.insert(junctionPins).values({ userId, postId, position, createdAt: now });
    return { ok: true };
  });
  logEvent("info", "junction_pin", { outcome: out.ok ? (position === null ? "off" : "on") : out.error });
  return out;
}

/* Comments --------------------------------------------------------------------------------------------------------- */

/** Whether the person already has a live comment on the post, so a second one adds nothing to Top. */
async function hasLiveComment(userId: string, postId: string, tx: Tx, except?: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: junctionComments.id })
    .from(junctionComments)
    .where(
      and(
        eq(junctionComments.postId, postId),
        eq(junctionComments.authorId, userId),
        isNull(junctionComments.deletedAt),
        except ? ne(junctionComments.id, except) : undefined,
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * A comment on a visible post (1 to 1,000 characters; the same account rules as posting, without links). The post's
 * author gets one unread notification per post however many comment.
 */
export async function addComment(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite<{ commentId: string }>> {
  const parsed = commentInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", zodMessage(parsed.error.issues));
  const c = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite<{ commentId: string }>> => {
    const account = await activeAccount(userId, tx);
    if (!account) return fail("unavailable");
    const problem = postingProblem(account, now, false);
    if (problem) return fail(problem);
    const post = await lockPost(c.postId, tx);
    if (!post || post.status !== "visible" || (await blockedEither(userId, post.authorId, tx))) return fail("not_found");
    if (!(await takeShared(LIMITS.junctionCommentsPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    const counts = post.authorId !== userId && countsInTop(account.createdAt, now) && !(await hasLiveComment(userId, c.postId, tx));
    const [row] = await tx.insert(junctionComments).values({ postId: c.postId, authorId: userId, body: c.body, createdAt: now }).returning({ id: junctionComments.id });
    await tx
      .update(junctionPosts)
      .set({ commentCount: sql`${junctionPosts.commentCount} + 1`, topPoints: sql`${junctionPosts.topPoints} + ${counts ? 2 : 0}` })
      .where(eq(junctionPosts.id, c.postId));
    await notify(tx, { kind: "junction_comment", userId: post.authorId, actorId: userId, postId: c.postId }, now);
    return { ok: true, commentId: row!.id };
  });
  logEvent("info", "junction_comment", { outcome: out.ok ? "added" : out.error });
  return out;
}

/** The comment's author deletes it: it goes at once (soft), with a removal record first when it has an open report. */
export async function deleteComment(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionWrite> {
  const parsed = commentRef.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { commentId } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<JunctionWrite> => {
    const [comment] = await tx
      .select({ postId: junctionComments.postId })
      .from(junctionComments)
      .where(and(eq(junctionComments.id, commentId), eq(junctionComments.authorId, userId), isNull(junctionComments.deletedAt)));
    if (!comment) return fail("not_found");
    const [post] = await tx.select({ authorId: junctionPosts.authorId }).from(junctionPosts).where(eq(junctionPosts.id, comment.postId)).for("update");
    if (!post) return fail("not_found");
    const [gone] = await tx
      .update(junctionComments)
      .set({ deletedAt: now })
      .where(and(eq(junctionComments.id, commentId), eq(junctionComments.authorId, userId), isNull(junctionComments.deletedAt)))
      .returning({ id: junctionComments.id });
    if (!gone) return fail("not_found");
    const counted = post.authorId !== userId && countsInTop(await createdAtOf(userId, tx), now) && !(await hasLiveComment(userId, comment.postId, tx, commentId));
    await tx
      .update(junctionPosts)
      .set({ commentCount: sql`greatest(${junctionPosts.commentCount} - 1, 0)`, topPoints: sql`greatest(${junctionPosts.topPoints} - ${counted ? 2 : 0}, 0)` })
      .where(eq(junctionPosts.id, comment.postId));
    const open = await openReportIds("comment", commentId, tx);
    if (open.length) await recordRemoval(tx, { target: "comment", targetId: commentId, cause: "author_deleted_reported", rule: null, removedBy: null, reportIds: open, now });
    return { ok: true };
  });
  logEvent("info", "junction_comment_delete", { outcome: out.ok ? "deleted" : out.error });
  return out;
}

/* The rules gate --------------------------------------------------------------------------------------------------- */

/** Whether the person must accept the Junction rules (again) before posting: never accepted, or an older version. */
export async function needsJunctionRules(userId: string, db: Pick<Db, "select"> = getDb()): Promise<boolean> {
  const [row] = await db.select({ version: userSettings.junctionRulesVersion }).from(userSettings).where(eq(userSettings.userId, userId));
  return row?.version !== JUNCTION_RULES_VERSION;
}

/** "I'll follow these rules": a consent row (the record) and the version on the person's settings. */
export async function acceptJunctionRules(userId: string, deps: Deps = {}): Promise<JunctionWrite> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(consents).values({ userId, purpose: JUNCTION_RULES_PURPOSE, policyVersion: JUNCTION_RULES_VERSION, givenAt: now });
      const { visibility, ...rest } = DEFAULT_SETTINGS;
      await tx
        .insert(userSettings)
        .values({ userId, profileVisibility: visibility, ...rest, junctionRulesVersion: JUNCTION_RULES_VERSION, updatedAt: now })
        .onConflictDoUpdate({ target: userSettings.userId, set: { junctionRulesVersion: JUNCTION_RULES_VERSION, updatedAt: now } });
    });
  } catch (error) {
    logEvent("error", "junction_rules_failed", errorFields(error));
    return fail("invalid");
  }
  logEvent("info", "junction_rules_accepted", { version: JUNCTION_RULES_VERSION });
  return { ok: true };
}
