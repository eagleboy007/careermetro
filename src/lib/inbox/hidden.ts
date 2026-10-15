import "server-only";
import { sql } from "drizzle-orm";
import { messages } from "@/db/schema";
import { HIDDEN_MESSAGE_TEXT } from "./types";

/*
 * Messages a CareerMetro admin hid after a report (FR-46, docs/plans/reports-review-plan.md). Every chat read path
 * (the Inbox, Corporate Messages' application and found chats, and their list previews) selects these instead of
 * messages.body, so a hidden message's text is swapped for the notice in the database and never read into the app, let
 * alone sent to a browser. Only the admin's report review and the sender's own "Download your data" read the body.
 */

/** The message's text as a chat shows it: the hidden notice in place of a hidden message's body. */
export const shownBody = () => sql<string>`case when ${messages.hiddenAt} is null then ${messages.body} else ${HIDDEN_MESSAGE_TEXT} end`;

/** Whether the message is hidden, so a hidden "Ask for times" or question card shows as the notice only. */
export const isHidden = () => sql<boolean>`(${messages.hiddenAt} is not null)`;
