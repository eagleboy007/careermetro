import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, conversationMembers, conversations, messages, organizations, reports, users } from "@/db/schema";
import { shortName } from "@/lib/account/name";
import { logEvent } from "@/lib/log";
import {
  hiddenMessageView,
  reportRemovalInput,
  suspendedAccountView,
  type HiddenMessageView,
  type RemovalState,
  type ReportReviewResult,
  type ReportReviewView,
  type SuspendedAccountView,
} from "@/lib/schemas/admin";
import { isAdminEmail } from "./access";

/*
 * The removal tools on the report review page (FR-46, docs/plans/reports-review-plan.md; Project manager's decision
 * under Milin's delegation, 2026-10-15). An admin hides the message a report points at, or suspends the account it
 * points at, and can undo either. Nothing is deleted: a hidden message keeps its body (every chat read swaps in the
 * notice, src/lib/inbox/hidden.ts) and a suspended account keeps everything (src/lib/auth/server.ts treats it as
 * signed out; companies stop seeing it). Each change runs in a transaction with its rows locked, records the admin,
 * the reason and the time on the row, and writes one audit line (admin:<id>, the action, message:<id> or user:<id>).
 * The audit table has no details column, so the report id isn't on that line. Doing it doesn't close the report: the
 * admin still marks it Action taken or Dismiss. Logs carry the action and outcome only, never a reason or a name.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type RemovalDeps = { db?: Db; now?: Date; env?: Record<string, string | undefined> };

type Name = { name: string | null; firstName: string | null; lastName: string | null };
const nameColumns = { name: users.name, firstName: users.firstName, lastName: users.lastName };
const nameOf = (n: Name | null | undefined) => (n && (n.name || n.firstName) ? shortName(n) : "A deleted account");
const AN_ADMIN = "An admin";

export const REMOVAL_TEXT = {
  invalid: "That didn't work. Reload the page and try again.",
  no_reason: "Write the reason, up to 500 characters.",
  not_open: "That report isn't open any more. Reload the page to see the latest.",
  no_message: "This report isn't about a message that is still there.",
  no_account: "This report doesn't point at one person's account that is still there.",
  admin: "An admin's account can't be suspended.",
  self: "You can't suspend your own account.",
  hidden: "Message hidden. Everyone in the chat now sees a notice in its place.",
  already_hidden: "That message was already hidden.",
  unhidden: "Message shown again.",
  not_hidden: "That message isn't hidden.",
  suspended: "Account suspended. They see the notice, and companies no longer see them.",
  already_suspended: "That account was already suspended.",
  lifted: "Suspension lifted. They can use CareerMetro again.",
  not_suspended: "That account isn't suspended.",
} as const;
type Outcome = keyof typeof REMOVAL_TEXT;

type ReportRow = { target: "message" | "person" | "chat" | "job"; targetId: string; reporterId: string | null };

/**
 * The account each report points at: the reported person, the writer of a reported message (none for a company
 * message whose writer's account went), or the one other person in a reported direct chat. A company chat or a job
 * points at a company, which is suspended from Company review instead.
 */
async function reportedAccounts(rows: (ReportRow & { id: string })[], db: Db | Tx): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const messageIds = [...new Set(rows.filter((r) => r.target === "message").map((r) => r.targetId))];
  const chatIds = [...new Set(rows.filter((r) => r.target === "chat").map((r) => r.targetId))];
  const [senders, members] = await Promise.all([
    messageIds.length ? db.select({ id: messages.id, senderId: messages.senderId }).from(messages).where(inArray(messages.id, messageIds)) : [],
    chatIds.length
      ? db
          .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId })
          .from(conversationMembers)
          .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
          .where(and(inArray(conversationMembers.conversationId, chatIds), eq(conversationMembers.role, "member"), isNull(conversations.orgId)))
      : [],
  ]);
  for (const r of rows) {
    if (r.target === "person") out.set(r.id, r.targetId);
    if (r.target === "message") {
      const sender = senders.find((m) => m.id === r.targetId)?.senderId;
      if (sender) out.set(r.id, sender);
    }
    if (r.target === "chat" && r.reporterId) {
      const others = members.filter((m) => m.conversationId === r.targetId && m.userId !== r.reporterId);
      if (others.length === 1) out.set(r.id, others[0]!.userId);
    }
  }
  return out;
}

/** Short names of the admins who hid or suspended, keyed by user id. */
async function adminNames(ids: (string | null)[], db: Db): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const rows = wanted.length ? await db.select({ id: users.id, ...nameColumns }).from(users).where(inArray(users.id, wanted)) : [];
  return new Map(rows.map((r) => [r.id, nameOf(r)]));
}

const stateOf = (at: Date | null, by: string | null, reason: string | null, names: Map<string, string>): RemovalState | null =>
  at ? { at: at.toISOString(), by: (by && names.get(by)) || AN_ADMIN, reason: reason || "No reason recorded" } : null;

/**
 * For the open reports on the page: the reported message and whether it is hidden, and the account the report points
 * at with its suspension, by report id. `adminUserId` is the admin looking, who can't suspend themselves.
 */
export async function removalStates(
  rows: (ReportRow & { id: string })[],
  adminUserId: string | null,
  deps: RemovalDeps = {},
): Promise<Map<string, Pick<ReportReviewView, "message" | "account">>> {
  const db = deps.db ?? getDb();
  const env = deps.env ?? process.env;
  const messageIds = [...new Set(rows.filter((r) => r.target === "message").map((r) => r.targetId))];
  const [accountOf, msgs] = await Promise.all([
    reportedAccounts(rows, db),
    messageIds.length
      ? db
          .select({ id: messages.id, hiddenAt: messages.hiddenAt, hiddenBy: messages.hiddenBy, hiddenReason: messages.hiddenReason })
          .from(messages)
          .where(inArray(messages.id, messageIds))
      : [],
  ]);
  const accountIds = [...new Set(accountOf.values())];
  const people = accountIds.length
    ? await db
        .select({ id: users.id, email: users.email, ...nameColumns, suspendedAt: users.suspendedAt, suspendedBy: users.suspendedBy, suspendedReason: users.suspendedReason })
        .from(users)
        .where(inArray(users.id, accountIds))
    : [];
  const names = await adminNames([...msgs.map((m) => m.hiddenBy), ...people.map((p) => p.suspendedBy)], db);
  const out = new Map<string, Pick<ReportReviewView, "message" | "account">>();
  for (const r of rows) {
    const m = r.target === "message" ? msgs.find((x) => x.id === r.targetId) : undefined;
    const accountId = accountOf.get(r.id);
    const p = accountId ? people.find((x) => x.id === accountId) : undefined;
    out.set(r.id, {
      message: m ? { id: m.id, hidden: stateOf(m.hiddenAt, m.hiddenBy, m.hiddenReason, names) } : null,
      account: p
        ? {
            id: p.id,
            name: nameOf(p),
            suspended: stateOf(p.suspendedAt, p.suspendedBy, p.suspendedReason, names),
            canSuspend: p.id !== adminUserId && !isAdminEmail(p.email, env),
          }
        : null,
    });
  }
  return out;
}

/**
 * Hidden messages and suspended accounts in force, newest first, at most 100 each, so either can be undone after its
 * report is closed. The admin sees the hidden text, as on the report, to decide.
 */
export async function removalsInForce(deps: RemovalDeps = {}): Promise<{ messages: HiddenMessageView[]; accounts: SuspendedAccountView[] }> {
  const db = deps.db ?? getDb();
  const [hidden, suspended] = await Promise.all([
    db
      .select({
        id: messages.id,
        body: messages.body,
        senderId: messages.senderId,
        hiddenAt: messages.hiddenAt,
        hiddenBy: messages.hiddenBy,
        hiddenReason: messages.hiddenReason,
        org: organizations.name,
        ...nameColumns,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .leftJoin(organizations, eq(organizations.id, conversations.orgId))
      .leftJoin(users, eq(users.id, messages.senderId))
      .where(isNotNull(messages.hiddenAt))
      .orderBy(desc(messages.hiddenAt))
      .limit(100),
    db
      .select({ id: users.id, ...nameColumns, suspendedAt: users.suspendedAt, suspendedBy: users.suspendedBy, suspendedReason: users.suspendedReason })
      .from(users)
      .where(isNotNull(users.suspendedAt))
      .orderBy(desc(users.suspendedAt))
      .limit(100),
  ]);
  const names = await adminNames([...hidden.map((m) => m.hiddenBy), ...suspended.map((p) => p.suspendedBy)], db);
  return {
    messages: hidden.map((m) => {
      const from = m.senderId ? nameOf(m) : m.org ? "the company team" : "A deleted account";
      return hiddenMessageView.parse({
        id: m.id,
        label: `Message from ${from}${m.org ? ` at ${m.org}` : ""}`,
        text: m.body,
        hidden: stateOf(m.hiddenAt, m.hiddenBy, m.hiddenReason, names),
      });
    }),
    accounts: suspended.map((p) => suspendedAccountView.parse({ id: p.id, name: nameOf(p), suspended: stateOf(p.suspendedAt, p.suspendedBy, p.suspendedReason, names) })),
  };
}

/** The open report, locked so it can't be closed while the admin acts on it. */
async function openReport(reportId: string, tx: Tx): Promise<(ReportRow & { id: string }) | null> {
  const [row] = await tx
    .select({ id: reports.id, target: reports.target, targetId: reports.targetId, reporterId: reports.reporterId })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.status, "open")))
    .for("update");
  return row ?? null;
}

/**
 * Hides or shows again a reported message, or suspends or lifts the suspension of a reported account, for the admin
 * with this user id. Hide and suspend start from an open report and need a reason; the undoing takes the message or
 * account id, so it works after the report is closed. Never on an admin's account or the admin's own.
 */
export async function applyRemoval(adminUserId: string, input: unknown, deps: RemovalDeps = {}): Promise<ReportReviewResult> {
  const parsed = reportRemovalInput.safeParse(input);
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.some((i) => i.path[0] === "reason");
    return { ok: false, message: REMOVAL_TEXT[reasonIssue ? "no_reason" : "invalid"] };
  }
  const data = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env;
  const actor = `admin:${adminUserId}`;
  const outcome = await db.transaction(async (tx): Promise<{ ok: boolean; outcome: Outcome }> => {
    if (data.action === "hide_message" || data.action === "unhide_message") {
      let messageId: string;
      if (data.action === "hide_message") {
        const report = await openReport(data.reportId, tx);
        if (!report) return { ok: false, outcome: "not_open" };
        if (report.target !== "message") return { ok: false, outcome: "no_message" };
        messageId = report.targetId;
      } else {
        messageId = data.messageId;
      }
      const [message] = await tx.select({ hiddenAt: messages.hiddenAt }).from(messages).where(eq(messages.id, messageId)).for("update");
      if (!message) return { ok: false, outcome: "no_message" };
      if (data.action === "hide_message") {
        if (message.hiddenAt) return { ok: true, outcome: "already_hidden" };
        await tx.update(messages).set({ hiddenAt: now, hiddenBy: adminUserId, hiddenReason: data.reason }).where(and(eq(messages.id, messageId), isNull(messages.hiddenAt)));
        await tx.insert(auditLogs).values({ actor, action: "message_hidden", target: `message:${messageId}`, createdAt: now });
        return { ok: true, outcome: "hidden" };
      }
      if (!message.hiddenAt) return { ok: true, outcome: "not_hidden" };
      await tx.update(messages).set({ hiddenAt: null, hiddenBy: null, hiddenReason: null }).where(and(eq(messages.id, messageId), isNotNull(messages.hiddenAt)));
      await tx.insert(auditLogs).values({ actor, action: "message_unhidden", target: `message:${messageId}`, createdAt: now });
      return { ok: true, outcome: "unhidden" };
    }

    let userId: string;
    if (data.action === "suspend_account") {
      const report = await openReport(data.reportId, tx);
      if (!report) return { ok: false, outcome: "not_open" };
      const found = (await reportedAccounts([report], tx)).get(report.id);
      if (!found) return { ok: false, outcome: "no_account" };
      userId = found;
    } else {
      userId = data.userId;
    }
    const [person] = await tx.select({ email: users.email, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, userId)).for("update");
    if (!person) return { ok: false, outcome: "no_account" };
    if (data.action === "suspend_account") {
      if (userId === adminUserId) return { ok: false, outcome: "self" };
      if (isAdminEmail(person.email, env)) return { ok: false, outcome: "admin" };
      if (person.suspendedAt) return { ok: true, outcome: "already_suspended" };
      await tx.update(users).set({ suspendedAt: now, suspendedBy: adminUserId, suspendedReason: data.reason }).where(and(eq(users.id, userId), isNull(users.suspendedAt)));
      await tx.insert(auditLogs).values({ actor, action: "account_suspended", target: `user:${userId}`, createdAt: now });
      return { ok: true, outcome: "suspended" };
    }
    if (!person.suspendedAt) return { ok: true, outcome: "not_suspended" };
    await tx.update(users).set({ suspendedAt: null, suspendedBy: null, suspendedReason: null }).where(and(eq(users.id, userId), isNotNull(users.suspendedAt)));
    await tx.insert(auditLogs).values({ actor, action: "account_unsuspended", target: `user:${userId}`, createdAt: now });
    return { ok: true, outcome: "lifted" };
  });
  logEvent("info", "report_removal", { action: data.action, outcome: outcome.outcome });
  return { ok: outcome.ok, message: REMOVAL_TEXT[outcome.outcome] };
}
