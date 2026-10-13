import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { applications, auditLogs, jobs, orgInvites, orgMembers, organizations, users } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { auditPageInput, COMPANY_AUDIT_ACTIONS, COMPANY_AUDIT_LABELS, type CompanyAuditAction } from "@/lib/schemas/corporate";
import { AUDIT_PAGE_SIZE } from "@/lib/schemas/constants";
import { COMPANY_ACCESS_DAYS } from "./applications-store";
import { canManageTeam } from "./rules";
import { slotKeyOf } from "./slots";
import { activeMembership } from "./store";
import type { AuditLineView, AuditOnView, AuditWhoView, CompanyAuditView, OrgRole } from "./types";
import { formatDay } from "./format";

/*
 * The company's audit view (dev/corporate-plan.md, "Audit"; build step 7). Recruiter admins only, read from their live
 * org_members row on every request. Each line says who (a member's name and role, "the candidate", or a former
 * member), what (a fixed label) and to which job, application, member or role-in-waiting, by title or short id. A line
 * never holds anything a person typed, and this view adds no candidate's name, email, phone or anything else from
 * their profile: an application is named by its id and its job's title only. Lines about the admin's own application
 * (someone applying to their own company's job) are left out, as that application is everywhere else, and so are lines
 * about applications the company no longer sees (withdrawn, a deleted or purged account, or 180 days past closing).
 */

type Db = ReturnType<typeof getDb>;
export type AuditDeps = { db?: Db; now?: Date };
export type AuditError = "not_member" | "not_admin";
export type AuditResult<T = object> = ({ ok: true } & T) | { ok: false; error: AuditError };

export const AUDIT_ERROR_TEXT: Record<AuditError, string> = {
  not_member: "You don't have access to this company.",
  not_admin: "Only a Recruiter admin can read the company's audit.",
};

const KNOWN = new Set<string>(COMPANY_AUDIT_ACTIONS);
const short = (id: string) => id.slice(0, 8);

/** "13 Oct 2026, 15:30", India time. */
export function auditTime(at: Date): string {
  const key = slotKeyOf(at);
  return `${formatDay(key.slice(0, 10))}, ${key.slice(11, 16)}`;
}

/** "kind:id" into its parts, or null for something not written by writeAudit. */
function split(text: string): { kind: string; id: string } | null {
  const i = text.indexOf(":");
  return i > 0 ? { kind: text.slice(0, i), id: text.slice(i + 1) } : null;
}

export async function companyAudit(userId: string, raw: unknown, deps: AuditDeps = {}): Promise<AuditResult<{ view: CompanyAuditView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await activeMembership(userId, db, now);
  if (!me) return { ok: false, error: "not_member" };
  if (!canManageTeam(me.role)) return { ok: false, error: "not_admin" };
  const { before } = auditPageInput.parse(raw ?? {});
  const cutoff = new Date(now.getTime() - COMPANY_ACCESS_DAYS * 86_400_000);
  const cursor = before ? { at: new Date(before.slice(0, 24)), id: before.slice(25) } : null;

  const rows = await db
    .select({ id: auditLogs.id, actor: auditLogs.actor, action: auditLogs.action, target: auditLogs.target, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.orgId, me.orgId),
        // Compared at the cursor's precision (milliseconds), so a line is never skipped or shown twice between pages.
        cursor ? sql`(date_trunc('milliseconds', ${auditLogs.createdAt}), ${auditLogs.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)` : undefined,
        // A line about an application shows only while the company still sees that application (Testing T43, T45): not
        // the admin's own application, which they can't see from the company side, nor one withdrawn, of a deleted
        // account, or more than 180 days past closing. A positive match, so lines about an application whose row is
        // gone (an account purged after deletion) never come back as a bare short id. Lines about the team and jobs
        // stay; they hold nothing of a candidate. The application is found by its primary key, one probe per line:
        // writeAudit stores "application:<uuid>" (companyAuditLine), and the pattern guards the cast so a line that
        // somehow isn't one reads as a gone application rather than an error.
        sql`(${auditLogs.target} not like 'application:%' or exists (select 1 from ${applications} a join ${users} u on u.id = a.user_id
              where a.id = (case when ${auditLogs.target} ~ '^application:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                 then substring(${auditLogs.target} from 13)::uuid end)
                and a.org_id = ${me.orgId} and a.user_id <> ${userId}
                and a.withdrawn_at is null and u.deletion_requested_at is null
                and (a.closed_at is null or a.closed_at > ${cutoff.toISOString()}::timestamptz)
                and (a.company_access_ends_at is null or a.company_access_ends_at > ${now.toISOString()}::timestamptz)))`,
      ),
    )
    .orderBy(desc(sql`date_trunc('milliseconds', ${auditLogs.createdAt})`), desc(auditLogs.id))
    .limit(AUDIT_PAGE_SIZE + 1);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);

  // Everything a page names, read in one query per kind and only within this company.
  const ids = (kind: string, from: "actor" | "target") => [...new Set(page.map((r) => split(r[from])).filter((p) => p?.kind === kind).map((p) => p!.id))];
  const memberIds = [...new Set([...ids("member", "actor"), ...ids("member", "target")])];
  const [members, jobRows, appRows, invites, [org]] = await Promise.all([
    memberIds.length
      ? db
          .select({ id: orgMembers.id, role: orgMembers.role, name: users.name, deleted: users.deletionRequestedAt })
          .from(orgMembers)
          .innerJoin(users, eq(users.id, orgMembers.userId))
          .where(and(inArray(orgMembers.id, memberIds), eq(orgMembers.orgId, me.orgId)))
      : Promise.resolve([]),
    ids("job", "target").length
      ? db
          .select({ id: jobs.id, title: jobs.title })
          .from(jobs)
          .where(and(inArray(jobs.id, ids("job", "target")), eq(jobs.orgId, me.orgId)))
      : Promise.resolve([]),
    ids("application", "target").length
      ? db
          .select({ id: applications.id, job: jobs.title })
          .from(applications)
          .innerJoin(jobs, eq(jobs.id, applications.jobId))
          .where(and(inArray(applications.id, ids("application", "target")), eq(applications.orgId, me.orgId)))
      : Promise.resolve([]),
    ids("invite", "target").length
      ? db
          .select({ id: orgInvites.id, role: orgInvites.role, domain: orgInvites.emailDomain })
          .from(orgInvites)
          .where(and(inArray(orgInvites.id, ids("invite", "target")), eq(orgInvites.orgId, me.orgId)))
      : Promise.resolve([]),
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, me.orgId)),
  ]);
  const memberOf = new Map(members.map((m) => [m.id, m]));

  const who = (actor: string): AuditWhoView => {
    if (actor === "candidate") return { kind: "candidate" };
    if (actor === "system") return { kind: "system" };
    const m = memberOf.get(split(actor)?.id ?? "");
    // A member whose account was deleted (the row goes with it) or is being deleted.
    return m && !m.deleted ? { kind: "member", name: displayName(m.name), role: m.role } : { kind: "former" };
  };
  const on = (target: string): AuditOnView => {
    const t = split(target);
    switch (t?.kind) {
      case "member": {
        const m = memberOf.get(t.id);
        return m && !m.deleted ? { kind: "member", name: displayName(m.name), role: m.role } : { kind: "member", name: "A former team member", role: null };
      }
      case "invite": {
        const i = invites.find((x) => x.id === t.id);
        return { kind: "invite", role: (i?.role ?? null) as OrgRole | null, domain: i?.domain ?? null };
      }
      case "job":
        return { kind: "job", ref: short(t.id), title: jobRows.find((j) => j.id === t.id)?.title ?? null };
      case "application":
        return { kind: "application", ref: short(t.id), job: appRows.find((a) => a.id === t.id)?.job ?? null };
      default:
        return { kind: "company", name: org?.name ?? "" };
    }
  };
  const lines: AuditLineView[] = page.map((r) => ({
    id: r.id,
    at: auditTime(r.createdAt),
    who: who(r.actor),
    action: KNOWN.has(r.action) ? COMPANY_AUDIT_LABELS[r.action as CompanyAuditAction] : "Other action",
    on: on(r.target),
  }));
  const last = page[page.length - 1];
  return {
    ok: true,
    view: { company: org?.name ?? me.orgName, lines, next: rows.length > AUDIT_PAGE_SIZE && last ? `${last.createdAt.toISOString()}_${last.id}` : null },
  };
}
