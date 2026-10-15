import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, conversationMembers, conversations, jobs, messages, organizations, reports, users } from "@/db/schema";
import { shortName } from "@/lib/account/name";
import { REPORT_REASON_LABELS } from "@/lib/inbox/types";
import { logEvent } from "@/lib/log";
import { reportReviewInput, reportReviewView, type ReportReviewResult, type ReportReviewView } from "@/lib/schemas/admin";
import type { ReportReason } from "@/lib/schemas/inbox";
import { reportDeadlines } from "./report-deadlines";

/*
 * The report review page's data (/admin/reports; FR-45, docs/plans/reports-review-plan.md). Open reports from the
 * Inbox and from job pages, oldest first, with the deadlines the Grievances page promises. The caller has already
 * checked the person is an admin (src/lib/admin/server.ts); these functions take the admin's user id for the audit
 * line. The admin sees what they need to decide: the reason, the reporter's note and the reported message or job.
 * Never an email or phone; people are first name and last initial. Logs and audit lines carry ids and outcomes only.
 */

type Db = ReturnType<typeof getDb>;
export type ReportAdminDeps = { db?: Db; now?: Date };

const WHAT = { message: "A message", person: "A person", chat: "A chat", job: "A job" } as const;
const GONE = "A deleted account";

type Name = { name: string | null; firstName: string | null; lastName: string | null };
const nameColumns = { name: users.name, firstName: users.firstName, lastName: users.lastName };
const nameOf = (n: Name | null | undefined) => (n && (n.name || n.firstName) ? shortName(n) : GONE);
const ofIds = (rows: { target: string; targetId: string }[], target: string) => [...new Set(rows.filter((r) => r.target === target).map((r) => r.targetId))];

type Context = NonNullable<ReportReviewView["context"]>;

/** The reported message, person, chat or job, in words, keyed by target id. A target that is gone has none. */
async function contexts(rows: { target: string; targetId: string; reporterId: string | null }[], db: Db): Promise<Map<string, Context>> {
  const out = new Map<string, Context>();
  const messageIds = ofIds(rows, "message");
  const personIds = ofIds(rows, "person");
  const chatIds = ofIds(rows, "chat");
  const jobIds = ofIds(rows, "job");
  const [msgs, people, chats, jobRows] = await Promise.all([
    messageIds.length
      ? db
          .select({ id: messages.id, body: messages.body, senderId: messages.senderId, org: organizations.name, ...nameColumns })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .leftJoin(organizations, eq(organizations.id, conversations.orgId))
          .leftJoin(users, eq(users.id, messages.senderId))
          .where(inArray(messages.id, messageIds))
      : [],
    personIds.length ? db.select({ id: users.id, ...nameColumns }).from(users).where(inArray(users.id, personIds)) : [],
    chatIds.length
      ? db
          .select({ id: conversations.id, org: organizations.name })
          .from(conversations)
          .leftJoin(organizations, eq(organizations.id, conversations.orgId))
          .where(inArray(conversations.id, chatIds))
      : [],
    jobIds.length
      ? db.select({ id: jobs.id, title: jobs.title, org: organizations.name }).from(jobs).innerJoin(organizations, eq(organizations.id, jobs.orgId)).where(inArray(jobs.id, jobIds))
      : [],
  ]);
  for (const m of msgs) {
    // A company message whose writer's account has gone stays the company team's.
    const from = m.senderId ? nameOf(m) : m.org ? "the company team" : GONE;
    out.set(m.id, { label: `Message from ${from}${m.org ? ` at ${m.org}` : ""}`, text: m.body });
  }
  for (const p of people) out.set(p.id, { label: `Person: ${nameOf(p)}`, text: null });
  // A chat without a company is a direct chat: named by the other people in it, as the reporter sees it.
  const direct = chats.filter((c) => !c.org).map((c) => c.id);
  const others = direct.length
    ? await db
        .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId, ...nameColumns })
        .from(conversationMembers)
        .innerJoin(users, eq(users.id, conversationMembers.userId))
        .where(and(inArray(conversationMembers.conversationId, direct), eq(conversationMembers.role, "member")))
    : [];
  for (const c of chats) {
    if (c.org) {
      out.set(c.id, { label: `Chat with ${c.org}`, text: null });
      continue;
    }
    const reporters = new Set(rows.filter((r) => r.target === "chat" && r.targetId === c.id).map((r) => r.reporterId));
    const names = others.filter((o) => o.conversationId === c.id && !reporters.has(o.userId)).map(nameOf);
    out.set(c.id, { label: `Chat with ${names.length ? names.join(", ") : GONE}`, text: null });
  }
  for (const j of jobRows) out.set(j.id, { label: `Job at ${j.org}`, text: j.title });
  return out;
}

/** Open reports, oldest first, at most 200, with their deadlines and what was reported. */
export async function reportsForReview(deps: ReportAdminDeps = {}): Promise<ReportReviewView[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({
      id: reports.id,
      target: reports.target,
      targetId: reports.targetId,
      reason: reports.reason,
      note: reports.note,
      createdAt: reports.createdAt,
      acknowledgedAt: reports.acknowledgedAt,
      reporterId: reports.reporterId,
      ...nameColumns,
    })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.reporterId))
    .where(eq(reports.status, "open"))
    .orderBy(asc(reports.createdAt), asc(reports.id))
    .limit(200);
  const found = await contexts(rows, db);
  return rows.map((r) => {
    const { acknowledgeBy, decideBy } = reportDeadlines(r.reason as ReportReason, r.createdAt);
    return reportReviewView.parse({
      id: r.id,
      reason: REPORT_REASON_LABELS[r.reason as ReportReason],
      what: WHAT[r.target],
      reportedAt: r.createdAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      acknowledgeBy: acknowledgeBy.toISOString(),
      decideBy: decideBy.toISOString(),
      reporter: r.reporterId ? nameOf(r) : GONE,
      note: r.note,
      context: found.get(r.targetId) ?? null,
    });
  });
}

export const REPORT_REVIEW_TEXT = {
  invalid: "That didn't work. Reload the page and try again.",
  not_found: "That report isn't open any more. Reload the page to see the latest.",
  acknowledge: "Acknowledged. It stays on the list until you decide.",
  already: "It was already acknowledged.",
  actioned: "Marked as action taken. It leaves the list.",
  dismissed: "Dismissed. It leaves the list.",
} as const;

/**
 * Acknowledges, closes as action taken, or dismisses one open report for the admin with this user id. Closing also
 * acknowledges it if that hadn't happened. One audit line: admin:<id>, report_<decision> and report:<id>.
 */
export async function reviewReport(adminUserId: string, input: unknown, deps: ReportAdminDeps = {}): Promise<ReportReviewResult> {
  const parsed = reportReviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: REPORT_REVIEW_TEXT.invalid };
  const { reportId, decision } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const result = await db.transaction(async (tx): Promise<ReportReviewResult & { changed?: boolean }> => {
    const [open] = await tx
      .select({ acknowledgedAt: reports.acknowledgedAt })
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.status, "open")))
      .for("update");
    if (!open) return { ok: false, message: REPORT_REVIEW_TEXT.not_found };
    if (decision === "acknowledge") {
      if (open.acknowledgedAt) return { ok: true, message: REPORT_REVIEW_TEXT.already, changed: false };
      await tx.update(reports).set({ acknowledgedAt: now }).where(eq(reports.id, reportId));
    } else {
      await tx
        .update(reports)
        .set({ status: decision, resolvedAt: now, acknowledgedAt: open.acknowledgedAt ?? now })
        .where(eq(reports.id, reportId));
    }
    await tx.insert(auditLogs).values({ actor: `admin:${adminUserId}`, action: decision === "acknowledge" ? "report_acknowledged" : `report_${decision}`, target: `report:${reportId}` });
    return { ok: true, message: REPORT_REVIEW_TEXT[decision], changed: true };
  });
  logEvent("info", "report_reviewed", { decision, outcome: result.ok ? (result.changed ? "changed" : "unchanged") : "not_open" });
  return { ok: result.ok, message: result.message };
}
