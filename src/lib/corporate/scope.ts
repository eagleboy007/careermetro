import "server-only";
import { and, eq, gt, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import type { getDb } from "@/db";
import { applications, jobTeam, users } from "@/db/schema";
import { COMPANY_ACCESS_DAYS } from "./applications-store";
import { assignedSubquery } from "./interview-reads";
import type { activeMembership } from "./store";

/*
 * Which of a company's applications one member may see now, as one SQL condition for lists and counts (Corporate
 * Messages, Interviews and the Overview). The same rules as the board and the drawer (visibleApplication): never the
 * member's own application, withdrawn ones, deleted accounts, or applications past the company's 180 days after
 * closing. Recruiter admins see every job's; Hiring HR the jobs they move candidates on; anyone, the candidates whose
 * live interview they are on while they are still on that job's team. The caller reads `me` live from org_members.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Member = NonNullable<Awaited<ReturnType<typeof activeMembership>>>;

const DAY = 86_400_000;

/** The condition, on `applications` joined to `users` (the candidate). */
export function visibleApplicationsWhere(me: Pick<Member, "orgId" | "role">, userId: string, db: Db | Tx, now: Date): SQL {
  const cutoff = new Date(now.getTime() - COMPANY_ACCESS_DAYS * DAY);
  const movesOn = db
    .select({ jobId: jobTeam.jobId })
    .from(jobTeam)
    .where(and(eq(jobTeam.userId, userId), inArray(jobTeam.role, ["owner", "hiring"])));
  const onTeam = db.select({ jobId: jobTeam.jobId }).from(jobTeam).where(eq(jobTeam.userId, userId));
  const assigned = and(inArray(applications.id, assignedSubquery(userId, db, now)), inArray(applications.jobId, onTeam));
  const scope = me.role === "admin" ? undefined : me.role === "hiring" ? or(inArray(applications.jobId, movesOn), assigned) : assigned;
  return and(
    eq(applications.orgId, me.orgId),
    ne(applications.userId, userId),
    isNull(applications.withdrawnAt),
    isNull(users.deletionRequestedAt),
    // Suspended after a report (FR-46): the company sees none of it until the suspension is lifted.
    isNull(users.suspendedAt),
    or(isNull(applications.closedAt), gt(applications.closedAt, cutoff)),
    or(isNull(applications.companyAccessEndsAt), gt(applications.companyAccessEndsAt, now)),
    scope,
  )!;
}
