import "server-only";
import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, jobEmailChecks, organizations, users } from "@/db/schema";
import { CODE_ERROR_TEXT, workEmailReady } from "@/lib/corporate/codes";
import { codeDelivery } from "@/lib/corporate/delivery";
import { checkWorkEmail, workEmailProblemText } from "@/lib/corporate/domains";
import { issueCode, NOT_SENT_TEXT, useCode, type CorporateDeps } from "@/lib/corporate/store";
import { currentAnalysis } from "@/lib/gaps/current";
import { logEvent } from "@/lib/log";
import { getResumeForOwner } from "@/lib/resume/store";
import { jobEmailCheckReview } from "@/lib/schemas/admin";
import { joinFinish, joinStart } from "@/lib/schemas/corporate";
import { currentJobs } from "@/lib/profile/employer";
import type { Profile } from "@/lib/schemas";
import { baseDomain, domainAndParents, jobKeyOf, jobToCheck, onVerifiedCompanyDomain, type JobCheckRow, type JobKey } from "./job-check-rules";

/*
 * The work-email check of a person's current job (FR-47, handoff 12d, dev/current-job-check-plan.md). The person types
 * their email at the company on their current job, gets a 6-digit code there (the same codes, limits and lock as the
 * company work-email step: 3 an hour, 10 a day, 20 a day per registered domain), and a right code saves the check:
 * "verified" when the domain is that of a company CareerMetro verified under the employer's name, else "review" until
 * an admin looks. Only the domain is kept; the
 * address leaves with the code. Nothing here logs an email, a domain or a company name.
 */

type Db = ReturnType<typeof getDb>;

export type JobCheckError = "not_set_up" | "closed" | "no_job" | "invalid" | "limit" | "not_sent" | "locked" | "wrong" | "expired" | "none";

export const JOB_CHECK_ERROR_TEXT: Record<JobCheckError, string> = {
  not_set_up: "Work-email checks open soon.",
  closed: "Work-email checks open soon.",
  no_job: "Add your current job to your resume first. Freelance and self-employed work doesn't need a check.",
  invalid: "Check your work email. It looks incomplete.",
  limit: "You've asked for a lot of codes. Try again in an hour.",
  not_sent: NOT_SENT_TEXT,
  ...CODE_ERROR_TEXT,
};

export type JobCheckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (error: JobCheckError, message?: string) => ({ ok: false as const, error: message ?? JOB_CHECK_ERROR_TEXT[error] });

/** Whether this deployment can send a code for the check: off in production until the email sender is set up. */
export const jobCheckOpen = (deps: CorporateDeps = {}): boolean => workEmailReady(deps.env ?? process.env) && (deps.delivery ?? codeDelivery(deps.env)) !== "off";

/** The job a work email checks for this person now, from their current confirmed profile. */
async function checkedJob(userId: string, db: Db): Promise<JobKey | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const resume = await getResumeForOwner(analysis.resumeId, { userId }, db);
  return jobToCheck(resume?.profile ?? null);
}

/** "Send code": checks the address (free mail is refused) and sends a code to it. */
export async function startJobCheck(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<JobCheckResult<{ testCode?: string }>> {
  if (!workEmailReady(deps.env ?? process.env)) return fail("not_set_up");
  const db = deps.db ?? getDb();
  const parsed = joinStart.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const email = checkWorkEmail(parsed.data.workEmail);
  if (!email.ok) return fail("invalid", workEmailProblemText(email.problem));
  if (!(await checkedJob(userId, db))) return fail("no_job");
  // Subdomains of one company share its daily count (T66).
  const sent = await issueCode(userId, { email: parsed.data.workEmail, domain: email.domain, orgId: null, limitDomain: baseDomain(email.domain) }, deps, "current_job");
  if (!sent.ok) return fail(sent.error === "closed" || sent.error === "locked" || sent.error === "not_sent" ? sent.error : "limit");
  return sent.testCode ? { ok: true, testCode: sent.testCode } : { ok: true };
}

/**
 * "Confirm": a right code saves the check for the job on the profile now. If the company or start date changed since
 * the code was sent, it is saved for the new job: the person typed their current email either way. A wrong code counts.
 */
export async function finishJobCheck(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<JobCheckResult<{ status: "verified" | "review" }>> {
  if (!workEmailReady(deps.env ?? process.env)) return fail("not_set_up");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = joinFinish.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const email = checkWorkEmail(parsed.data.workEmail);
  if (!email.ok) return fail("invalid", workEmailProblemText(email.problem));
  const job = await checkedJob(userId, db);
  if (!job) return fail("no_job");
  return db.transaction(async (tx) => {
    const refused = await useCode(userId, { email: parsed.data.workEmail, orgId: null }, parsed.data.code, tx, deps, "current_job");
    if (refused) return fail(refused === "wrong" || refused === "expired" || refused === "locked" ? refused : "none");
    const status = onVerifiedCompanyDomain(email.domain, job.employer, await verifiedCompaniesOn(email.domain, tx)) ? "verified" : "review";
    await tx
      .insert(jobEmailChecks)
      .values({ userId, ...job, domain: email.domain, status, checkedAt: now })
      .onConflictDoUpdate({
        target: [jobEmailChecks.userId, jobEmailChecks.employerKey, jobEmailChecks.startMonth],
        set: { employer: job.employer, domain: email.domain, status, checkedAt: now, reviewedBy: null, reviewedAt: null },
      });
    logEvent("info", "job_email_checked", { status });
    return { ok: true as const, status };
  });
}

/** The saved checks of these people, for their profiles. */
export async function jobChecksFor(userIds: string[], db: Pick<Db, "select"> = getDb()): Promise<Map<string, JobCheckRow[]>> {
  const out = new Map<string, JobCheckRow[]>();
  if (!userIds.length) return out;
  const rows = await db
    .select({ userId: jobEmailChecks.userId, employerKey: jobEmailChecks.employerKey, startMonth: jobEmailChecks.startMonth, status: jobEmailChecks.status, checkedAt: jobEmailChecks.checkedAt })
    .from(jobEmailChecks)
    .where(inArray(jobEmailChecks.userId, userIds));
  for (const { userId, ...row } of rows) out.set(userId, [...(out.get(userId) ?? []), row]);
  return out;
}

/**
 * Companies CareerMetro verified (their domain proved by a code and checked by hand) whose email domain is this domain
 * or a parent of it. Only these let a check pass without an admin (T53).
 */
async function verifiedCompaniesOn(domain: string, db: Pick<Db, "select">) {
  const rows = await db
    .select({ emailDomain: organizations.emailDomain, name: organizations.name, legalName: organizations.legalName })
    .from(organizations)
    .where(and(inArray(organizations.emailDomain, domainAndParents(domain)), eq(organizations.reviewStatus, "verified"), isNotNull(organizations.domainVerifiedAt)));
  return rows.flatMap((r) => (r.emailDomain ? [{ emailDomain: r.emailDomain, names: [r.name, r.legalName] }] : []));
}

/**
 * The work-email domains that tie each person to their current employer, for keeping them out of that employer's
 * searches: a right code for the current job, whether verified or still with an admin (T55). A refused check doesn't
 * count, and neither does a check of a job they have since left (T62).
 */
export async function staffDomainsFor(people: { id: string; profile: Profile }[], db: Pick<Db, "select"> = getDb()): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!people.length) return out;
  const rows = await db
    .select({ userId: jobEmailChecks.userId, domain: jobEmailChecks.domain, employerKey: jobEmailChecks.employerKey, startMonth: jobEmailChecks.startMonth })
    .from(jobEmailChecks)
    .where(and(inArray(jobEmailChecks.userId, people.map((p) => p.id)), ne(jobEmailChecks.status, "refused")));
  const current = new Map(people.map((p) => [p.id, currentJobs(p.profile).map(jobKeyOf)]));
  for (const r of rows) {
    const jobs = current.get(r.userId) ?? [];
    if (!jobs.some((j) => j.employerKey === r.employerKey && j.startMonth === r.startMonth)) continue;
    out.set(r.userId, [...(out.get(r.userId) ?? []), r.domain]);
  }
  return out;
}

/** Download your data: each check with the employer, start month, domain, state and date. Never an address. */
export async function exportJobChecks(userId: string, db: Pick<Db, "select"> = getDb()) {
  return db
    .select({ employer: jobEmailChecks.employer, startMonth: jobEmailChecks.startMonth, domain: jobEmailChecks.domain, status: jobEmailChecks.status, checkedAt: jobEmailChecks.checkedAt })
    .from(jobEmailChecks)
    .where(eq(jobEmailChecks.userId, userId))
    .orderBy(asc(jobEmailChecks.checkedAt));
}

/* Admin review (/admin/companies) ---------------------------------------------------------------------------------- */

export type JobCheckForReview = { id: string; employer: string; domain: string; checkedAt: Date };

/** Checks whose domain didn't plainly match the company, oldest first. No person's name, email or profile. */
export async function jobChecksForReview(db: Pick<Db, "select"> = getDb()): Promise<JobCheckForReview[]> {
  return db
    .select({ id: jobEmailChecks.id, employer: jobEmailChecks.employer, domain: jobEmailChecks.domain, checkedAt: jobEmailChecks.checkedAt })
    .from(jobEmailChecks)
    .where(eq(jobEmailChecks.status, "review"))
    .orderBy(asc(jobEmailChecks.checkedAt))
    .limit(200);
}

export type JobCheckReviewResult = { ok: boolean; message: string };

/** An admin says whether the domain belongs to the company: "verify" shows the badge, "refuse" leaves "Not verified". */
export async function reviewJobCheck(adminUserId: string, raw: unknown, deps: { db?: Db; now?: Date } = {}): Promise<JobCheckReviewResult> {
  const parsed = jobEmailCheckReview.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't work. Reload the page and try again." };
  const db = deps.db ?? getDb();
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.id, adminUserId)).limit(1);
  const status = parsed.data.decision === "verify" ? "verified" : "refused";
  const now = deps.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [done] = await tx
      .update(jobEmailChecks)
      .set({ status, reviewedBy: admin?.id ?? null, reviewedAt: now })
      .where(and(eq(jobEmailChecks.id, parsed.data.id), eq(jobEmailChecks.status, "review")))
      .returning({ employer: jobEmailChecks.employer });
    // One audit line, ids only: admin:<id>, the decision and job_email_check:<id>.
    if (done) await tx.insert(auditLogs).values({ actor: `admin:${adminUserId}`, action: `job_email_check_${status}`, target: `job_email_check:${parsed.data.id}`, createdAt: now });
    return done;
  });
  if (!row) return { ok: false, message: "That check isn't on the list any more. Reload the page to see the latest." };
  logEvent("info", "job_email_check_reviewed", { decision: parsed.data.decision });
  return { ok: true, message: status === "verified" ? `The work email for ${row.employer} is verified.` : `The work email for ${row.employer} is refused. It shows Not verified.` };
}
