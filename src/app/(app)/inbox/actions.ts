"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { acceptRequest, deleteRequest, INBOX_ERROR_TEXT, markRead, report, sendMessage, type InboxResult } from "@/lib/inbox/store";
import { conversationInput, reportInput, sendMessageInput } from "@/lib/schemas/inbox";
import type { InboxActions } from "@/lib/inbox/types";
import { INTERVIEW_ERROR_TEXT, offerTimes } from "@/lib/corporate/interviews-store";

/*
 * The Inbox's server actions. Each checks who is signed in and validates its input; the store checks membership and the
 * chat's rules. They return the words to show on failure, never details of the chat or the other person.
 */

const SIGN_IN = "Please sign in again.";
const BAD = "That didn't work. Please try again.";

const answer = (result: InboxResult): string | null => {
  if (!result.ok) return INBOX_ERROR_TEXT[result.error];
  // The list, the chat and the unread badge in the top bar.
  refresh();
  return null;
};

export const sendInboxMessage: InboxActions["send"] = async (conversationId, body) => {
  const input = sendMessageInput.safeParse({ conversationId, body });
  if (!input.success) return input.error.issues.find((i) => i.path[0] === "body")?.message ?? BAD;
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return answer(await sendMessage(account.id, input.data.conversationId, input.data.body));
};

export const acceptInboxRequest: InboxActions["accept"] = async (conversationId) => {
  const input = conversationInput.safeParse({ conversationId });
  if (!input.success) return BAD;
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return answer(await acceptRequest(account.id, input.data.conversationId));
};

export const deleteInboxRequest: InboxActions["remove"] = async (conversationId) => {
  const input = conversationInput.safeParse({ conversationId });
  if (!input.success) return BAD;
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return answer(await deleteRequest(account.id, input.data.conversationId));
};

export const reportInInbox: InboxActions["report"] = async (raw) => {
  const input = reportInput.safeParse(raw);
  if (!input.success) return BAD;
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return answer(await report(account.id, input.data));
};

export const readInboxChat: InboxActions["read"] = async (conversationId) => {
  const input = conversationInput.safeParse({ conversationId });
  const account = input.success ? await currentAccount() : null;
  if (!account || !input.success) return;
  await markRead(account.id, input.data.conversationId);
  refresh();
};

/** Answers "Ask for times" with the times picked (build step 6). Only those times reach the company. */
export const offerInboxTimes: NonNullable<InboxActions["offerTimes"]> = async (messageId, slots) => {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const r = await offerTimes(account.id, { messageId, slots });
  if (!r.ok) return r.message ?? INTERVIEW_ERROR_TEXT[r.error];
  refresh();
  return null;
};
