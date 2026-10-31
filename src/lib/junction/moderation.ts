import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import {
  auditLogs,
  grievanceIntake,
  interests,
  junctionAppeals,
  junctionComments,
  junctionPostInterests,
  junctionPosts,
  junctionRemovals,
  reports,
  users,
  type JunctionSnapshot,
} from "@/db/schema";
import { shortName } from "@/lib/account/name";
import { adminEmails } from "@/lib/admin/access";
import { REPORT_REASON_LABELS } from "@/lib/inbox/types";
import { logEvent } from "@/lib/log";
import { notify } from "@/lib/notifications/store";
import { JUNCTION_REPORT_REASON_LABELS, type JunctionReportReason, type RemovalCause } from "@/lib/schemas/constants";
import type { ReportReason, ReportTarget } from "@/lib/schemas/inbox";
import {
  appealDecisionInput,
  appealInput,
  intakeInput,
  junctionReportInput,
  legalHoldInput,
  type AppealView,
  type HiddenJunctionView,
  type JunctionResult,
  type RemovalNotice,
} from "@/lib/schemas/junction";
import { DAY_MS, deadlinesFor, REMOVAL_KEEP_DAYS, JUNCTION_DELETED_KEEP_DAYS, JUNCTION_RECOUNT_DAYS, orderDecideBy, COUNTS_MIN_ACCOUNT_HOURS, HOUR_MS } from "@/lib/schemas/legal-timings";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { appealBy, appealDecideBy, purgeAfter, reportReference, shouldHold } from "./rules";

/*
 * Junction's moderation (docs/plans/junction-plan.md section 2; FR-61): reports on posts and comments with their
 * reference and stored deadline, the auto-hold, the admin's Hide and Unhide with a removal record, the author's notice
 * and appeal, the reporter's outcome notice, complaints and orders logged by an admin, legal holds, and the daily
 * cleanup of removal records, deleted posts and counts. Admin functions take the admin's user id from the caller, which
 * has already checked the person is an admin. Removed text is read by /admin/reports and the author only. Logs and audit
 * lines carry ids, kinds and outcomes: never a title, body, comment, note, reason or who sent a complaint.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date; env?: Record<string, string | undefined> };
type Target = "post" | "comment";

const ruleLabel = (rule: string | null | undefined): string =>
  (rule && (JUNCTION_REPORT_REASON_LABELS[rule as JunctionReportReason] ?? REPORT_REASON_LABELS[rule as ReportReason])) || "CareerMetro's rules";

/**
 * Posts and comments share the moderation columns (id, author_id, status, hidden_*), so one typed handle serves both;
 * only those columns are used through it.
 */
const tableOf = (target: Target) => (target === "post" ? junctionPosts : junctionComments) as typeof junctionPosts;

type Name = { name: string | null; firstName: string | null; lastName: string | null };
const nameColumns = { name: users.name, firstName: users.firstName, lastName: users.lastName };
const nameOf = (n: Name | null | undefined) => (n && (n.name || n.firstName) ? shortName(n) : "A deleted account");

/* Removal records -------------------------------------------------------------------------------------------------- */

/**
 * Writes the record kept under rule 3(1)(g): a copy of the post or comment as it stands, its author's id and username
 * at the time, the rule, the cause, who removed it and the open reports. Returns its id, or null when the content is
 * already gone. Run in the removal's own transaction.
 */
export async function recordRemoval(
  tx: Tx,
  r: { target: Target; targetId: string; cause: RemovalCause; rule: string | null; removedBy: string | null; reportIds: string[]; now: Date; orderRef?: string | null },
): Promise<string | null> {
  let snapshot: JunctionSnapshot;
  let authorId: string;
  if (r.target === "post") {
    const [p] = await tx
      .select({ authorId: junctionPosts.authorId, kind: junctionPosts.kind, title: junctionPosts.title, body: junctionPosts.body, link: junctionPosts.linkUrl, createdAt: junctionPosts.createdAt, editedAt: junctionPosts.editedAt })
      .from(junctionPosts)
      .where(eq(junctionPosts.id, r.targetId));
    if (!p) return null;
    const tags = await tx
      .select({ name: interests.name })
      .from(junctionPostInterests)
      .innerJoin(interests, eq(interests.id, junctionPostInterests.interestId))
      .where(eq(junctionPostInterests.postId, r.targetId))
      .orderBy(asc(interests.nameKey));
    authorId = p.authorId;
    snapshot = { kind: p.kind, title: p.title, body: p.body, link: p.link, tags: tags.map((t) => t.name), createdAt: p.createdAt.toISOString(), editedAt: p.editedAt?.toISOString() ?? null, postId: null };
  } else {
    const [c] = await tx
      .select({ authorId: junctionComments.authorId, body: junctionComments.body, postId: junctionComments.postId, createdAt: junctionComments.createdAt })
      .from(junctionComments)
      .where(eq(junctionComments.id, r.targetId));
    if (!c) return null;
    authorId = c.authorId;
    snapshot = { kind: null, title: null, body: c.body, link: null, tags: [], createdAt: c.createdAt.toISOString(), editedAt: null, postId: c.postId };
  }
  const [author] = await tx.select({ username: users.username }).from(users).where(eq(users.id, authorId));
  const [row] = await tx
    .insert(junctionRemovals)
    .values({
      target: r.target,
      targetId: r.targetId,
      authorUserId: authorId,
      authorUsername: author?.username ?? null,
      snapshot,
      rule: r.rule,
      cause: r.cause,
      removedBy: r.removedBy,
      removedAt: r.now,
      reportIds: r.reportIds,
      orderRef: r.orderRef ?? null,
      purgeAfter: purgeAfter(r.now),
    })
    .returning({ id: junctionRemovals.id });
  return row?.id ?? null;
}

/* Reports ---------------------------------------------------------------------------------------------------------- */

export const JUNCTION_REPORT_TEXT = {
  invalid: "That didn't work. Pick a reason and try again.",
  gone: "That post or comment isn't there any more.",
  self: "You can't report your own post or comment.",
  limit: "You've sent a lot of reports today. Write to the grievance officer if something else needs us.",
  unavailable: "Reports aren't available on your account right now.",
} as const;

export type JunctionReportResult =
  | { ok: true; reference: string; decideBy: string }
  | { ok: false; error: keyof typeof JUNCTION_REPORT_TEXT; message: string };

/** The author of a post or comment that is still there (not deleted). */
async function authorOf(target: Target, targetId: string, db: Db | Tx): Promise<string | null> {
  if (target === "post") {
    const [p] = await db.select({ a: junctionPosts.authorId }).from(junctionPosts).where(and(eq(junctionPosts.id, targetId), isNull(junctionPosts.deletedAt)));
    return p?.a ?? null;
  }
  const [c] = await db.select({ a: junctionComments.authorId }).from(junctionComments).where(and(eq(junctionComments.id, targetId), isNull(junctionComments.deletedAt)));
  return c?.a ?? null;
}

/** The open reports on a post or comment, with each reporter's account age, for the auto-hold. */
async function openReportsOn(target: Target, targetId: string, tx: Tx | Db, exceptReportId?: string) {
  return tx
    .select({ id: reports.id, reporterId: reports.reporterId, reason: reports.reason, reporterCreatedAt: users.createdAt })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.reporterId))
    .where(and(eq(reports.target, target), eq(reports.targetId, targetId), eq(reports.status, "open"), exceptReportId ? ne(reports.id, exceptReportId) : undefined));
}

/** Holds a visible post or comment until an admin decides, when its open reports call for it. */
async function holdIfDue(target: Target, targetId: string, tx: Tx, now: Date): Promise<boolean> {
  const open = await openReportsOn(target, targetId, tx);
  if (!shouldHold(open, now)) return false;
  const table = tableOf(target);
  const held = await tx
    .update(table)
    .set({ status: "held" })
    .where(and(eq(table.id, targetId), eq(table.status, "visible")))
    .returning({ id: table.id });
  return held.length > 0;
}

/** Admin accounts by ADMIN_EMAILS only (never the local test admin), for the new-report bell. */
async function adminIds(db: Db | Tx, env: Record<string, string | undefined>): Promise<string[]> {
  const emails = adminEmails(env);
  if (!emails.length) return [];
  const rows = await db.select({ id: users.id }).from(users).where(inArray(sql`lower(${users.email})`, emails));
  return rows.map((r) => r.id);
}

/**
 * Report a post or comment (plan section 2.4). One open report per reporter and target: asking again answers with the
 * same reference. Counts against the app-wide 20 reports a day. The reference and the decide-by time are stored on the
 * report and shown at once, as the acknowledgement. A child_safety report, or the third from settled accounts, holds the
 * content until an admin decides. Admins named in ADMIN_EMAILS get a bell notification. The person reported isn't told
 * who reported them. Logged by reason and outcome only.
 */
export async function fileJunctionReport(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionReportResult> {
  const parsed = junctionReportInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", message: JUNCTION_REPORT_TEXT.invalid };
  const r = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env;
  const out = await db.transaction(async (tx): Promise<JunctionReportResult & { held?: boolean; reportId?: string }> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`junction-report:${userId}|${r.targetId}`}))`);
    const [me] = await tx.select({ suspendedAt: users.suspendedAt, deletionRequestedAt: users.deletionRequestedAt }).from(users).where(eq(users.id, userId));
    if (!me || me.suspendedAt || me.deletionRequestedAt) return { ok: false, error: "unavailable", message: JUNCTION_REPORT_TEXT.unavailable };
    const author = await authorOf(r.target, r.targetId, tx);
    if (!author) return { ok: false, error: "gone", message: JUNCTION_REPORT_TEXT.gone };
    if (author === userId) return { ok: false, error: "self", message: JUNCTION_REPORT_TEXT.self };
    const [already] = await tx
      .select({ id: reports.id, reference: reports.reference, decideBy: reports.decideBy, reason: reports.reason, createdAt: reports.createdAt })
      .from(reports)
      .where(and(eq(reports.reporterId, userId), eq(reports.target, r.target), eq(reports.targetId, r.targetId), eq(reports.status, "open")))
      .limit(1);
    if (already) {
      const decideBy = already.decideBy ?? deadlinesFor(already.reason, already.createdAt).decideBy;
      return { ok: true, reference: already.reference ?? reportReference(already.id), decideBy: decideBy.toISOString() };
    }
    if (!(await takeShared(LIMITS.inboxReportsPerUser, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit", message: JUNCTION_REPORT_TEXT.limit };
    const id = randomUUID();
    const reference = reportReference(id);
    const { decideBy } = deadlinesFor(r.reason, now);
    await tx.insert(reports).values({ id, reporterId: userId, target: r.target, targetId: r.targetId, reason: r.reason, note: r.note || null, createdAt: now, reference, decideBy });
    const held = await holdIfDue(r.target, r.targetId, tx, now);
    for (const admin of await adminIds(tx, env)) if (admin !== userId) await notify(tx, { kind: "report_filed", userId: admin, reportId: id }, now);
    return { ok: true, reference, decideBy: decideBy.toISOString(), held, reportId: id };
  });
  logEvent("info", "junction_report", { reason: r.reason, target: r.target, outcome: out.ok ? (out.held ? "held" : "open") : out.error });
  return out.ok ? { ok: true, reference: out.reference, decideBy: out.decideBy } : out;
}

/**
 * After an admin closes a report (Action taken or Dismiss, src/lib/admin/reports.ts), in the same transaction: the
 * reporter's outcome notice, for every report target, and for a dismissed report on a held post or comment, the hold
 * lifts unless the reports still open call for it (plan section 2.5: the admin's Dismiss lifts the hold).
 */
export async function afterReportClosed(tx: Tx, report: { id: string; target: ReportTarget; targetId: string; reporterId: string | null }, decision: "actioned" | "dismissed", now: Date): Promise<void> {
  if (report.reporterId) await notify(tx, { kind: "report_decided", userId: report.reporterId, reportId: report.id }, now);
  if (decision !== "dismissed" || (report.target !== "post" && report.target !== "comment")) return;
  const target = report.target;
  const still = await openReportsOn(target, report.targetId, tx, report.id);
  if (shouldHold(still, now)) return;
  const table = tableOf(target);
  const lifted = await tx.update(table).set({ status: "visible" }).where(and(eq(table.id, report.targetId), eq(table.status, "held"))).returning({ id: table.id });
  if (lifted.length) logEvent("info", "junction_hold_lifted", { target });
}

/* Hide and Unhide (from /admin/reports, through src/lib/admin/removals.ts) ----------------------------------------- */

export type JunctionRemovalAction =
  | { action: "hide_post"; reportId: string; reason: string; rule: JunctionReportReason }
  | { action: "hide_comment"; reportId: string; reason: string; rule: JunctionReportReason }
  | { action: "unhide_post"; postId: string }
  | { action: "unhide_comment"; commentId: string };

export type JunctionRemovalOutcome = "not_open" | "no_post" | "no_comment" | "post_hidden" | "comment_hidden" | "already_hidden" | "post_unhidden" | "comment_unhidden" | "not_hidden";

/**
 * Hides the post or comment an open report points at, or shows a hidden one again (plan section 2.5). A hide needs the
 * admin's reason (kept for the record) and the rule the author's notice quotes; it writes a removal record, one audit
 * line and the author's notice. Unhide takes the post or comment itself, so it works after the report is closed; the
 * removal record stays. Neither closes the report. Run in the caller's transaction.
 */
export async function applyJunctionRemoval(tx: Tx, adminUserId: string, a: JunctionRemovalAction, now: Date): Promise<JunctionRemovalOutcome> {
  const actor = `admin:${adminUserId}`;
  if (a.action === "hide_post" || a.action === "hide_comment") {
    const target: Target = a.action === "hide_post" ? "post" : "comment";
    const [report] = await tx
      .select({ target: reports.target, targetId: reports.targetId })
      .from(reports)
      .where(and(eq(reports.id, a.reportId), eq(reports.status, "open")))
      .for("update");
    if (!report) return "not_open";
    if (report.target !== target) return target === "post" ? "no_post" : "no_comment";
    const table = tableOf(target);
    const [row] = await tx.select({ status: table.status, authorId: table.authorId }).from(table).where(eq(table.id, report.targetId)).for("update");
    if (!row) return target === "post" ? "no_post" : "no_comment";
    if (row.status === "hidden") return "already_hidden";
    await tx.update(table).set({ status: "hidden", hiddenAt: now, hiddenBy: adminUserId, hiddenReason: a.reason, hiddenRule: a.rule }).where(eq(table.id, report.targetId));
    const open = (await openReportsOn(target, report.targetId, tx)).map((x) => x.id);
    await recordRemoval(tx, { target, targetId: report.targetId, cause: "report", rule: a.rule, removedBy: adminUserId, reportIds: open, now });
    await tx.insert(auditLogs).values({ actor, action: `junction_${target}_hidden`, target: `${target}:${report.targetId}`, createdAt: now });
    await notify(
      tx,
      target === "post" ? { kind: "junction_post_hidden", userId: row.authorId, postId: report.targetId } : { kind: "junction_comment_hidden", userId: row.authorId, commentId: report.targetId },
      now,
    );
    return target === "post" ? "post_hidden" : "comment_hidden";
  }
  const target: Target = a.action === "unhide_post" ? "post" : "comment";
  const id = a.action === "unhide_post" ? a.postId : a.commentId;
  return (await unhide(tx, target, id, actor, now)) ? (target === "post" ? "post_unhidden" : "comment_unhidden") : "not_hidden";
}

/** Shows a hidden post or comment again, with one audit line. False when it wasn't hidden. */
async function unhide(tx: Tx, target: Target, id: string, actor: string, now: Date): Promise<boolean> {
  const table = tableOf(target);
  const done = await tx
    .update(table)
    .set({ status: "visible", hiddenAt: null, hiddenBy: null, hiddenReason: null, hiddenRule: null })
    .where(and(eq(table.id, id), eq(table.status, "hidden")))
    .returning({ id: table.id });
  if (!done.length) return false;
  await tx.insert(auditLogs).values({ actor, action: `junction_${target}_unhidden`, target: `${target}:${id}`, createdAt: now });
  return true;
}

/* Appeals ---------------------------------------------------------------------------------------------------------- */

export const APPEAL_TEXT = {
  invalid: "Write why, in 1 to 1,000 characters.",
  not_found: "There's nothing to appeal here.",
  late: "The 30 days to appeal this have passed. You can still write to the grievance officer.",
  already: "You've appealed this already. We'll tell you what we decide.",
  limit: "That's enough appeals for today. Try again tomorrow.",
  sent: "Appeal sent. We decide within 15 days and tell you in your notifications.",
} as const;

/**
 * The author's appeal against a removal of their own post or comment (plan section 2.6): once per removal, within 30
 * days, while it is still hidden. It lands on /admin/reports under Appeals with a 15-day deadline.
 */
export async function appealRemoval(userId: string, raw: unknown, deps: Deps = {}): Promise<JunctionResult> {
  const parsed = appealInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: APPEAL_TEXT.invalid };
  const { removalId, note } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<{ ok: boolean; key: keyof typeof APPEAL_TEXT }> => {
    const [removal] = await tx
      .select({ target: junctionRemovals.target, targetId: junctionRemovals.targetId, removedAt: junctionRemovals.removedAt, cause: junctionRemovals.cause })
      .from(junctionRemovals)
      .where(and(eq(junctionRemovals.id, removalId), eq(junctionRemovals.authorUserId, userId)))
      .for("update");
    if (!removal || removal.cause === "author_deleted_reported") return { ok: false, key: "not_found" };
    const table = tableOf(removal.target);
    const [still] = await tx.select({ status: table.status }).from(table).where(and(eq(table.id, removal.targetId), eq(table.authorId, userId), isNull(table.deletedAt)));
    if (!still || still.status !== "hidden") return { ok: false, key: "not_found" };
    if (now.getTime() > appealBy(removal.removedAt).getTime()) return { ok: false, key: "late" };
    const [existing] = await tx.select({ id: junctionAppeals.id }).from(junctionAppeals).where(eq(junctionAppeals.removalId, removalId));
    if (existing) return { ok: false, key: "already" };
    if (!(await takeShared(LIMITS.junctionAppealsPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, key: "limit" };
    await tx.insert(junctionAppeals).values({ userId, removalId, note, createdAt: now });
    return { ok: true, key: "sent" };
  });
  logEvent("info", "junction_appeal", { outcome: out.key });
  return { ok: out.ok, message: APPEAL_TEXT[out.key] };
}

export const DECISION_TEXT = {
  invalid: "Pick a decision and write the reason, up to 500 characters.",
  not_open: "That appeal isn't open any more. Reload the page to see the latest.",
  upheld: "Appeal upheld: it stays hidden. The author is told.",
  reversed: "Appeal reversed: it shows again. The author is told.",
} as const;

/**
 * An admin's decision on an open appeal: Upheld (stays hidden) or Reversed (shown again), with a reason, an audit line
 * and the author's notification. The page warns when the deciding admin is the one who hid it (with one admin in the
 * beta it can't be enforced).
 */
export async function decideAppeal(adminUserId: string, raw: unknown, deps: Deps = {}): Promise<JunctionResult> {
  const parsed = appealDecisionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: DECISION_TEXT.invalid };
  const { appealId, decision, reason } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const out = await db.transaction(async (tx): Promise<keyof typeof DECISION_TEXT> => {
    const [appeal] = await tx
      .select({ userId: junctionAppeals.userId, target: junctionRemovals.target, targetId: junctionRemovals.targetId })
      .from(junctionAppeals)
      .innerJoin(junctionRemovals, eq(junctionRemovals.id, junctionAppeals.removalId))
      .where(and(eq(junctionAppeals.id, appealId), eq(junctionAppeals.status, "open")))
      .for("update");
    if (!appeal) return "not_open";
    await tx.update(junctionAppeals).set({ status: decision, decidedBy: adminUserId, decisionReason: reason, decidedAt: now }).where(eq(junctionAppeals.id, appealId));
    const actor = `admin:${adminUserId}`;
    if (decision === "reversed") await unhide(tx, appeal.target, appeal.targetId, actor, now);
    await tx.insert(auditLogs).values({ actor, action: `junction_appeal_${decision}`, target: `appeal:${appealId}`, createdAt: now });
    if (appeal.userId) await notify(tx, { kind: "junction_appeal_decided", userId: appeal.userId, appealId }, now);
    return decision;
  });
  logEvent("info", "junction_appeal_decided", { outcome: out });
  return { ok: out !== "not_open", message: DECISION_TEXT[out] };
}

/* Complaints and orders logged by an admin ------------------------------------------------------------------------- */

export const INTAKE_TEXT = {
  invalid: "Fill in where it came from, when it arrived, who sent it and what it is about.",
  limit: "That's a lot logged today. Try again tomorrow, or tell Development.",
  logged: "Logged. It is in the list above with its deadline.",
} as const;

/**
 * "Log a complaint or order" (plan section 2.2): an emailed complaint, a court order or a government notice. It makes a
 * report (no reporter) dated when it reached us, so it sits in the one queue with its clock: a court order or government
 * notice gets ORDER_DEADLINE_HOURS, anything else its reason's deadline. Who sent it is kept on the intake row only.
 */
export async function logIntake(adminUserId: string, raw: unknown, deps: Deps = {}): Promise<JunctionResult> {
  const parsed = intakeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: INTAKE_TEXT.invalid };
  const i = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const receivedAt = new Date(i.receivedAt);
  const out = await db.transaction(async (tx): Promise<keyof typeof INTAKE_TEXT> => {
    if (!(await takeShared(LIMITS.intakePerAdminDay, adminUserId, { db: tx, now: now.getTime() }))) return "limit";
    const id = randomUUID();
    const order = i.source === "court_order" || i.source === "government_notice";
    const decideBy = order ? orderDecideBy(receivedAt) : deadlinesFor(i.reason, receivedAt).decideBy;
    await tx.insert(reports).values({ id, reporterId: null, target: i.target, targetId: i.targetId, reason: i.reason, note: null, createdAt: receivedAt, reference: reportReference(id), decideBy });
    await tx.insert(grievanceIntake).values({ source: i.source, receivedAt, fromLabel: i.fromLabel, reference: i.reference || null, target: i.target, targetId: i.targetId, reportId: id, loggedBy: adminUserId, createdAt: now });
    await tx.insert(auditLogs).values({ actor: `admin:${adminUserId}`, action: "grievance_logged", target: `report:${id}`, createdAt: now });
    return "logged";
  });
  logEvent("info", "grievance_logged", { source: i.source, target: i.target, outcome: out });
  return { ok: out === "logged", message: INTAKE_TEXT[out] };
}

/** Keeps a removal record past its REMOVAL_KEEP_DAYS because an order asks for longer, or lets it go again. One audit line. */
export async function setLegalHold(adminUserId: string, raw: unknown, deps: Deps = {}): Promise<JunctionResult> {
  const parsed = legalHoldInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't work. Reload the page and try again." };
  const { removalId, hold } = parsed.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const ok = await db.transaction(async (tx) => {
    const done = await tx.update(junctionRemovals).set({ legalHold: hold }).where(eq(junctionRemovals.id, removalId)).returning({ id: junctionRemovals.id });
    if (!done.length) return false;
    await tx.insert(auditLogs).values({ actor: `admin:${adminUserId}`, action: hold ? "removal_legal_hold_set" : "removal_legal_hold_lifted", target: `removal:${removalId}`, createdAt: now });
    return true;
  });
  logEvent("info", "removal_legal_hold", { outcome: ok ? (hold ? "set" : "lifted") : "not_found" });
  return ok
    ? { ok: true, message: hold ? "Legal hold set. The record is kept until you lift it." : `Legal hold lifted. The record goes ${REMOVAL_KEEP_DAYS} days after the removal.` }
    : { ok: false, message: "That record isn't there any more." };
}

/* What /admin/reports reads ---------------------------------------------------------------------------------------- */

export type JunctionReportContext = {
  label: string;
  text: string;
  junction: { target: Target; id: string; status: string; tags: string[]; upvotes: number; comments: number; hidden: { at: string; by: string; reason: string; rule: string } | null };
};

/** For report rows about posts or comments: what was reported, as the admin needs it to decide, keyed by target id. */
export async function junctionContexts(rows: { target: string; targetId: string }[], db: Db = getDb()): Promise<Map<string, JunctionReportContext>> {
  const out = new Map<string, JunctionReportContext>();
  const postIds = [...new Set(rows.filter((r) => r.target === "post").map((r) => r.targetId))];
  const commentIds = [...new Set(rows.filter((r) => r.target === "comment").map((r) => r.targetId))];
  const [posts, comments, tags] = await Promise.all([
    postIds.length
      ? db
          .select({ id: junctionPosts.id, title: junctionPosts.title, body: junctionPosts.body, status: junctionPosts.status, deletedAt: junctionPosts.deletedAt, upvotes: junctionPosts.upvoteCount, comments: junctionPosts.commentCount, hiddenAt: junctionPosts.hiddenAt, hiddenBy: junctionPosts.hiddenBy, hiddenReason: junctionPosts.hiddenReason, hiddenRule: junctionPosts.hiddenRule, ...nameColumns })
          .from(junctionPosts)
          .leftJoin(users, eq(users.id, junctionPosts.authorId))
          .where(inArray(junctionPosts.id, postIds))
      : [],
    commentIds.length
      ? db
          .select({ id: junctionComments.id, body: junctionComments.body, status: junctionComments.status, deletedAt: junctionComments.deletedAt, upvotes: junctionComments.upvoteCount, hiddenAt: junctionComments.hiddenAt, hiddenBy: junctionComments.hiddenBy, hiddenReason: junctionComments.hiddenReason, hiddenRule: junctionComments.hiddenRule, ...nameColumns })
          .from(junctionComments)
          .leftJoin(users, eq(users.id, junctionComments.authorId))
          .where(inArray(junctionComments.id, commentIds))
      : [],
    postIds.length
      ? db
          .select({ postId: junctionPostInterests.postId, name: interests.name })
          .from(junctionPostInterests)
          .innerJoin(interests, eq(interests.id, junctionPostInterests.interestId))
          .where(inArray(junctionPostInterests.postId, postIds))
      : [],
  ]);
  const hiders = await adminNames([...posts.map((p) => p.hiddenBy), ...comments.map((c) => c.hiddenBy)], db);
  const hidden = (at: Date | null, by: string | null, reason: string | null, rule: string | null) =>
    at ? { at: at.toISOString(), by: (by && hiders.get(by)) || "An admin", reason: reason || "No reason recorded", rule: ruleLabel(rule) } : null;
  for (const p of posts) {
    const gone = p.deletedAt ? " (deleted by its author)" : "";
    out.set(p.id, {
      label: `Post by ${nameOf(p)}${gone}`,
      text: `${p.title}${p.body ? `\n\n${p.body}` : ""}`.slice(0, 4000),
      junction: { target: "post", id: p.id, status: p.status, tags: tags.filter((t) => t.postId === p.id).map((t) => t.name), upvotes: p.upvotes, comments: p.comments, hidden: hidden(p.hiddenAt, p.hiddenBy, p.hiddenReason, p.hiddenRule) },
    });
  }
  for (const c of comments) {
    const gone = c.deletedAt ? " (deleted by its author)" : "";
    out.set(c.id, {
      label: `Comment by ${nameOf(c)}${gone}`,
      text: c.body.slice(0, 4000),
      junction: { target: "comment", id: c.id, status: c.status, tags: [], upvotes: c.upvotes, comments: 0, hidden: hidden(c.hiddenAt, c.hiddenBy, c.hiddenReason, c.hiddenRule) },
    });
  }
  return out;
}

async function adminNames(ids: (string | null)[], db: Db): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const rows = wanted.length ? await db.select({ id: users.id, ...nameColumns }).from(users).where(inArray(users.id, wanted)) : [];
  return new Map(rows.map((r) => [r.id, nameOf(r)]));
}

/** Open appeals, oldest first, at most 100, with the removed text and the 15-day deadline. */
export async function appealsForReview(adminUserId: string, db: Db = getDb()): Promise<AppealView[]> {
  const rows = await db
    .select({
      id: junctionAppeals.id,
      removalId: junctionRemovals.id,
      what: junctionRemovals.target,
      snapshot: junctionRemovals.snapshot,
      rule: junctionRemovals.rule,
      removedAt: junctionRemovals.removedAt,
      removedBy: junctionRemovals.removedBy,
      note: junctionAppeals.note,
      appealedAt: junctionAppeals.createdAt,
      ...nameColumns,
    })
    .from(junctionAppeals)
    .innerJoin(junctionRemovals, eq(junctionRemovals.id, junctionAppeals.removalId))
    .leftJoin(users, eq(users.id, junctionAppeals.userId))
    .where(eq(junctionAppeals.status, "open"))
    .orderBy(asc(junctionAppeals.createdAt), asc(junctionAppeals.id))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    removalId: r.removalId,
    what: r.what,
    label: `${r.what === "post" ? "Post" : "Comment"} by ${nameOf(r)}`,
    title: r.snapshot.title,
    text: r.snapshot.body.slice(0, 4000),
    rule: ruleLabel(r.rule),
    removedAt: r.removedAt.toISOString(),
    removedByYou: r.removedBy === adminUserId,
    note: r.note,
    appealedAt: r.appealedAt.toISOString(),
    decideBy: appealDecideBy(r.appealedAt).toISOString(),
  }));
}

/** Hidden posts and comments in force, newest first, at most 100 each, with their newest removal record's legal hold. */
export async function hiddenJunctionInForce(db: Db = getDb()): Promise<HiddenJunctionView[]> {
  const [posts, comments] = await Promise.all([
    db
      .select({ id: junctionPosts.id, title: junctionPosts.title, body: junctionPosts.body, hiddenAt: junctionPosts.hiddenAt, hiddenBy: junctionPosts.hiddenBy, hiddenReason: junctionPosts.hiddenReason, hiddenRule: junctionPosts.hiddenRule, ...nameColumns })
      .from(junctionPosts)
      .leftJoin(users, eq(users.id, junctionPosts.authorId))
      .where(eq(junctionPosts.status, "hidden"))
      .orderBy(desc(junctionPosts.hiddenAt))
      .limit(100),
    db
      .select({ id: junctionComments.id, body: junctionComments.body, hiddenAt: junctionComments.hiddenAt, hiddenBy: junctionComments.hiddenBy, hiddenReason: junctionComments.hiddenReason, hiddenRule: junctionComments.hiddenRule, ...nameColumns })
      .from(junctionComments)
      .leftJoin(users, eq(users.id, junctionComments.authorId))
      .where(eq(junctionComments.status, "hidden"))
      .orderBy(desc(junctionComments.hiddenAt))
      .limit(100),
  ]);
  const ids = [...posts.map((p) => p.id), ...comments.map((c) => c.id)];
  const [hiders, records] = await Promise.all([
    adminNames([...posts.map((p) => p.hiddenBy), ...comments.map((c) => c.hiddenBy)], db),
    ids.length
      ? db
          .select({ id: junctionRemovals.id, targetId: junctionRemovals.targetId, legalHold: junctionRemovals.legalHold, purgeAfter: junctionRemovals.purgeAfter })
          .from(junctionRemovals)
          .where(and(inArray(junctionRemovals.targetId, ids), eq(junctionRemovals.cause, "report")))
          .orderBy(desc(junctionRemovals.removedAt))
      : [],
  ]);
  const view = (what: Target, id: string, title: string | null, text: string, n: Name, at: Date | null, by: string | null, reason: string | null, rule: string | null): HiddenJunctionView => {
    const record = records.find((r) => r.targetId === id);
    return {
      id,
      what,
      label: `${what === "post" ? "Post" : "Comment"} by ${nameOf(n)}`,
      title,
      text: text.slice(0, 4000),
      hidden: { at: (at ?? new Date(0)).toISOString(), by: (by && hiders.get(by)) || "An admin", reason: reason || "No reason recorded", rule: ruleLabel(rule) },
      removalId: record?.id ?? null,
      legalHold: record?.legalHold ?? false,
      purgeAfter: record?.purgeAfter.toISOString() ?? null,
    };
  };
  return [
    ...posts.map((p) => view("post", p.id, p.title, p.body, p, p.hiddenAt, p.hiddenBy, p.hiddenReason, p.hiddenRule)),
    ...comments.map((c) => view("comment", c.id, null, c.body, c, c.hiddenAt, c.hiddenBy, c.hiddenReason, c.hiddenRule)),
  ];
}

/* What the author reads -------------------------------------------------------------------------------------------- */

/**
 * The notices on the person's own hidden posts and comments (plan section 2.6), newest first: the rule, when, the appeal
 * window and any appeal. For /junction/mine (part 3). Their own content only.
 */
export async function removalNoticesFor(userId: string, db: Db = getDb(), now = new Date()): Promise<RemovalNotice[]> {
  const rows = await db
    .select({
      removalId: junctionRemovals.id,
      target: junctionRemovals.target,
      targetId: junctionRemovals.targetId,
      rule: junctionRemovals.rule,
      removedAt: junctionRemovals.removedAt,
      appealStatus: junctionAppeals.status,
      decidedAt: junctionAppeals.decidedAt,
    })
    .from(junctionRemovals)
    .leftJoin(junctionAppeals, eq(junctionAppeals.removalId, junctionRemovals.id))
    .where(and(eq(junctionRemovals.authorUserId, userId), ne(junctionRemovals.cause, "author_deleted_reported")))
    .orderBy(desc(junctionRemovals.removedAt))
    .limit(100);
  const postIds = rows.filter((r) => r.target === "post").map((r) => r.targetId);
  const commentIds = rows.filter((r) => r.target === "comment").map((r) => r.targetId);
  const [hiddenPosts, hiddenComments] = await Promise.all([
    postIds.length ? db.select({ id: junctionPosts.id }).from(junctionPosts).where(and(inArray(junctionPosts.id, postIds), eq(junctionPosts.status, "hidden"), isNull(junctionPosts.deletedAt))) : [],
    commentIds.length ? db.select({ id: junctionComments.id }).from(junctionComments).where(and(inArray(junctionComments.id, commentIds), eq(junctionComments.status, "hidden"), isNull(junctionComments.deletedAt))) : [],
  ]);
  const stillHidden = new Set([...hiddenPosts, ...hiddenComments].map((x) => x.id));
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    // The newest record per post or comment, and only while it is still hidden or an appeal is on it.
    if (seen.has(r.targetId)) return [];
    seen.add(r.targetId);
    if (!stillHidden.has(r.targetId) && !r.appealStatus) return [];
    const by = appealBy(r.removedAt);
    return [
      {
        removalId: r.removalId,
        target: r.target,
        rule: ruleLabel(r.rule),
        removedAt: r.removedAt.toISOString(),
        appealBy: by.toISOString(),
        appeal: r.appealStatus ? { status: r.appealStatus, decidedAt: r.decidedAt?.toISOString() ?? null } : null,
        canAppeal: stillHidden.has(r.targetId) && !r.appealStatus && now.getTime() <= by.getTime(),
      },
    ];
  });
}

/* Daily cleanup (api/cron/cleanup) --------------------------------------------------------------------------------- */

/**
 * Removal records past `purge_after` without a legal hold; posts and comments their authors deleted more than 30 days
 * ago (cascade takes their comments, votes, reshares, saves, pins and tags); and the counts on posts from the last 8
 * days, recomputed. Counts only.
 */
export async function clearJunctionRecords(db: Db = getDb(), now = new Date()): Promise<Record<string, number>> {
  const before = new Date(now.getTime() - JUNCTION_DELETED_KEEP_DAYS * DAY_MS);
  const removals = await db
    .delete(junctionRemovals)
    .where(and(lt(junctionRemovals.purgeAfter, now), eq(junctionRemovals.legalHold, false)))
    .returning({ id: junctionRemovals.id });
  const comments = await db.delete(junctionComments).where(lt(junctionComments.deletedAt, before)).returning({ postId: junctionComments.postId });
  const posts = await db.delete(junctionPosts).where(lt(junctionPosts.deletedAt, before)).returning({ id: junctionPosts.id });
  const fixed = await recountPosts(db, { since: new Date(now.getTime() - JUNCTION_RECOUNT_DAYS * DAY_MS) }, now);
  if (fixed) logEvent("info", "junction_counts_fixed", { count: fixed });
  return { removalRecordsDeleted: removals.length, junctionPostsDeleted: posts.length, junctionCommentsDeleted: comments.length, junctionCountsFixed: fixed };
}

/**
 * Recomputes the counts and Top points of the given posts, or of every post since a time, from their rows (the rule
 * in countsFor, src/lib/junction/rules.ts). Returns how many were wrong.
 */
export async function recountPosts(db: Db | Tx, which: { ids?: string[]; since?: Date }, now: Date): Promise<number> {
  if (which.ids && !which.ids.length) return 0;
  const settled = new Date(now.getTime() - COUNTS_MIN_ACCOUNT_HOURS * HOUR_MS).toISOString();
  const scope = which.ids
    ? sql`p2.id in (${sql.join(which.ids.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql`p2.created_at >= ${(which.since ?? now).toISOString()}::timestamptz`;
  // Only other people's actions count in Top, from accounts a day old or more that aren't being deleted.
  const counted = (alias: string, column: string) =>
    sql.raw(`join users u on u.id = ${alias}.${column} where ${alias}.post_id = p2.id and ${alias}.${column} <> p2.author_id and u.deletion_requested_at is null`);
  const rows = await db.execute<{ id: string }>(sql`
    update junction_posts p set upvote_count = c.up, comment_count = c.cm, reshare_count = c.rs, top_points = c.tp
    from (
      select p2.id,
        (select count(*) from junction_votes v where v.post_id = p2.id)::int as up,
        (select count(*) from junction_comments jc where jc.post_id = p2.id and jc.deleted_at is null)::int as cm,
        (select count(*) from junction_reshares r where r.post_id = p2.id)::int as rs,
        ((select count(*) from junction_votes v ${counted("v", "user_id")} and u.created_at <= ${settled}::timestamptz)
          + 2 * (select count(distinct jc.author_id) from junction_comments jc ${counted("jc", "author_id")} and u.created_at <= ${settled}::timestamptz and jc.deleted_at is null)
          + 3 * (select count(*) from junction_reshares r ${counted("r", "user_id")} and u.created_at <= ${settled}::timestamptz))::int as tp
      from junction_posts p2
      where ${scope}
    ) c
    where p.id = c.id and (p.upvote_count, p.comment_count, p.reshare_count, p.top_points) is distinct from (c.up, c.cm, c.rs, c.tp)
    returning p.id`);
  return Array.from(rows as unknown as { id: string }[]).length;
}

/* Account delete (src/lib/account/delete.ts) ----------------------------------------------------------------------- */

/**
 * Before an account is purged, in its transaction: the posts of others whose counts it touched (its votes, comments and
 * reshares), to recount after the delete; and a removal record for each of its posts and comments with an open report,
 * so a complaint outlives the account (plan section 2.7). The cascade then removes its posts, comments, votes, saves,
 * reshares and pins; reports and appeals stay with the person set null.
 */
export async function beforeAccountPurge(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const touched = await tx.execute<{ id: string }>(sql`
    select distinct post_id as id from (
      select post_id from junction_votes where user_id = ${userId}
      union select post_id from junction_comments where author_id = ${userId}
      union select post_id from junction_reshares where user_id = ${userId}
    ) t join junction_posts p on p.id = t.post_id where p.author_id <> ${userId}`);
  const reported = await tx
    .select({ target: reports.target, targetId: reports.targetId, id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.status, "open"),
        or(
          and(eq(reports.target, "post"), sql`${reports.targetId} in (select id from junction_posts where author_id = ${userId})`),
          and(eq(reports.target, "comment"), sql`${reports.targetId} in (select id from junction_comments where author_id = ${userId})`),
        ),
      ),
    );
  const byTarget = new Map<string, { target: Target; ids: string[] }>();
  for (const r of reported) {
    const t = r.target as Target;
    const entry = byTarget.get(r.targetId) ?? { target: t, ids: [] };
    entry.ids.push(r.id);
    byTarget.set(r.targetId, entry);
  }
  for (const [targetId, { target, ids }] of byTarget) await recordRemoval(tx, { target, targetId, cause: "author_deleted_reported", rule: null, removedBy: null, reportIds: ids, now });
  return Array.from(touched as unknown as { id: string }[]).map((r) => r.id);
}

/* Download your data (export version 40) --------------------------------------------------------------------------- */

/**
 * The person's own Junction data: their posts (text, tags, link, counts, status and any hidden notice), their comments,
 * the posts they voted on, saved and reshared, their pins, their appeals with the decisions, and the snapshots in
 * removal records of their own content. Other people's comments are left out; their count is on each post.
 */
export async function exportJunction(userId: string, db: Db = getDb()) {
  const [posts, comments, votes, saves, reshares, pins, appeals, removals] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select p.id, p.kind, p.title, p.body, p.link_url as link, p.route_slug as route, p.status, p.hidden_rule as hidden_rule,
        p.upvote_count as upvotes, p.comment_count as comments, p.reshare_count as reshares, p.created_at, p.edited_at, p.deleted_at,
        coalesce((select array_agg(i.name order by i.name_key) from junction_post_interests pi join interests i on i.id = pi.interest_id where pi.post_id = p.id), '{}') as tags
      from junction_posts p where p.author_id = ${userId} order by p.created_at`),
    db
      .select({ id: junctionComments.id, postId: junctionComments.postId, body: junctionComments.body, status: junctionComments.status, createdAt: junctionComments.createdAt, deletedAt: junctionComments.deletedAt })
      .from(junctionComments)
      .where(eq(junctionComments.authorId, userId))
      .orderBy(asc(junctionComments.createdAt)),
    db.execute<{ post_id: string }>(sql`select post_id from junction_votes where user_id = ${userId} order by created_at`),
    db.execute<{ post_id: string }>(sql`select post_id from junction_saves where user_id = ${userId} order by created_at`),
    db.execute<{ post_id: string; created_at: string }>(sql`select post_id, created_at from junction_reshares where user_id = ${userId} order by created_at`),
    db.execute<{ post_id: string; position: number }>(sql`select post_id, position from junction_pins where user_id = ${userId} order by position`),
    db
      .select({ removalId: junctionAppeals.removalId, note: junctionAppeals.note, status: junctionAppeals.status, decisionReason: junctionAppeals.decisionReason, createdAt: junctionAppeals.createdAt, decidedAt: junctionAppeals.decidedAt })
      .from(junctionAppeals)
      .where(eq(junctionAppeals.userId, userId))
      .orderBy(asc(junctionAppeals.createdAt)),
    db
      .select({ id: junctionRemovals.id, target: junctionRemovals.target, rule: junctionRemovals.rule, cause: junctionRemovals.cause, removedAt: junctionRemovals.removedAt, snapshot: junctionRemovals.snapshot })
      .from(junctionRemovals)
      .where(eq(junctionRemovals.authorUserId, userId))
      .orderBy(asc(junctionRemovals.removedAt)),
  ]);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);
  return {
    posts: Array.from(posts as unknown as Record<string, unknown>[]).map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      link: p.link,
      tags: p.tags,
      route: p.route,
      status: p.status,
      hiddenRule: p.hidden_rule ? ruleLabel(p.hidden_rule as string) : null,
      upvotes: p.upvotes,
      comments: p.comments,
      reshares: p.reshares,
      createdAt: iso(p.created_at),
      editedAt: iso(p.edited_at),
      deletedAt: iso(p.deleted_at),
    })),
    comments: comments.map((c) => ({ id: c.id, postId: c.postId, body: c.body, status: c.status, createdAt: c.createdAt.toISOString(), deletedAt: c.deletedAt?.toISOString() ?? null })),
    votedPostIds: Array.from(votes as unknown as { post_id: string }[]).map((v) => v.post_id),
    savedPostIds: Array.from(saves as unknown as { post_id: string }[]).map((v) => v.post_id),
    reshares: Array.from(reshares as unknown as { post_id: string; created_at: string }[]).map((r) => ({ postId: r.post_id, at: iso(r.created_at) })),
    pins: Array.from(pins as unknown as { post_id: string; position: number }[]).map((p) => ({ postId: p.post_id, position: p.position })),
    appeals: appeals.map((a) => ({ removalId: a.removalId, note: a.note, status: a.status, decisionReason: a.decisionReason, createdAt: a.createdAt.toISOString(), decidedAt: a.decidedAt?.toISOString() ?? null })),
    removals: removals.map((r) => ({ id: r.id, target: r.target, rule: ruleLabel(r.rule), cause: r.cause, removedAt: r.removedAt.toISOString(), snapshot: r.snapshot })),
  };
}

/** Used by tests and the account purge: posts touched, for recounting after the user row is gone. */
export const recountAfterPurge = (db: Db | Tx, ids: string[], now: Date) => recountPosts(db, { ids }, now);
