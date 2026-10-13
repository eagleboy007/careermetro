"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { FIND_ERROR_TEXT, openFoundPerson, searchPeople, sendFoundRequest } from "@/lib/corporate/find-store";
import type { FindActions } from "@/lib/corporate/find-types";

/*
 * Find people's server actions (pending item 19, dev/companies-find-me-plan.md). They check who is signed in; the store
 * validates the input with Zod, re-reads the live company role, job team, the person's switch and blocks, and writes
 * the audit line. They answer in words to show, and log nothing of the person or the message.
 */

/**
 * Runs one search when the member presses Search (Testing T41): a POST, so opening or sharing a /corporate/people link
 * never uses up the limits or writes an audit line. The store checks the role, the job and the limits.
 */
export const searchPeopleAction: FindActions["search"] = async (jobId, band, page) => {
  const account = await currentAccount();
  if (!account) return { ok: false, error: "Please sign in again." };
  const r = await searchPeople(account.id, { jobId, band, page });
  return r.ok ? { ok: true, results: { cards: r.cards, total: r.total, hasMore: r.hasMore } } : { ok: false, error: FIND_ERROR_TEXT[r.error] };
};

/** Opens one person found from a job: their public profile parts and Match. Writes a profile view they can see. */
export const openFoundPersonAction: FindActions["open"] = async (jobId, ref) => {
  const account = await currentAccount();
  if (!account) return { ok: false, error: "Please sign in again." };
  const r = await openFoundPerson(account.id, { jobId, ref });
  return r.ok ? { ok: true, person: r.person } : { ok: false, error: FIND_ERROR_TEXT[r.error] };
};

/** Sends one message request; the page reloads from the server on success, so the card and sent list show it. */
export const sendFoundRequestAction: FindActions["request"] = async (jobId, ref, body) => {
  const account = await currentAccount();
  if (!account) return "Please sign in again.";
  const r = await sendFoundRequest(account.id, { jobId, ref, body });
  if (!r.ok) return FIND_ERROR_TEXT[r.error];
  refresh();
  return null;
};
