"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { COMPANY_CHAT_ERROR_TEXT, sendCompanyMessage } from "@/lib/corporate/chats-store";
import { FIND_ERROR_TEXT, sendFoundMessage } from "@/lib/corporate/find-store";
import type { CompanyChatActions } from "@/lib/corporate/types";

/*
 * Corporate Messages' server action (dev/corporate-plan.md build step 5). It checks who is signed in; the store
 * validates the input with Zod and re-reads the person's live company role and job team. It answers in words to show,
 * never details of the chat, and logs nothing of the message.
 */

/** Sends a message, or "Ask a question", in an application's chat; the page reloads from the server on success. */
export const sendCompanyMessageAction: CompanyChatActions["send"] = async (applicationId, body, question) => {
  const account = await currentAccount();
  if (!account) return "Please sign in again.";
  const r = await sendCompanyMessage(account.id, { applicationId, body, question });
  if (!r.ok) return COMPANY_CHAT_ERROR_TEXT[r.error];
  refresh();
  return null;
};

/** Sends a message in a found chat the person accepted (pending item 19); the page reloads from the server on success. */
export const sendFoundMessageAction: NonNullable<CompanyChatActions["sendFound"]> = async (conversationId, body) => {
  const account = await currentAccount();
  if (!account) return "Please sign in again.";
  const r = await sendFoundMessage(account.id, { conversationId, body });
  if (!r.ok) return FIND_ERROR_TEXT[r.error];
  refresh();
  return null;
};
