import "server-only";
import type { getDb } from "@/db";
import { and, eq, gte } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { companyAuditLine, type CompanyAuditAction } from "@/lib/schemas/corporate";

/*
 * Writing a company's audit lines (dev/corporate-plan.md, "Audit"; build step 7). Each line is checked against
 * companyAuditLine before it is stored, so only ids and fixed action names ever get in: never a name, an email, a
 * phone, a note, a message or feedback. Lines are written inside the action's own transaction, so a refused or
 * rolled-back action leaves none.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A member by their org_members id, the candidate, or someone with no role yet asking for access. */
export type AuditActor = { memberId: string } | "candidate" | "requester";
export type AuditTarget = { company: string } | { member: string } | { invite: string } | { job: string } | { application: string };

const actorText = (a: AuditActor) => (typeof a === "string" ? a : `member:${a.memberId}`);
const targetText = (t: AuditTarget) => {
  const [kind, id] = Object.entries(t)[0]!;
  return `${kind}:${id}`;
};

/** Writes one audit line for a company. Throws on a malformed line: that is a bug, never something a person typed. */
export async function writeAudit(db: Db | Tx, line: { orgId: string; actor: AuditActor; action: CompanyAuditAction; target: AuditTarget }, now: Date): Promise<void> {
  const row = companyAuditLine.parse({ orgId: line.orgId, actor: actorText(line.actor), action: line.action, target: targetText(line.target) });
  await db.insert(auditLogs).values({ ...row, createdAt: now });
}

const IST_MS = 330 * 60_000;
/** The start of `now`'s day in India time. */
const indiaDayStart = (now: Date) => new Date(Math.floor((now.getTime() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS);

/**
 * Writes the line unless the same actor already has one with this action and target today (India time), so reading
 * a chat again or refreshing it doesn't flood the audit. For reads only: every state change writes its own line.
 */
export async function writeAuditOncePerDay(db: Db | Tx, line: { orgId: string; actor: AuditActor; action: CompanyAuditAction; target: AuditTarget }, now: Date): Promise<void> {
  const row = companyAuditLine.parse({ orgId: line.orgId, actor: actorText(line.actor), action: line.action, target: targetText(line.target) });
  const [seen] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.orgId, row.orgId),
        gte(auditLogs.createdAt, indiaDayStart(now)),
        eq(auditLogs.actor, row.actor),
        eq(auditLogs.action, row.action),
        eq(auditLogs.target, row.target),
      ),
    )
    .limit(1);
  if (!seen) await db.insert(auditLogs).values({ ...row, createdAt: now });
}
