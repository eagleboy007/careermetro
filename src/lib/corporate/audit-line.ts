import "server-only";
import type { getDb } from "@/db";
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

export type AuditActor = { memberId: string } | "candidate";
export type AuditTarget = { company: string } | { member: string } | { invite: string } | { job: string } | { application: string };

const actorText = (a: AuditActor) => (a === "candidate" ? "candidate" : `member:${a.memberId}`);
const targetText = (t: AuditTarget) => {
  const [kind, id] = Object.entries(t)[0]!;
  return `${kind}:${id}`;
};

/** Writes one audit line for a company. Throws on a malformed line: that is a bug, never something a person typed. */
export async function writeAudit(db: Db | Tx, line: { orgId: string; actor: AuditActor; action: CompanyAuditAction; target: AuditTarget }, now: Date): Promise<void> {
  const row = companyAuditLine.parse({ orgId: line.orgId, actor: actorText(line.actor), action: line.action, target: targetText(line.target) });
  await db.insert(auditLogs).values({ ...row, createdAt: now });
}
