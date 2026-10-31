"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { currentAccount } from "@/lib/auth/server";
import { feedFor, ownPostsPage, savedPostsPage } from "@/lib/junction/feed";
import { appealRemoval, fileJunctionReport } from "@/lib/junction/moderation";
import {
  acceptJunctionRules,
  addComment,
  createPost,
  deleteComment,
  deletePost,
  editPost,
  setJunctionPostsShown,
  setPin,
  toggleCommentVote,
  toggleReshare,
  toggleSave,
  toggleVote,
} from "@/lib/junction/store";
import type { FeedRequest, InterestAct, JunctionAct, JunctionReportAct, JunctionToggle, MineTab } from "@/lib/junction/types";
import { errorFields, logEvent } from "@/lib/log";
import { addInterest, ME_EDIT_MESSAGES, removeInterest } from "@/lib/me/edit-store";
import { junctionEnabled } from "@/lib/preview";
import type { JunctionReportReason } from "@/lib/schemas/constants";
import type { FeedPage } from "@/lib/schemas/junction";

/*
 * Junction's server actions (docs/plans/junction-plan.md section 4, FR-61). Each one answers not-found while
 * JUNCTION_ENABLED is off, takes the user id from the session only, and leaves the input to the store's Zod check, the
 * suspended and deleting refusals and the daily limits. They return words to show, never post or comment text, and log
 * event names and outcomes only (the stores do).
 */

const SIGN_IN = "Please sign in again.";
const FAILED = "That didn't work. Please try again.";

/** The signed-in person's id, or null; not-found when Junction is off. */
async function who(): Promise<string | null> {
  if (!junctionEnabled()) notFound();
  const account = await currentAccount();
  return account?.id ?? null;
}

/** Runs a write, turning a thrown error into the generic words and a log line with no content. */
async function guarded<T extends { ok: boolean }>(event: string, work: (userId: string) => Promise<T>, fallback: (message: string) => T): Promise<T> {
  const userId = await who();
  if (!userId) return fallback(SIGN_IN);
  try {
    return await work(userId);
  } catch (error) {
    logEvent("error", event, errorFields(error));
    return fallback(FAILED);
  }
}

const act = (r: { ok: true } | { ok: false; message: string }, refreshAfter = true): JunctionAct => {
  if (!r.ok) return { ok: false, message: r.message };
  if (refreshAfter) refresh();
  return { ok: true };
};
const no = (message: string) => ({ ok: false as const, message });

export async function createPostAction(input: unknown): Promise<JunctionAct> {
  return guarded("junction_post_failed", async (id) => act(await createPost(id, input)), no);
}

export async function editPostAction(input: unknown): Promise<JunctionAct> {
  return guarded("junction_edit_failed", async (id) => act(await editPost(id, input)), no);
}

export async function deletePostAction(postId: unknown): Promise<JunctionAct> {
  return guarded("junction_delete_failed", async (id) => act(await deletePost(id, { postId })), no);
}

export async function votePostAction(postId: unknown): Promise<JunctionToggle> {
  return guarded<JunctionToggle>(
    "junction_vote_failed",
    async (id) => {
      const r = await toggleVote(id, { postId });
      return r.ok ? { ok: true, on: r.voted } : no(r.message);
    },
    no,
  );
}

export async function reshareAction(postId: unknown): Promise<JunctionToggle> {
  return guarded<JunctionToggle>(
    "junction_reshare_failed",
    async (id) => {
      const r = await toggleReshare(id, { postId });
      return r.ok ? { ok: true, on: r.reshared } : no(r.message);
    },
    no,
  );
}

export async function saveAction(postId: unknown): Promise<JunctionToggle> {
  return guarded<JunctionToggle>(
    "junction_save_failed",
    async (id) => {
      const r = await toggleSave(id, { postId });
      return r.ok ? { ok: true, on: r.saved } : no(r.message);
    },
    no,
  );
}

export async function pinAction(postId: unknown, position: unknown): Promise<JunctionAct> {
  return guarded("junction_pin_failed", async (id) => act(await setPin(id, { postId, position })), no);
}

export async function commentAction(postId: unknown, body: unknown): Promise<JunctionAct> {
  return guarded("junction_comment_failed", async (id) => act(await addComment(id, { postId, body })), no);
}

export async function voteCommentAction(commentId: unknown): Promise<JunctionToggle> {
  return guarded<JunctionToggle>(
    "junction_comment_vote_failed",
    async (id) => {
      const r = await toggleCommentVote(id, { commentId });
      return r.ok ? { ok: true, on: r.voted } : no(r.message);
    },
    no,
  );
}

export async function deleteCommentAction(commentId: unknown): Promise<JunctionAct> {
  return guarded("junction_comment_delete_failed", async (id) => act(await deleteComment(id, { commentId })), no);
}

export async function reportAction(target: unknown, targetId: unknown, reason: JunctionReportReason, note: unknown): Promise<JunctionReportAct> {
  return guarded<JunctionReportAct>(
    "junction_report_failed",
    async (id) => {
      const r = await fileJunctionReport(id, { target, targetId, reason, note: typeof note === "string" && note.trim() ? note : undefined });
      if (!r.ok) return no(r.message);
      // A held post or comment leaves the feeds at once.
      refresh();
      return { ok: true, reference: r.reference, decideBy: r.decideBy };
    },
    no,
  );
}

export async function appealAction(removalId: unknown, note: unknown): Promise<JunctionAct> {
  return guarded(
    "junction_appeal_failed",
    async (id) => {
      const r = await appealRemoval(id, { removalId, note });
      if (!r.ok) return no(r.message);
      refresh();
      return { ok: true, message: r.message };
    },
    no,
  );
}

export async function acceptRulesAction(): Promise<JunctionAct> {
  return guarded("junction_rules_failed", async (id) => act(await acceptJunctionRules(id)), no);
}

/** "Show more" on a feed tab: the next page after the cursor, or null when it can't be read. */
export async function moreFeedAction(req: FeedRequest): Promise<FeedPage | null> {
  const userId = await who();
  if (!userId || !req || typeof req !== "object") return null;
  try {
    const r = await feedFor(userId, { feed: req.feed, interestId: req.interestId, cursor: req.cursor });
    return r.ok ? r.page : null;
  } catch (error) {
    logEvent("error", "junction_more_failed", errorFields(error));
    return null;
  }
}

/** "Show more" on Your posts or Saved. */
export async function moreMineAction(tab: MineTab, cursor: string): Promise<FeedPage | null> {
  const userId = await who();
  if (!userId || typeof cursor !== "string") return null;
  try {
    const r = tab === "saved" ? await savedPostsPage(userId, cursor) : await ownPostsPage(userId, cursor);
    return r.ok ? r.page : null;
  } catch (error) {
    logEvent("error", "junction_more_failed", errorFields(error));
    return null;
  }
}

/** The rail's "Your interests": the same rows, store and caps as Me's interests. */
async function interestEdit(event: string, work: (userId: string) => ReturnType<typeof addInterest>): Promise<InterestAct> {
  const userId = await who();
  if (!userId) return { error: SIGN_IN };
  try {
    const out = await work(userId);
    if (!out.ok) return { error: out.message ?? ME_EDIT_MESSAGES[out.error], field: out.field };
    refresh();
    return { error: null };
  } catch (error) {
    logEvent("error", event, errorFields(error));
    return { error: FAILED };
  }
}

export async function addInterestFromRail(name: string): Promise<InterestAct> {
  return interestEdit("junction_interest_add_failed", (id) => addInterest(id, { name }));
}

export async function removeInterestFromRail(name: string): Promise<InterestAct> {
  return interestEdit("junction_interest_remove_failed", (id) => removeInterest(id, { name }));
}

/** The "Junction posts" profile switch on Me. Null when it worked, or the words to show. */
export async function showJunctionPostsAction(on: unknown): Promise<string | null> {
  const userId = await who();
  if (!userId) return SIGN_IN;
  try {
    const r = await setJunctionPostsShown(userId, on);
    if (!r.ok) return r.message;
  } catch (error) {
    logEvent("error", "junction_posts_shown_failed", errorFields(error));
    return FAILED;
  }
  refresh();
  return null;
}
