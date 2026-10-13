import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { applications, jobs, jobTeam, orgMembers, organizations, reports, roleProfiles, users } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { logEvent } from "@/lib/log";
import { jobInput, jobReportInput, jobStatusInput } from "@/lib/schemas/corporate";
import { JOB_STATUSES, JOB_WORK_TYPE_LABELS, JOBS_BLOCKED_TEXT } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { writeAudit } from "./audit-line";
import { certificateOptions, criteriaNames, unknownCertificates } from "./criteria";
import { requirementNames, roleBySlug, roleOptions, skillOptions, unknownSkills } from "./job-content";
import { canEditJob, canMoveApplications, canPostJobs, isLive, jobsBlocked, openRefusal, statusMoveRefusal, type OrgForJobs } from "./rules";
import { activeMembership, liveAdminCount } from "./store";
import type { JobFormData, JobFormValues, JobsBlocked, JobStatus, JobsView, JobTeamRole, PostedJobView } from "./types";

/*
 * Jobs (dev/corporate-plan.md build step 3; handoff 12g). Like the rest of Corporate, every function takes the signed-
 * in person's id and reads their live `org_members` row and role itself, so a removed role stops them at once. A job
 * asks only for skills in our taxonomy; the model never writes one. Logs carry event names and reasons only.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type JobDeps = { db?: Db; now?: Date };

export type JobError =
  | "invalid"
  | "not_member"
  | "not_allowed"
  | "not_found"
  | "unknown_role"
  | "unknown_skill"
  | "unknown_certificate"
  | "not_colleague"
  | "limit"
  | "bad_move"
  | "open_from_form"
  | "needs_required"
  | JobsBlocked;

export const JOB_ERROR_TEXT: Record<JobError, string> = {
  invalid: "Check the details and try again.",
  not_member: "You don't have access to this company.",
  not_allowed: "Only Recruiter admins, and Hiring HR on this job, can change it.",
  not_found: "That job isn't available any more.",
  unknown_role: "Pick one of the role profiles.",
  unknown_skill: "Pick skills from the list.",
  unknown_certificate: "Pick certificates from the list.",
  not_colleague: "Pick people from your company's team. Interviewers can't be Hiring HR on a job.",
  limit: "Your company has made a lot of jobs today. Try again tomorrow.",
  bad_move: "A closed job can't change. Post a new one instead.",
  open_from_form: "Open a draft from its form, after the three checks.",
  needs_required: "Add at least one required skill before opening the job.",
  ...JOBS_BLOCKED_TEXT,
};

export type JobResult<T = object> = ({ ok: true } & T) | { ok: false; error: JobError; message?: string };

const fail = (error: JobError, message?: string) => ({ ok: false as const, error, ...(message ? { message } : {}) });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const AUDIT_ACTION = { open: "job_opened", paused: "job_paused", closed: "job_closed", edited: "job_edited" } as const;

type Member = NonNullable<Awaited<ReturnType<typeof activeMembership>>>;

/** The company facts the open rule needs, read live. */
async function orgFacts(orgId: string, db: Db | Tx): Promise<OrgForJobs & { name: string }> {
  const [org] = await db
    .select({ name: organizations.name, reviewStatus: organizations.reviewStatus, secondAdminDueAt: organizations.secondAdminDueAt })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return { ...org, adminCount: await liveAdminCount(orgId, db) };
}

/** The person's place on a job's team, or null. */
async function teamRoleOf(jobId: string, userId: string, db: Db | Tx): Promise<JobTeamRole | null> {
  const [row] = await db.select({ role: jobTeam.role }).from(jobTeam).where(and(eq(jobTeam.jobId, jobId), eq(jobTeam.userId, userId)));
  return row?.role ?? null;
}

/** A job of the person's company that they may change, locked for the rest of the transaction. */
async function editableJob(userId: string, jobId: string, tx: Tx, now: Date) {
  const me = await activeMembership(userId, tx, now);
  if (!me) return fail("not_member");
  const [job] = await tx
    .select({ id: jobs.id, status: jobs.status, ownerId: jobs.ownerId, requirements: jobs.requirements })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.orgId, me.orgId)))
    .for("update");
  if (!job) return fail("not_found");
  if (!canEditJob(me.role, await teamRoleOf(jobId, userId, tx))) return fail("not_allowed");
  return { ok: true as const, me, job };
}

/**
 * Turns the chosen colleagues (org_members ids) into job_team rows. Each must hold an active role at this company;
 * Hiring HR on a job must be a Recruiter admin or Hiring HR. Someone picked for both is Hiring HR. The owner
 * and the person saving are already on the team (or stay as they are) and are left out.
 */
async function teamRows(me: Member, picked: { hiring: string[]; interviewers: string[] }, keep: (string | null)[], jobId: string | null, tx: Tx, now: Date) {
  const ids = [...new Set([...picked.hiring, ...picked.interviewers])];
  if (!ids.length) return { ok: true as const, rows: [] as { userId: string; role: JobTeamRole }[] };
  const found = await tx
    .select({ id: orgMembers.id, userId: orgMembers.userId, role: orgMembers.role, recheckDueAt: orgMembers.recheckDueAt })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(inArray(orgMembers.id, ids), eq(orgMembers.orgId, me.orgId), isNull(orgMembers.removedAt), isNull(users.deletionRequestedAt)));
  if (found.length !== ids.length) return fail("not_colleague");
  // Someone whose work-email re-check is due can stay on the job's team, but can't be newly added until they confirm it.
  const due = found.filter((m) => m.recheckDueAt <= now);
  if (due.length) {
    const onTeam = jobId
      ? new Set((await tx.select({ userId: jobTeam.userId }).from(jobTeam).where(eq(jobTeam.jobId, jobId))).map((r) => r.userId))
      : new Set<string>();
    if (due.some((m) => !onTeam.has(m.userId))) return fail("not_colleague");
  }
  const byId = new Map(found.map((m) => [m.id, m]));
  if (picked.hiring.some((id) => byId.get(id)!.role === "interviewer")) return fail("not_colleague");
  const hiring = new Set(picked.hiring);
  const rows = found
    .filter((m) => !keep.includes(m.userId))
    .map((m) => ({ userId: m.userId, role: (hiring.has(m.id) ? "hiring" : "interviewer") as JobTeamRole }));
  return { ok: true as const, rows };
}

/** The latest stored version of a role profile. Null when the content hasn't been seeded. */
async function roleRowId(slug: string, db: Db | Tx): Promise<string | null> {
  const [row] = await db.select({ id: roleProfiles.id }).from(roleProfiles).where(eq(roleProfiles.slug, slug)).orderBy(desc(roleProfiles.version)).limit(1);
  return row?.id ?? null;
}

const audit = (tx: Tx, me: Member, to: keyof typeof AUDIT_ACTION, jobId: string, now: Date) =>
  writeAudit(tx, { orgId: me.orgId, actor: { memberId: me.memberId }, action: AUDIT_ACTION[to], target: { job: jobId } }, now);

/* Writing --------------------------------------------------------------------------------------------------------- */

/**
 * Saves the Post a job form (C9): a new draft, or changes to a job that isn't closed. With the three ticks (`open`) it
 * also opens the job, if the company may open jobs now and the job asks for at least one required skill. The creator
 * is its owner; chosen colleagues join its team. Recruiter admins and Hiring HR only; Interviewers never.
 */
export async function saveJob(userId: string, raw: unknown, deps: JobDeps = {}): Promise<JobResult<{ jobId: string; status: JobStatus }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = jobInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const input = parsed.data;
  if (!roleBySlug(input.roleSlug)) return fail("unknown_role");
  if (unknownSkills(input.requirements).length) return fail("unknown_skill");
  if (unknownCertificates(input.criteria).length) return fail("unknown_certificate");

  const first = await activeMembership(userId, db, now);
  if (!first) return fail("not_member");
  if (!canPostJobs(first.role)) return fail("not_allowed");
  if (!input.jobId && !(await takeShared(LIMITS.jobsPerCompanyDay, first.orgId, { db, now: now.getTime() }))) {
    logEvent("warn", "job_create_limited");
    return fail("limit");
  }

  const result = await db.transaction(async (tx): Promise<JobResult<{ jobId: string; status: JobStatus; opened: boolean }>> => {
    let me: Member;
    let current: { id: string; status: JobStatus; ownerId: string | null } | null = null;
    if (input.jobId) {
      const found = await editableJob(userId, input.jobId, tx, now);
      if (!found.ok) return found;
      me = found.me;
      current = found.job;
      if (current.status === "closed") return fail("bad_move");
    } else {
      const m = await activeMembership(userId, tx, now);
      if (!m) return fail("not_member");
      if (!canPostJobs(m.role)) return fail("not_allowed");
      me = m;
    }
    const roleId = await roleRowId(input.roleSlug, tx);
    if (!roleId) return fail("unknown_role");
    const ownerId = current ? current.ownerId : userId;
    const team = await teamRows(me, input, [ownerId, userId], current?.id ?? null, tx, now);
    if (!team.ok) return team;

    const from: JobStatus = current?.status ?? "draft";
    let status = from;
    if (input.open && from !== "open") {
      const refusal = openRefusal(await orgFacts(me.orgId, tx), input.requirements, now);
      if (refusal) return fail(refusal);
      status = "open";
    }
    // A job that stays open must still ask for a required skill (opening checks it; an edit must not undo it).
    if (status === "open" && input.requirements.required.length === 0) return fail("needs_required");
    const fields = { roleProfileId: roleId, title: input.title, workType: input.workType, city: input.city, requirements: input.requirements, criteria: input.criteria, status };
    let jobId: string;
    if (current) {
      jobId = current.id;
      await tx.update(jobs).set(fields).where(eq(jobs.id, jobId));
      // The form doesn't list the person editing, so their own place on the team stays as it is.
      await tx.delete(jobTeam).where(and(eq(jobTeam.jobId, jobId), ne(jobTeam.role, "owner"), ne(jobTeam.userId, userId)));
    } else {
      const [row] = await tx.insert(jobs).values({ ...fields, orgId: me.orgId, ownerId: userId, createdAt: now }).returning({ id: jobs.id });
      jobId = row.id;
      await tx.insert(jobTeam).values({ jobId, userId, role: "owner" });
    }
    if (team.rows.length) await tx.insert(jobTeam).values(team.rows.map((r) => ({ jobId, ...r }))).onConflictDoNothing();
    const opened = status === "open" && from !== "open";
    if (opened) await audit(tx, me, "open", jobId, now);
    // Changes to a job candidates can see (or could again) leave a line too, saying who, not what.
    else if (from === "open" || from === "paused") await audit(tx, me, "edited", jobId, now);
    return { ok: true, jobId, status, opened };
  });
  if (!result.ok) return result;
  logEvent("info", "job_saved", { created: !input.jobId, opened: result.opened });
  return { ok: true, jobId: result.jobId, status: result.status };
}

/**
 * Pause, close, or open again a job that was open before. A draft opens only from the form, with the three ticks.
 * Opening again is refused while the company can't open jobs (waiting for verification, suspended, or no second admin
 * after 14 days). Each move writes one audit line.
 */
export async function setJobStatus(userId: string, raw: unknown, deps: JobDeps = {}): Promise<JobResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = jobStatusInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { jobId, to } = parsed.data;
  const result = await db.transaction(async (tx): Promise<JobResult> => {
    const found = await editableJob(userId, jobId, tx, now);
    if (!found.ok) return found;
    const { me, job } = found;
    if (statusMoveRefusal(job.status, to)) return fail("bad_move");
    if (to === "open") {
      if (job.status === "draft") return fail("open_from_form");
      const refusal = openRefusal(await orgFacts(me.orgId, tx), job.requirements, now);
      if (refusal) return fail(refusal);
    }
    await tx
      .update(jobs)
      .set({ status: to, ...(to === "closed" ? { closedAt: now } : {}) })
      .where(eq(jobs.id, jobId));
    await audit(tx, me, to, jobId, now);
    return { ok: true };
  });
  if (result.ok) logEvent("info", "job_status_changed", { to });
  else logEvent("info", "job_status_refused", { to, reason: result.error });
  return result;
}

/**
 * "Report this job" from Departures, into the same reports queue (and IT Rules deadlines) as the Inbox. Only a job
 * candidates can see. One open report per person and job; asking again is the same report.
 */
export async function reportJob(userId: string, raw: unknown, deps: JobDeps = {}): Promise<JobResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = jobReportInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const r = parsed.data;
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .innerJoin(organizations, eq(organizations.id, jobs.orgId))
    .where(and(eq(jobs.id, r.jobId), eq(jobs.status, "open"), eq(organizations.reviewStatus, "verified")));
  if (!job) return fail("not_found");
  const [already] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.reporterId, userId), eq(reports.target, "job"), eq(reports.targetId, r.jobId), eq(reports.status, "open")))
    .limit(1);
  if (already) return { ok: true };
  if (!(await takeShared(LIMITS.inboxReportsPerUser, userId, { db, now: now.getTime() }))) return fail("limit");
  await db.insert(reports).values({ reporterId: userId, target: "job", targetId: r.jobId, reason: r.reason, note: r.note || null, createdAt: now });
  logEvent("info", "job_report", { reason: r.reason, status: "open" });
  return { ok: true };
}

/* Reading --------------------------------------------------------------------------------------------------------- */

/**
 * Corporate's Jobs list: every job of the company for a Recruiter admin, and for anyone else the jobs they are on.
 * With counts per status, whether this person can post, and why no job can open now.
 */
export async function companyJobs(userId: string, me: Member, org: OrgForJobs & { orgId: string }, db: Db, now: Date): Promise<JobsView> {
  const mine = and(eq(jobTeam.jobId, jobs.id), eq(jobTeam.userId, userId));
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      roleTitle: sql<string>`${roleProfiles.data}->>'title'`,
      city: jobs.city,
      workType: jobs.workType,
      status: jobs.status,
      createdAt: jobs.createdAt,
      closedAt: jobs.closedAt,
      requirements: jobs.requirements,
      ownerName: users.name,
      ownerDeleted: users.deletionRequestedAt,
      myRole: jobTeam.role,
    })
    .from(jobs)
    .innerJoin(roleProfiles, eq(roleProfiles.id, jobs.roleProfileId))
    .leftJoin(users, eq(users.id, jobs.ownerId))
    .leftJoin(jobTeam, mine)
    .where(and(eq(jobs.orgId, org.orgId), me.role === "admin" ? undefined : sql`${jobTeam.userId} is not null`))
    .orderBy(desc(jobs.createdAt));
  // Open applications per job, never counting the viewer's own (an employee applying to their own company's job).
  const ids = rows.map((r) => r.id);
  const open = ids.length
    ? await db
        .select({ jobId: applications.jobId, n: sql<number>`count(*)::int` })
        .from(applications)
        .innerJoin(users, eq(users.id, applications.userId))
        .where(
          and(
            inArray(applications.jobId, ids),
            isNull(applications.withdrawnAt),
            isNull(users.deletionRequestedAt),
            ne(applications.userId, userId),
            ne(applications.stage, "not_this_time"),
          ),
        )
        .groupBy(applications.jobId)
    : [];
  const openByJob = new Map(open.map((o) => [o.jobId, o.n]));
  const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const r of rows) counts[r.status]++;
  return {
    counts,
    canPost: canPostJobs(me.role),
    blocked: jobsBlocked(org, now),
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      roleTitle: r.roleTitle,
      city: r.city,
      workType: r.workType,
      status: r.status,
      live: isLive(r.status, org.reviewStatus),
      createdOn: isoDay(r.createdAt),
      closedOn: r.closedAt ? isoDay(r.closedAt) : null,
      ownerName: r.ownerName === null ? null : r.ownerDeleted ? "Account deleted" : displayName(r.ownerName),
      myRole: r.myRole,
      canEdit: r.status !== "closed" && canEditJob(me.role, r.myRole),
      requiredCount: r.requirements.required.length,
      // Interviewers see only candidates assigned to them, so no count of everyone's.
      applications: canMoveApplications(me.role, r.myRole) ? (openByJob.get(r.id) ?? 0) : null,
    })),
  };
}

/**
 * The Post a job form for a new job (jobId null) or one to edit: role profiles, our skill list, colleagues who can join
 * the team (names and roles only), and why the job can't open now, if so.
 */
export async function jobForm(
  userId: string,
  jobId: string | null,
  deps: JobDeps = {},
): Promise<JobResult<{ data: JobFormData; values: JobFormValues | null }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await activeMembership(userId, db, now);
  if (!me) return fail("not_member");
  if (!canPostJobs(me.role)) return fail("not_allowed");
  let values: JobFormValues | null = null;
  if (jobId) {
    const [job] = await db
      .select({ id: jobs.id, status: jobs.status, title: jobs.title, workType: jobs.workType, city: jobs.city, requirements: jobs.requirements, criteria: jobs.criteria, slug: roleProfiles.slug })
      .from(jobs)
      .innerJoin(roleProfiles, eq(roleProfiles.id, jobs.roleProfileId))
      .where(and(eq(jobs.id, jobId), eq(jobs.orgId, me.orgId)));
    if (!job) return fail("not_found");
    if (!canEditJob(me.role, await teamRoleOf(jobId, userId, db))) return fail("not_allowed");
    const team = await db
      .select({ memberId: orgMembers.id, role: jobTeam.role })
      .from(jobTeam)
      .innerJoin(orgMembers, and(eq(orgMembers.userId, jobTeam.userId), eq(orgMembers.orgId, me.orgId), isNull(orgMembers.removedAt)))
      .where(and(eq(jobTeam.jobId, jobId), ne(jobTeam.role, "owner")));
    values = {
      jobId: job.id,
      status: job.status,
      roleSlug: job.slug,
      title: job.title,
      workType: job.workType,
      city: job.city,
      requirements: job.requirements,
      criteria: job.criteria,
      hiring: team.filter((t) => t.role === "hiring").map((t) => t.memberId),
      interviewers: team.filter((t) => t.role === "interviewer").map((t) => t.memberId),
    };
  }
  // Someone whose work-email re-check is due can't open the job until they confirm it, so they aren't offered. One
  // already on this job's team is still listed, marked, so the form can keep them or take them off.
  const onTeam = values ? [...values.hiring, ...values.interviewers] : [];
  const [facts, colleagues] = await Promise.all([
    orgFacts(me.orgId, db),
    db
      .select({ memberId: orgMembers.id, name: users.name, role: orgMembers.role, recheckDueAt: orgMembers.recheckDueAt })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(
        and(
          eq(orgMembers.orgId, me.orgId),
          isNull(orgMembers.removedAt),
          onTeam.length ? or(gt(orgMembers.recheckDueAt, now), inArray(orgMembers.id, onTeam)) : gt(orgMembers.recheckDueAt, now),
          isNull(users.deletionRequestedAt),
          ne(orgMembers.userId, userId),
        ),
      )
      .orderBy(asc(orgMembers.createdAt)),
  ]);
  return {
    ok: true,
    values,
    data: {
      company: facts.name,
      companyVerified: facts.reviewStatus === "verified",
      roles: roleOptions(),
      skills: skillOptions(),
      certificates: certificateOptions(),
      colleagues: colleagues.map((c) => ({ memberId: c.memberId, name: displayName(c.name), role: c.role, ...(c.recheckDueAt <= now ? { recheckDue: true } : {}) })),
      blocked: jobsBlocked(facts, now),
    },
  };
}

/**
 * Jobs candidates see on Departures: open, from verified companies, newest first. The company's name only; never its
 * members, their names, email or phone.
 */
export async function liveJobs(deps: { db?: Db } = {}, limit = 50): Promise<PostedJobView[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: organizations.name,
      city: jobs.city,
      workType: jobs.workType,
      requirements: jobs.requirements,
      criteria: jobs.criteria,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(organizations, eq(organizations.id, jobs.orgId))
    .where(and(eq(jobs.status, "open"), eq(organizations.reviewStatus, "verified")))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    company: r.company,
    city: r.city,
    workType: r.workType,
    postedOn: isoDay(r.createdAt),
    ...requirementNames(r.requirements),
    criteria: criteriaNames(r.criteria),
  }));
}

/** Jobs the person made (owns), for "Download your data". */
export async function exportJobs(userId: string, db: Db = getDb()) {
  const rows = await db
    .select({
      company: organizations.name,
      title: jobs.title,
      role: roleProfiles.slug,
      workType: jobs.workType,
      city: jobs.city,
      status: jobs.status,
      requirements: jobs.requirements,
      criteria: jobs.criteria,
      createdAt: jobs.createdAt,
      closedAt: jobs.closedAt,
    })
    .from(jobs)
    .innerJoin(organizations, eq(organizations.id, jobs.orgId))
    .innerJoin(roleProfiles, eq(roleProfiles.id, jobs.roleProfileId))
    .where(eq(jobs.ownerId, userId))
    .orderBy(asc(jobs.createdAt));
  return rows.map((r) => ({ ...r, workType: JOB_WORK_TYPE_LABELS[r.workType] }));
}
