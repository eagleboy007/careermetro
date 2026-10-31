import type { JunctionStatus } from "@/lib/schemas/constants";
import {
  APPEAL_DECIDE_DAYS,
  APPEAL_WITHIN_DAYS,
  AUTO_HOLD_REPORTER_DAYS,
  AUTO_HOLD_REPORTS,
  COUNTS_MIN_ACCOUNT_HOURS,
  DAY_MS,
  EDIT_WINDOW_MINUTES,
  HOUR_MS,
  NEW_ACCOUNT_LINK_WAIT_DAYS,
  NEW_ACCOUNT_POST_WAIT_HOURS,
  REMOVAL_KEEP_DAYS,
} from "@/lib/legal-timings";

/*
 * Junction's pure rules (docs/plans/junction-plan.md sections 2 and 3): who may see a post, the Top points, the edit
 * window, who may post and add links, the auto-hold, the report reference, the appeal window and the feed cursor. No
 * database and no Zod, so the stores, the screens and the tests share one copy. Nothing here logs.
 */

/* Top -------------------------------------------------------------------------------------------------------------- */

/** top_points = upvotes + 2 × comments + 3 × reshares, each counted only from people other than the author. */
export const topPoints = (c: { upvotes: number; commenters: number; reshares: number }): number => c.upvotes + 2 * c.commenters + 3 * c.reshares;

/** Someone whose action may count towards Top: not the author, and an account at least a day old that isn't going. */
export type Actor = { userId: string; accountCreatedAt: Date; deleting?: boolean };

/** Whether an account is old enough for its votes, comments and reshares to count in Top. */
export const countsInTop = (accountCreatedAt: Date, now: Date): boolean => now.getTime() - accountCreatedAt.getTime() >= COUNTS_MIN_ACCOUNT_HOURS * HOUR_MS;

/**
 * A post's counts from its rows, as the daily recount works them out. The shown counts are every live vote, comment and
 * reshare; Top counts only other people's, from accounts a day old or more that aren't being deleted, and a person's
 * several comments on one post once.
 */
export function countsFor(
  authorId: string,
  rows: { votes: Actor[]; comments: Actor[]; reshares: Actor[] },
  now: Date,
): { upvotes: number; comments: number; reshares: number; topPoints: number } {
  const counts = (a: Actor) => a.userId !== authorId && !a.deleting && countsInTop(a.accountCreatedAt, now);
  const commenters = new Set(rows.comments.filter(counts).map((c) => c.userId)).size;
  return {
    upvotes: rows.votes.length,
    comments: rows.comments.length,
    reshares: rows.reshares.length,
    topPoints: topPoints({ upvotes: rows.votes.filter(counts).length, commenters, reshares: rows.reshares.filter(counts).length }),
  };
}

/* Who sees what ---------------------------------------------------------------------------------------------------- */

export type SeenPost = {
  authorId: string;
  status: JunctionStatus;
  deletedAt: Date | null;
  authorSuspended: boolean;
  authorDeleting: boolean;
};

/**
 * Whether a viewer may see a post in a feed (plan section 1): visible, not deleted, its author neither suspended nor
 * deleting, and no block either way. Its author also sees it while it is held, pending or hidden (with the notice).
 * The feed SQL holds the same rule (src/lib/junction/feed.ts).
 */
export function canSeePost(viewerId: string, p: SeenPost, blockedEitherWay: boolean): boolean {
  if (p.deletedAt || p.authorSuspended || p.authorDeleting) return false;
  if (p.authorId === viewerId) return true;
  if (blockedEitherWay) return false;
  return p.status === "visible";
}

/** Whether the post's text may be shown to this viewer: always to its author, to others only while visible. */
export const showsText = (viewerId: string, p: Pick<SeenPost, "authorId" | "status">): boolean => p.authorId === viewerId || p.status === "visible";

/* Writing ---------------------------------------------------------------------------------------------------------- */

/** An author edits within EDIT_WINDOW_MINUTES of posting; after that, only delete. */
export const withinEditWindow = (createdAt: Date, now: Date): boolean => now.getTime() - createdAt.getTime() <= EDIT_WINDOW_MINUTES * 60_000;

export type PostingProblem = "no_name" | "new_account" | "link_wait";

/**
 * Whether an account may post or comment now (plan section 4): it needs a name and must be NEW_ACCOUNT_POST_WAIT_HOURS
 * old, and NEW_ACCOUNT_LINK_WAIT_DAYS old to add a link. Null when it may.
 */
export function postingProblem(account: { name: string | null; createdAt: Date }, now: Date, withLink: boolean): PostingProblem | null {
  if (!account.name?.trim()) return "no_name";
  const age = now.getTime() - account.createdAt.getTime();
  if (age < NEW_ACCOUNT_POST_WAIT_HOURS * HOUR_MS) return "new_account";
  if (withLink && age < NEW_ACCOUNT_LINK_WAIT_DAYS * DAY_MS) return "link_wait";
  return null;
}

/* Reports and holds ------------------------------------------------------------------------------------------------ */

export type OpenReport = { reporterId: string | null; reason: string; reporterCreatedAt: Date | null };

/**
 * Whether a post or comment is held until an admin decides (plan section 2.5, Milin's decision 6): at the first
 * child_safety report, or at AUTO_HOLD_REPORTS open reports from different accounts, each at least
 * AUTO_HOLD_REPORTER_DAYS old. Logged complaints (no reporter) and young accounts still count as reports, but not here.
 */
export function shouldHold(open: OpenReport[], now: Date): boolean {
  if (open.some((r) => r.reason === "child_safety")) return true;
  const settled = new Set(
    open
      .filter((r) => r.reporterId && r.reporterCreatedAt && now.getTime() - r.reporterCreatedAt.getTime() >= AUTO_HOLD_REPORTER_DAYS * DAY_MS)
      .map((r) => r.reporterId),
  );
  return settled.size >= AUTO_HOLD_REPORTS;
}

/**
 * The reference a reporter is shown ("R-4F2K9A1B3C"): from the report's id, so it is unique with it and says nothing
 * about the report. Ten hex digits.
 */
export const reportReference = (reportId: string): string => `R-${reportId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/* Appeals and records ---------------------------------------------------------------------------------------------- */

/** The last moment a removal can be appealed. */
export const appealBy = (removedAt: Date): Date => new Date(removedAt.getTime() + APPEAL_WITHIN_DAYS * DAY_MS);
/** When an appeal must be decided. */
export const appealDecideBy = (appealedAt: Date): Date => new Date(appealedAt.getTime() + APPEAL_DECIDE_DAYS * DAY_MS);
/** When a removal record is deleted, unless a legal hold keeps it. */
export const purgeAfter = (removedAt: Date): Date => new Date(removedAt.getTime() + REMOVAL_KEEP_DAYS * DAY_MS);

/* The feed cursor -------------------------------------------------------------------------------------------------- */

/** Where the next page starts: after this post, in the feed's order. Top orders by points first. */
export type FeedCursor = { points: number | null; at: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

const toB64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

export const encodeCursor = (c: FeedCursor): string => toB64(`${c.points ?? ""}|${c.at}|${c.id}`);

/** The cursor back, or null when it was tampered with or is for the other ordering. */
export function decodeCursor(raw: string | undefined, withPoints: boolean): FeedCursor | null {
  if (!raw) return null;
  let text: string;
  try {
    text = fromB64(raw);
  } catch {
    return null;
  }
  const [p, at, id, ...rest] = text.split("|");
  if (rest.length || !at || !id || !ISO.test(at) || !UUID.test(id)) return null;
  if (withPoints) {
    if (!/^\d{1,9}$/.test(p ?? "")) return null;
    return { points: Number(p), at, id };
  }
  return p === "" ? { points: null, at, id } : null;
}
