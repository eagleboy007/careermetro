import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { applications, candidateSlots, conversationMembers, conversations, jobs, messages, organizations, users } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { COMPANY_TEAM, formatAt, MESSAGES_PER_CHAT, openApplicationChat } from "@/lib/inbox/store";
import { logEvent } from "@/lib/log";
import { companyMessageInput } from "@/lib/schemas/corporate";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { visibleApplication } from "./applications-store";
import { visibleApplicationsWhere } from "./scope";
import { chatClosed, companySendRefusal, scheduleRefusal, type CompanySendRefusal } from "./rules";
import { askDaysOf } from "./interview-reads";
import { askAnswered, askEnded, slotLabel } from "./slots";
import { activeMembership } from "./store";
import type { CompanyChatListItem, CompanyChatMessage, CompanyChatState, CompanyChatView, CompanyMessagesView } from "./types";

/*
 * Company chats (dev/corporate-plan.md build step 5; handoff 12e): one conversation per application, owned by the
 * company. Recruiter admins and Hiring HR on the job read and write it; Interviewers read only the candidates assigned
 * to them (none until interviews, step 6) and never write. Every read and write re-reads the person's live
 * `org_members` row and the job's team through visibleApplication, the same check as the board. Company-side member
 * rows only hold unread counts. The chat takes messages while the application is open and for 30 days after it
 * closes; only a verified company writes. Logs carry event names and reasons only: never a message, a name or a note.
 */

type Db = ReturnType<typeof getDb>;
export type ChatDeps = { db?: Db; now?: Date };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CompanyChatError = "invalid" | "not_member" | "not_allowed" | "not_found" | "limit" | CompanySendRefusal;

export const COMPANY_CHAT_ERROR_TEXT: Record<CompanyChatError, string> = {
  invalid: "Write a message of up to 2,000 characters.",
  not_member: "You don't have access to this company.",
  not_allowed: "Only Recruiter admins, and Hiring HR on this job, can message its candidates.",
  not_found: "That chat isn't available.",
  limit: "Your company has sent a lot of messages today. Try again tomorrow.",
  read_only: "Interviewers can read their candidates' chats but not send in them.",
  suspended: "Your company's messages are paused while we review it.",
  closed: "This chat is closed. Chats close 30 days after an application does.",
};

export type ChatResult<T = object> = ({ ok: true } & T) | { ok: false; error: CompanyChatError };

const fail = (error: CompanyChatError) => ({ ok: false as const, error });

/** The company's state for a chat the person can read: whether they can write, and if not why. */
function stateFor(x: Parameters<typeof companySendRefusal>[0]): CompanyChatState {
  return companySendRefusal(x) ?? "open";
}

/**
 * Corporate Messages' list: the company's application chats with at least one message, that the person may read now.
 * Recruiter admins see every job's; Hiring HR the jobs they are on; Interviewers none until they are assigned to
 * candidates (step 6). Never the person's own applications, withdrawn ones, deleted accounts, or applications more
 * than 180 days past closing.
 */
export async function companyMessages(userId: string, deps: ChatDeps = {}): Promise<ChatResult<{ view: CompanyMessagesView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await activeMembership(userId, db);
  if (!me) return fail("not_member");
  const [org] = await db.select({ status: organizations.reviewStatus }).from(organizations).where(eq(organizations.id, me.orgId));
  const view: CompanyMessagesView = { company: me.orgName, status: org?.status ?? "pending", role: me.role, items: [] };
  const rows = await db
    .select({
      conversationId: conversations.id,
      applicationId: applications.id,
      name: users.name,
      job: jobs.title,
      stage: applications.stage,
    })
    .from(conversations)
    .innerJoin(applications, eq(applications.id, conversations.applicationId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(
      and(
        eq(conversations.orgId, me.orgId),
        // Interviewers (and anyone on a job without moving its candidates) read the chats of candidates whose live
        // interview they are on, while they are still on the job's team (build step 6).
        visibleApplicationsWhere(me, userId, db, now),
        sql`exists (select 1 from ${messages} x where x.conversation_id = ${conversations.id} and x.kind <> 'system')`,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(200);
  if (!rows.length) return { ok: true, view };

  // The last message in each chat that anyone wrote, and whether someone other than the person wrote since they read it.
  const ids = rows.map((r) => r.conversationId);
  const last = await db
    .selectDistinctOn([messages.conversationId], { conversationId: messages.conversationId, body: messages.body, createdAt: messages.createdAt })
    .from(messages)
    .where(and(inArray(messages.conversationId, ids), ne(messages.kind, "system")))
    .orderBy(messages.conversationId, desc(messages.createdAt));
  const unread = await db.execute<{ id: string }>(sql`
    select c.id from ${conversations} c
    where c.id in ${ids} and exists (
      select 1 from ${messages} x where x.conversation_id = c.id and x.kind <> 'system' and x.sender_id is distinct from ${userId}
        and x.created_at > coalesce((select m.last_read_at from ${conversationMembers} m where m.conversation_id = c.id and m.user_id = ${userId}), '-infinity'::timestamptz))`);
  const unreadIds = new Set([...unread].map((r) => r.id));
  view.items = rows.map((r): CompanyChatListItem => {
    const l = last.find((m) => m.conversationId === r.conversationId);
    return {
      applicationId: r.applicationId,
      name: displayName(r.name),
      job: r.job,
      stage: r.stage,
      preview: l?.body ?? null,
      at: l ? formatAt(l.createdAt, now) : null,
      unread: unreadIds.has(r.conversationId),
    };
  });
  return { ok: true, view };
}

/** Marks the chat read for a company member: their member row only holds the time, never access. */
async function markCompanyRead(db: Db, conversationId: string, userId: string, now: Date) {
  await db
    .insert(conversationMembers)
    .values({ conversationId, userId, role: "company_team", lastReadAt: now })
    .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { lastReadAt: now } });
}

/**
 * One application's chat for the company. Each message names who wrote it; a deleted account's messages stay, from the
 * company team. With `markRead` the chat counts as read for the person up to now.
 */
export async function companyChat(userId: string, applicationId: string, deps: ChatDeps & { markRead?: boolean } = {}): Promise<ChatResult<{ chat: CompanyChatView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!UUID.test(applicationId)) return fail("not_found");
  const found = await visibleApplication(userId, applicationId, db, now);
  if (!found.ok) return fail(found.error === "not_member" || found.error === "not_allowed" ? found.error : "not_found");
  const { app, access } = found;
  if (app.withdrawnAt) return fail("not_found");
  const [conversation] = await db
    .select({ id: conversations.id, status: conversations.status })
    .from(conversations)
    .where(and(eq(conversations.applicationId, app.id), eq(conversations.orgId, app.orgId)));
  const rows = conversation
    ? await db
        .select({
          id: messages.id,
          senderId: messages.senderId,
          kind: messages.kind,
          body: messages.body,
          payload: messages.payload,
          createdAt: messages.createdAt,
          name: users.name,
          deleted: users.deletionRequestedAt,
        })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.senderId))
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            sql`${messages.id} in (select id from ${messages} where conversation_id = ${conversation.id} order by created_at desc limit ${MESSAGES_PER_CHAT})`,
          ),
        )
        .orderBy(asc(messages.createdAt))
    : [];
  const candidate = displayName(app.name);
  // "Ask for times" cards carry the times the candidate offered in answer (build step 6).
  const asks = rows.filter((m) => m.kind === "ask_times").map((m) => m.id);
  const offered = asks.length
    ? await db
        .select({ askMessageId: candidateSlots.askMessageId, startsAt: candidateSlots.startsAt })
        .from(candidateSlots)
        .where(inArray(candidateSlots.askMessageId, asks))
        .orderBy(asc(candidateSlots.startsAt))
    : [];
  const list = rows.map((m): CompanyChatMessage => {
    if (m.kind === "system") return { id: m.id, by: "system", who: "", text: m.body === "applied" ? "Applied on CareerMetro." : "" };
    const base = { id: m.id, text: m.body, at: formatAt(m.createdAt, now), ...(m.kind === "ask_question" ? { question: true } : {}) };
    if (m.kind === "ask_times") {
      const given = offered.filter((o) => o.askMessageId === m.id).map((o) => o.startsAt);
      const ended = askEnded({ days: askDaysOf(m.payload), offered: given, answered: askAnswered(m.payload) }, now);
      Object.assign(base, { times: { offered: given.length ? given.map(slotLabel) : null, ...(ended ? { ended } : {}) } });
    }
    if (m.senderId === userId) return { ...base, by: "me", who: "You" };
    if (m.senderId === app.userId) return { ...base, by: "candidate", who: candidate };
    return { ...base, by: "team", who: m.senderId && !m.deleted ? displayName(m.name) : COMPANY_TEAM };
  });
  if (deps.markRead && conversation) await markCompanyRead(db, conversation.id, userId, now);
  const closed = chatClosed(app, conversation?.status ?? "open", now);
  return {
    ok: true,
    chat: {
      applicationId: app.id,
      jobId: app.jobId,
      job: app.jobTitle,
      candidate,
      stage: app.stage,
      messages: list.filter((m) => m.text),
      state: stateFor({ role: access.me.role, teamRole: access.teamRole, orgStatus: app.orgStatus, closed }),
      canAskTimes:
        !closed &&
        scheduleRefusal({ role: access.me.role, teamRole: access.teamRole, orgStatus: app.orgStatus, app: { stage: app.stage, withdrawn: false, jobStatus: app.jobStatus } }) === null,
    },
  };
}

/**
 * Sends a message, or "Ask a question", in an application's chat. Recruiter admins and Hiring HR on the job only, for a
 * verified company, while the chat is open; 200 messages a day per company. Opens the chat if the application has none
 * yet (applications made before chats existed).
 */
export async function sendCompanyMessage(userId: string, raw: unknown, deps: ChatDeps = {}): Promise<ChatResult<{ messageId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = companyMessageInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const input = parsed.data;
  const result = await db.transaction(async (tx): Promise<ChatResult<{ messageId: string }>> => {
    const me = await activeMembership(userId, tx);
    if (!me) return fail("not_member");
    // Interviewers never send, whatever they are assigned to.
    if (me.role === "interviewer") return fail("read_only");
    const found = await visibleApplication(userId, input.applicationId, tx, now, true);
    if (!found.ok) return fail(found.error === "not_member" || found.error === "not_allowed" ? found.error : "not_found");
    const { app, access } = found;
    // A withdrawn application gives nothing away to the company, as on the board.
    if (app.withdrawnAt) return fail("not_found");
    const conversationId = await openApplicationChat(tx, { applicationId: app.id, orgId: app.orgId, userId: app.userId }, now, false);
    const [conversation] = await tx.select({ status: conversations.status }).from(conversations).where(eq(conversations.id, conversationId)).for("update");
    const refusal = companySendRefusal({ role: access.me.role, teamRole: access.teamRole, orgStatus: app.orgStatus, closed: chatClosed(app, conversation!.status, now) });
    if (refusal) return fail(refusal);
    // Counted last, so refusals above don't use up the company's day. The limits live in the database for every server,
    // and are counted on this transaction, so a send that rolls back uses up nothing. One candidate first, then the company.
    const at = { db: tx, now: now.getTime() };
    if (!(await takeShared(LIMITS.companyMessagesPerApplicationDay, app.id, at))) return fail("limit");
    if (!(await takeShared(LIMITS.companyMessagesPerCompanyDay, app.orgId, at))) return fail("limit");
    const [message] = await tx
      .insert(messages)
      .values({ conversationId, senderId: userId, kind: input.question ? "ask_question" : "text", body: input.body, createdAt: now })
      .returning({ id: messages.id });
    await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
    // Writing reads it, for the writer.
    await tx
      .insert(conversationMembers)
      .values({ conversationId, userId, role: "company_team", lastReadAt: now })
      .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { lastReadAt: now } });
    return { ok: true, messageId: message.id };
  });
  logEvent("info", result.ok ? "company_message_sent" : "company_message_refused", result.ok ? { kind: input.question ? "ask_question" : "text" } : { reason: result.error });
  return result;
}
