import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { jobTeam, jobs, orgInvites, orgMembers, organizations, users, workEmailCodes } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { sendEmail } from "@/lib/email/send";
import { logEvent } from "@/lib/log";
import {
  answerRequestInput,
  companyPage,
  inviteIdInput,
  inviteInput,
  joinFinish,
  joinStart,
  memberIdInput,
  signupDetails,
  signupFinish,
} from "@/lib/schemas/corporate";
import { DOMAIN_TAKEN_TEXT, ORG_ROLE_LABELS, RECHECK_CLOSED_TEXT, SIGNUP_CLOSED_TEXT } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { afterWrongTry, CODE_ERROR_TEXT, CODE_TTL_MS, codeMatches, codeState, hashCode, hashWorkEmail, newCode } from "./codes";
import { writeAudit } from "./audit-line";
import { codeDelivery } from "./delivery";
import { companyJobs } from "./jobs-store";
import { checkWorkEmail, isOnDomain, websiteMatchesDomain, workEmailProblemText } from "./domains";
import { canManageTeam, canOpenJobs, inviteExpiresAt, recheckDueAt, removalRefusal, secondAdminDaysLeft, secondAdminDueAt } from "./rules";
import type { CodeDelivery, CorporateHomeView } from "./types";

/*
 * Company sign-up, the work-email code, team and access (dev/corporate-plan.md, build steps 1 and 2). Like the Inbox
 * store, every function takes the signed-in person's id and checks their live `org_members` row itself, so removing a
 * role ends access on the very next request. Work emails and codes are never logged; the address is held on the code
 * row only until the code is used or expires.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Env = Record<string, string | undefined>;
export type CorporateDeps = { db?: Db; now?: Date; env?: Env; delivery?: CodeDelivery };

export type CorporateError =
  | "invalid"
  | "closed"
  | "taken"
  | "has_role"
  | "limit"
  | "no_invite"
  | "not_member"
  | "not_admin"
  | "not_found"
  | "keep_two_admins"
  | "last_admin"
  | "self_removal"
  | "already_invited"
  | "wrong"
  | "expired"
  | "locked"
  | "none";

export const CORPORATE_ERROR_TEXT: Record<CorporateError, string> = {
  invalid: "Check the details and try again.",
  closed: SIGNUP_CLOSED_TEXT,
  taken: DOMAIN_TAKEN_TEXT,
  has_role: "You already have a company role. A person can work for one company on CareerMetro at a time.",
  limit: "You've asked for a lot of codes. Try again in an hour.",
  no_invite: "We couldn't find access waiting for that work email. Ask a Recruiter admin at your company to add it.",
  not_member: "You don't have access to this company.",
  not_admin: "Only a Recruiter admin can do that.",
  not_found: "That isn't available any more.",
  keep_two_admins: "Keep at least two Recruiter admins. Add another admin first.",
  last_admin: "You're the only Recruiter admin. Add another admin first.",
  self_removal: "You can't remove your own access. Ask another Recruiter admin to remove you, so your jobs pass to them.",
  already_invited: "That work email already has access waiting.",
  wrong: CODE_ERROR_TEXT.wrong,
  expired: CODE_ERROR_TEXT.expired,
  locked: CODE_ERROR_TEXT.locked,
  none: CODE_ERROR_TEXT.none,
};

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: CorporateError; message?: string };

const fail = (error: CorporateError, message?: string) => ({ ok: false as const, error, ...(message ? { message } : {}) });
const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/* Membership ------------------------------------------------------------------------------------------------------ */

/** The person's company role, whether or not its work-email re-check is due. Null when they hold none. */
export async function heldMembership(userId: string, db: Db | Tx = getDb()) {
  const [row] = await db
    .select({
      memberId: orgMembers.id,
      orgId: orgMembers.orgId,
      role: orgMembers.role,
      since: orgMembers.createdAt,
      orgName: organizations.name,
      emailDomain: organizations.emailDomain,
      recheckDueAt: orgMembers.recheckDueAt,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(and(eq(orgMembers.userId, userId), isNull(orgMembers.removedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * The person's active company role, read live. Null when they have none, and while the 180-day work-email re-check
 * is due (Testing T40): the role is held but gives no company access until they confirm the work email again
 * (recheckWorkEmail). A role is still one per person, so sign-up and joining check heldMembership.
 */
export async function activeMembership(userId: string, db: Db | Tx = getDb(), now: Date = new Date()) {
  const row = await heldMembership(userId, db);
  return row && row.recheckDueAt > now ? row : null;
}

/** A role whose work-email re-check is due: the company and its domain, for the re-check screen. Null otherwise. */
export async function recheckDue(userId: string, deps: { db?: Db; now?: Date } = {}): Promise<{ company: string; domain: string } | null> {
  const row = await heldMembership(userId, deps.db ?? getDb());
  if (!row || row.recheckDueAt > (deps.now ?? new Date())) return null;
  return { company: row.orgName, domain: row.emailDomain ?? "" };
}

/** Admins who count for the two-admin rule: active role, account not deleted. */
export async function liveAdminCount(orgId: string, db: Db | Tx): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "admin"), isNull(orgMembers.removedAt), isNull(users.deletionRequestedAt)));
  return row?.n ?? 0;
}

/** The company whose domain covers this one (the same, a parent or a subdomain), if any. */
async function companyCovering(domain: string, db: Db | Tx) {
  const [row] = await db
    .select({ id: organizations.id, emailDomain: organizations.emailDomain, reviewStatus: organizations.reviewStatus })
    .from(organizations)
    .where(
      or(
        eq(organizations.emailDomain, domain),
        sql`${domain} like '%.' || ${organizations.emailDomain}`,
        sql`${organizations.emailDomain} like ${`%.${domain}`}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** One sign-up or join per person at a time, and one company sign-up at a time, so two tabs can't race. */
const userLock = (userId: string, tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-corp-user:${userId}`}))`);
const domainsLock = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('cm-corp-domains'))`);

/* Codes ----------------------------------------------------------------------------------------------------------- */

/**
 * Makes a new code for a work email and delivers it: by email once a sender exists, on screen in test mode, or not at
 * all ("closed"). One live code per person: an earlier unused one is spent. Limits: 3 an hour and 10 a day per
 * person, 20 a day per domain.
 */
async function issueCode(
  userId: string,
  /** limitDomain: the company's own domain when joining one, so its subdomains share one daily count. */
  target: { email: string; domain: string; orgId: string | null; limitDomain?: string },
  deps: CorporateDeps,
): Promise<Result<{ testCode?: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const delivery = deps.delivery ?? codeDelivery(deps.env);
  if (delivery === "off") return fail("closed");
  const [locked] = await db
    .select({ id: workEmailCodes.id })
    .from(workEmailCodes)
    .where(and(eq(workEmailCodes.userId, userId), gt(workEmailCodes.lockedUntil, now)))
    .limit(1);
  if (locked) return fail("locked");
  const at = { db, now: now.getTime() };
  // Each is counted even when an earlier one refuses: asking again while refused still counts as asking.
  const allowed = await Promise.all([
    takeShared(LIMITS.workEmailCodePerUserHour, userId, at),
    takeShared(LIMITS.workEmailCodePerUserDay, userId, at),
    takeShared(LIMITS.workEmailCodePerDomainDay, target.limitDomain ?? target.domain, at),
  ]);
  if (allowed.includes(false)) {
    logEvent("warn", "work_email_code_limited", { purpose: "org_member" });
    return fail("limit");
  }
  const id = randomUUID();
  const code = newCode();
  await db.transaction(async (tx) => {
    await tx
      .update(workEmailCodes)
      .set({ email: null, codeHash: null })
      .where(and(eq(workEmailCodes.userId, userId), eq(workEmailCodes.purpose, "org_member"), isNull(workEmailCodes.usedAt), isNotNull(workEmailCodes.codeHash)));
    await tx.insert(workEmailCodes).values({
      id,
      userId,
      purpose: "org_member",
      orgId: target.orgId,
      email: target.email,
      codeHash: hashCode(id, userId, code, deps.env),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      createdAt: now,
    });
  });
  if (delivery === "test") {
    logEvent("info", "work_email_code_issued", { delivery });
    return { ok: true, testCode: code };
  }
  const sent = await sendEmail({
    to: target.email,
    subject: "Your CareerMetro work email code",
    text: `Your code is ${code}. It works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
  });
  if (!sent.ok) return fail("closed");
  logEvent("info", "work_email_code_issued", { delivery });
  return { ok: true };
}

/**
 * Checks a typed code against the person's latest code for this email and company. A wrong try counts; the fifth
 * locks them out for 15 minutes and spends the code. A right one is spent at once. Either way, once a code is done
 * the address is set to null. Runs inside the caller's transaction and never throws for a refusal, so the counts commit.
 */
async function useCode(userId: string, target: { email: string; orgId: string | null }, typed: string, tx: Tx, deps: CorporateDeps): Promise<CorporateError | null> {
  const now = deps.now ?? new Date();
  const [lock] = await tx
    .select({ id: workEmailCodes.id })
    .from(workEmailCodes)
    .where(and(eq(workEmailCodes.userId, userId), gt(workEmailCodes.lockedUntil, now)))
    .limit(1);
  if (lock) return "locked";
  const [row] = await tx
    .select()
    .from(workEmailCodes)
    .where(and(eq(workEmailCodes.userId, userId), eq(workEmailCodes.purpose, "org_member")))
    .orderBy(desc(workEmailCodes.createdAt))
    .limit(1)
    .for("update");
  if (!row || row.orgId !== target.orgId) return "none";
  const state = codeState(row, now);
  if (state === "used") return "none";
  if (state === "locked") return "locked";
  if (state === "expired") {
    if (row.email) await tx.update(workEmailCodes).set({ email: null, codeHash: null }).where(eq(workEmailCodes.id, row.id));
    return "expired";
  }
  // A code sent to another address (the person changed the email after asking) doesn't count for this one.
  if (row.email !== target.email) return "none";
  if (codeMatches(row.codeHash, row.id, userId, typed, deps.env)) {
    await tx.update(workEmailCodes).set({ usedAt: now, email: null, codeHash: null }).where(eq(workEmailCodes.id, row.id));
    return null;
  }
  const next = afterWrongTry(row, now);
  await tx
    .update(workEmailCodes)
    .set({ attempts: next.attempts, lockedUntil: next.lockedUntil, ...(next.spent ? { email: null, codeHash: null } : {}) })
    .where(eq(workEmailCodes.id, row.id));
  return next.spent ? "locked" : "wrong";
}

/** The daily cleanup: addresses on codes that ran out are set to null, and old rows go once no lock depends on them. */
export async function clearExpiredCodes(db: Db = getDb(), now = new Date()): Promise<number> {
  const cleared = await db
    .update(workEmailCodes)
    .set({ email: null, codeHash: null })
    .where(and(isNotNull(workEmailCodes.email), lt(workEmailCodes.expiresAt, now)))
    .returning({ id: workEmailCodes.id });
  await db
    .delete(workEmailCodes)
    .where(and(lt(workEmailCodes.createdAt, new Date(now.getTime() - 2 * 86_400_000)), or(isNull(workEmailCodes.lockedUntil), lt(workEmailCodes.lockedUntil, now))));
  return cleared.length;
}

/* Company sign-up ------------------------------------------------------------------------------------------------- */

/**
 * Step 1 of company sign-up (handoff 12f): checks the details and sends a code to the work email. Refused for free
 * mail, for a domain another company already has (without naming its admins), and for someone who already has a role.
 */
export async function startCompanySignup(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result<{ testCode?: string }>> {
  const db = deps.db ?? getDb();
  const parsed = signupDetails.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const details = parsed.data;
  const domain = checkWorkEmail(details.workEmail);
  if (!domain.ok) return fail("invalid", workEmailProblemText(domain.problem));
  if (await heldMembership(userId, db)) return fail("has_role");
  if (await companyCovering(domain.domain, db)) return fail("taken");
  return issueCode(userId, { email: details.workEmail, domain: domain.domain, orgId: null }, deps);
}

/**
 * Step 2: the right code makes the company, `pending` until CareerMetro checks it, with the person as its first
 * Recruiter admin. The second admin is due within 14 days.
 */
export async function finishCompanySignup(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result<{ orgId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = signupFinish.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { details, code } = parsed.data;
  const domain = checkWorkEmail(details.workEmail);
  if (!domain.ok) return fail("invalid", workEmailProblemText(domain.problem));
  return db.transaction(async (tx) => {
    await userLock(userId, tx);
    await domainsLock(tx);
    if (await heldMembership(userId, tx)) return fail("has_role");
    if (await companyCovering(domain.domain, tx)) return fail("taken");
    const refused = await useCode(userId, { email: details.workEmail, orgId: null }, code, tx, deps);
    if (refused) return fail(refused);
    const [org] = await tx
      .insert(organizations)
      .values({
        name: details.name,
        type: details.type,
        legalName: details.legalName,
        website: details.website,
        emailDomain: domain.domain,
        size: details.size,
        city: details.city,
        domainVerifiedAt: now,
        secondAdminDueAt: secondAdminDueAt(now),
        createdAt: now,
      })
      .returning({ id: organizations.id });
    const [member] = await tx
      .insert(orgMembers)
      .values({
        orgId: org.id,
        userId,
        role: "admin",
        workEmailDomain: domain.domain,
        workEmailVerifiedAt: now,
        recheckDueAt: recheckDueAt(now),
        createdAt: now,
      })
      .returning({ id: orgMembers.id });
    await writeAudit(tx, { orgId: org.id, actor: { memberId: member.id }, action: "company_created", target: { company: org.id } }, now);
    logEvent("info", "company_created", { websiteMatches: websiteMatchesDomain(details.website, domain.domain) });
    return { ok: true as const, orgId: org.id };
  });
}

/** Step 3, the company page. Recruiter admins only. */
export async function saveCompanyPage(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result> {
  const db = deps.db ?? getDb();
  const parsed = companyPage.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const me = await activeMembership(userId, db, deps.now);
  if (!me) return fail("not_member");
  if (!canManageTeam(me.role)) return fail("not_admin");
  const p = parsed.data;
  await db.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({ about: p.about || null, industry: p.industry || null, offices: p.offices || null, gstinOrCin: p.gstinOrCin || null })
      .where(eq(organizations.id, me.orgId));
    await writeAudit(tx, { orgId: me.orgId, actor: { memberId: me.memberId }, action: "company_page_saved", target: { company: me.orgId } }, deps.now ?? new Date());
  });
  return { ok: true };
}

/**
 * "Ask for access" (handoff 12f): someone whose work-email domain already has a company asks its admins for a role.
 * They see the request was sent; they never learn who the admins are. Asking twice is the same request.
 */
export async function requestAccess(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = joinStart.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const domain = checkWorkEmail(parsed.data.workEmail);
  if (!domain.ok) return fail("invalid", workEmailProblemText(domain.problem));
  if (await heldMembership(userId, db)) return fail("has_role");
  const org = await companyCovering(domain.domain, db);
  if (!org) return fail("not_found");
  const [open] = await db
    .select({ id: orgInvites.id })
    .from(orgInvites)
    .where(and(eq(orgInvites.orgId, org.id), eq(orgInvites.userId, userId), isNull(orgInvites.acceptedAt), isNull(orgInvites.cancelledAt), gt(orgInvites.expiresAt, now)))
    .limit(1);
  if (open) return { ok: true };
  if (!(await takeShared(LIMITS.corporateRequestsPerUser, userId, { db, now: now.getTime() }))) return fail("limit");
  await db.insert(orgInvites).values({ orgId: org.id, kind: "request", emailDomain: domain.domain, userId, createdAt: now, expiresAt: inviteExpiresAt(now) });
  return { ok: true };
}

/* Team and access ------------------------------------------------------------------------------------------------- */

/** The person's role, if they are a Recruiter admin of their company. */
async function adminOf(userId: string, db: Db | Tx, now: Date) {
  const me = await activeMembership(userId, db, now);
  if (!me) return fail("not_member");
  if (!canManageTeam(me.role)) return fail("not_admin");
  return { ok: true as const, me };
}

/**
 * Gives a role by work email (plan call A): only a keyed hash of the address and its domain are kept. The colleague
 * signs in with their own account, types that address in Corporate, and the code switches the role on.
 */
export async function inviteMember(adminId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = inviteInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const admin = await adminOf(adminId, db, now);
  if (!admin.ok) return admin;
  const orgDomain = admin.me.emailDomain!;
  const check = checkWorkEmail(parsed.data.workEmail, orgDomain);
  if (!check.ok) return fail("invalid", workEmailProblemText(check.problem, orgDomain));
  const emailHash = hashWorkEmail(parsed.data.workEmail, deps.env);
  const [open] = await db
    .select({ id: orgInvites.id })
    .from(orgInvites)
    .where(and(eq(orgInvites.orgId, admin.me.orgId), eq(orgInvites.emailHash, emailHash), isNull(orgInvites.acceptedAt), isNull(orgInvites.cancelledAt), gt(orgInvites.expiresAt, now)))
    .limit(1);
  if (open) return fail("already_invited");
  await db.transaction(async (tx) => {
    const [invite] = await tx
      .insert(orgInvites)
      .values({
        orgId: admin.me.orgId,
        kind: "invite",
        role: parsed.data.role,
        emailHash,
        emailDomain: check.domain,
        invitedBy: adminId,
        createdAt: now,
        expiresAt: inviteExpiresAt(now),
      })
      .returning({ id: orgInvites.id });
    await writeAudit(tx, { orgId: admin.me.orgId, actor: { memberId: admin.me.memberId }, action: "role_invited", target: { invite: invite.id } }, now);
  });
  return { ok: true };
}

/** Cancels an invite that hasn't been used yet. */
export async function cancelInvite(adminId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = inviteIdInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const admin = await adminOf(adminId, db, now);
  if (!admin.ok) return admin;
  const done = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(orgInvites)
      .set({ cancelledAt: now })
      .where(and(eq(orgInvites.id, parsed.data.inviteId), eq(orgInvites.orgId, admin.me.orgId), isNull(orgInvites.acceptedAt), isNull(orgInvites.cancelledAt)))
      .returning({ id: orgInvites.id });
    if (row) await writeAudit(tx, { orgId: admin.me.orgId, actor: { memberId: admin.me.memberId }, action: "invite_cancelled", target: { invite: row.id } }, now);
    return !!row;
  });
  return done ? { ok: true } : fail("not_found");
}

/** Answers an "Ask for access" request: a role (they then confirm their work email) or decline (they aren't told). */
export async function answerRequest(adminId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = answerRequestInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const admin = await adminOf(adminId, db, now);
  if (!admin.ok) return admin;
  const { requestId, answer } = parsed.data;
  const set = answer === "decline" ? { cancelledAt: now } : { role: answer, invitedBy: adminId, expiresAt: inviteExpiresAt(now) };
  const done = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(orgInvites)
      .set(set)
      .where(
        and(
          eq(orgInvites.id, requestId),
          eq(orgInvites.orgId, admin.me.orgId),
          eq(orgInvites.kind, "request"),
          isNull(orgInvites.role),
          isNull(orgInvites.acceptedAt),
          isNull(orgInvites.cancelledAt),
          gt(orgInvites.expiresAt, now),
        ),
      )
      .returning({ id: orgInvites.id });
    const action = answer === "decline" ? "request_declined" : "request_approved";
    if (row) await writeAudit(tx, { orgId: admin.me.orgId, actor: { memberId: admin.me.memberId }, action, target: { invite: row.id } }, now);
    return !!row;
  });
  return done ? { ok: true } : fail("not_found");
}

/**
 * Removes a member's role. Their Corporate access ends on their next request; their personal account is untouched.
 * Refused when it would leave fewer than two Recruiter admins once there are two, or none at all.
 */
export async function removeMember(adminId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = memberIdInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  return db.transaction(async (tx) => {
    const admin = await adminOf(adminId, tx, now);
    if (!admin.ok) return admin;
    // The company row is locked so two admins removing each other at once can't both pass the two-admin check.
    await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, admin.me.orgId)).for("update");
    const [target] = await tx
      .select({ id: orgMembers.id, userId: orgMembers.userId, role: orgMembers.role, deleted: users.deletionRequestedAt })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.id, parsed.data.memberId), eq(orgMembers.orgId, admin.me.orgId), isNull(orgMembers.removedAt)));
    if (!target) return fail("not_found");
    // A deleted account isn't counted as an admin, so taking its role away never lowers the count.
    const refusal = target.deleted ? null : removalRefusal(target.role, await liveAdminCount(admin.me.orgId, tx));
    if (refusal) return fail(refusal);
    // Removing yourself would leave the jobs you own with no one to pass them to (Testing T38): another admin does it.
    if (target.userId === adminId) return fail("self_removal");
    await tx.update(orgMembers).set({ removedAt: now, removedBy: adminId }).where(eq(orgMembers.id, target.id));
    await writeAudit(tx, { orgId: admin.me.orgId, actor: { memberId: admin.me.memberId }, action: "member_removed", target: { member: target.id } }, now);
    // They leave every job team at this company too, owner rows included, so joining again later never brings back
    // rights on old jobs, their candidates or a phone shared with them (Testing T38). The jobs they owned pass to the
    // admin who removed them, who could already manage them; the member_removed line above stays in the audit.
    const companyJobs = tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.orgId, admin.me.orgId));
    const owned = await tx
      .delete(jobTeam)
      .where(and(eq(jobTeam.userId, target.userId), inArray(jobTeam.jobId, companyJobs)))
      .returning({ jobId: jobTeam.jobId, role: jobTeam.role });
    const ownedJobs = owned.filter((r) => r.role === "owner").map((r) => r.jobId);
    if (ownedJobs.length) {
      await tx
        .insert(jobTeam)
        .values(ownedJobs.map((jobId) => ({ jobId, userId: adminId, role: "owner" as const })))
        .onConflictDoUpdate({ target: [jobTeam.jobId, jobTeam.userId], set: { role: "owner" } });
    }
    await tx.update(jobs).set({ ownerId: adminId }).where(and(eq(jobs.orgId, admin.me.orgId), eq(jobs.ownerId, target.userId)));
    return { ok: true as const };
  });
}

/* Joining a company ----------------------------------------------------------------------------------------------- */

/** An open invite or approved request this person can use with a work email on `domain`. */
async function waitingRole(userId: string, email: string, domain: string, db: Db | Tx, now: Date, env?: Env) {
  const rows = await db
    .select({ id: orgInvites.id, orgId: orgInvites.orgId, role: orgInvites.role, invitedBy: orgInvites.invitedBy, orgDomain: organizations.emailDomain })
    .from(orgInvites)
    .innerJoin(organizations, eq(organizations.id, orgInvites.orgId))
    .where(
      and(
        or(eq(orgInvites.emailHash, hashWorkEmail(email, env)), and(eq(orgInvites.kind, "request"), eq(orgInvites.userId, userId))),
        isNotNull(orgInvites.role),
        isNull(orgInvites.acceptedAt),
        isNull(orgInvites.cancelledAt),
        gt(orgInvites.expiresAt, now),
      ),
    )
    .orderBy(desc(orgInvites.createdAt));
  const row = rows.find((r) => r.orgDomain && isOnDomain(domain, r.orgDomain));
  return row ? { ...row, role: row.role! } : null;
}

/** Someone given a role types their work email: if access is waiting for it, a code goes there. */
export async function startJoin(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result<{ testCode?: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = joinStart.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const check = checkWorkEmail(parsed.data.workEmail);
  if (!check.ok) return fail("invalid", workEmailProblemText(check.problem));
  if (await heldMembership(userId, db)) return fail("has_role");
  const waiting = await waitingRole(userId, parsed.data.workEmail, check.domain, db, now, deps.env);
  if (!waiting) return fail("no_invite");
  return issueCode(userId, { email: parsed.data.workEmail, domain: check.domain, orgId: waiting.orgId, limitDomain: waiting.orgDomain ?? undefined }, deps);
}

/** The right code switches the role on. One active role per person, so a second company is refused. */
export async function finishJoin(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result<{ orgId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = joinFinish.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { workEmail, code } = parsed.data;
  const check = checkWorkEmail(workEmail);
  if (!check.ok) return fail("invalid", workEmailProblemText(check.problem));
  return db.transaction(async (tx) => {
    await userLock(userId, tx);
    if (await heldMembership(userId, tx)) return fail("has_role");
    const waiting = await waitingRole(userId, workEmail, check.domain, tx, now, deps.env);
    if (!waiting) return fail("no_invite");
    const refused = await useCode(userId, { email: workEmail, orgId: waiting.orgId }, code, tx, deps);
    if (refused) return fail(refused);
    // Claim the invite first: two accounts holding codes for the same invited mailbox can't both accept it.
    const claimed = await tx
      .update(orgInvites)
      .set({ acceptedAt: now })
      .where(and(eq(orgInvites.id, waiting.id), isNull(orgInvites.acceptedAt), isNull(orgInvites.cancelledAt)))
      .returning({ id: orgInvites.id });
    if (claimed.length === 0) return fail("no_invite");
    const [member] = await tx
      .insert(orgMembers)
      .values({
        orgId: waiting.orgId,
        userId,
        role: waiting.role,
        workEmailDomain: check.domain,
        workEmailVerifiedAt: now,
        recheckDueAt: recheckDueAt(now),
        grantedBy: waiting.invitedBy,
        createdAt: now,
      })
      .returning({ id: orgMembers.id });
    await writeAudit(tx, { orgId: waiting.orgId, actor: { memberId: member.id }, action: "member_joined", target: { member: member.id } }, now);
    return { ok: true as const, orgId: waiting.orgId };
  });
}

/* The 180-day re-check (Testing T40) ------------------------------------------------------------------------------ */

/**
 * Someone whose role is due for its work-email re-check types a work email on the company's domain again: a code
 * goes there, as when they joined. Until a sender exists production sends nothing ("closed"), so the role stays
 * paused there; previews and local copies show the code on screen.
 */
export async function startRecheck(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result<{ testCode?: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = joinStart.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const held = await heldMembership(userId, db);
  if (!held || held.recheckDueAt > now || !held.emailDomain) return fail("not_found");
  const check = checkWorkEmail(parsed.data.workEmail, held.emailDomain);
  if (!check.ok) return fail("invalid", workEmailProblemText(check.problem, held.emailDomain));
  const r = await issueCode(userId, { email: parsed.data.workEmail, domain: check.domain, orgId: held.orgId, limitDomain: held.emailDomain }, deps);
  return !r.ok && r.error === "closed" ? fail("closed", RECHECK_CLOSED_TEXT) : r;
}

/** The right code confirms the work email again: the role's company access is back for another 180 days. */
export async function finishRecheck(userId: string, raw: unknown, deps: CorporateDeps = {}): Promise<Result> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = joinFinish.safeParse(raw);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { workEmail, code } = parsed.data;
  return db.transaction(async (tx) => {
    await userLock(userId, tx);
    const held = await heldMembership(userId, tx);
    if (!held || held.recheckDueAt > now || !held.emailDomain) return fail("not_found");
    const check = checkWorkEmail(workEmail, held.emailDomain);
    if (!check.ok) return fail("invalid", workEmailProblemText(check.problem, held.emailDomain));
    const refused = await useCode(userId, { email: workEmail, orgId: held.orgId }, code, tx, deps);
    if (refused) return fail(refused);
    await tx
      .update(orgMembers)
      .set({ workEmailDomain: check.domain, workEmailVerifiedAt: now, recheckDueAt: recheckDueAt(now) })
      .where(eq(orgMembers.id, held.memberId));
    logEvent("info", "work_email_rechecked");
    return { ok: true as const };
  });
}

/* Reading --------------------------------------------------------------------------------------------------------- */

/**
 * Corporate home for a member: the company, its status badge, the second-admin countdown, its jobs and, for admins,
 * Team and access. Null when the person has no active role. No email address of anyone is read.
 */
export async function corporateHome(userId: string, deps: { db?: Db; now?: Date } = {}): Promise<CorporateHomeView | null> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await activeMembership(userId, db, now);
  if (!me) return null;
  const [org] = await db
    .select({
      name: organizations.name,
      type: organizations.type,
      domain: organizations.emailDomain,
      website: organizations.website,
      status: organizations.reviewStatus,
      createdAt: organizations.createdAt,
      secondAdminDueAt: organizations.secondAdminDueAt,
      about: organizations.about,
    })
    .from(organizations)
    .where(eq(organizations.id, me.orgId));
  const adminCount = await liveAdminCount(me.orgId, db);
  const facts = { reviewStatus: org.status, adminCount, secondAdminDueAt: org.secondAdminDueAt };
  const jobs = await companyJobs(userId, me, { ...facts, orgId: me.orgId }, db, now);
  let team: CorporateHomeView["team"] = null;
  if (canManageTeam(me.role)) {
    const [members, waiting] = await Promise.all([
      db
        .select({ id: orgMembers.id, userId: orgMembers.userId, name: users.name, deleted: users.deletionRequestedAt, role: orgMembers.role, verifiedAt: orgMembers.workEmailVerifiedAt, recheckDueAt: orgMembers.recheckDueAt })
        .from(orgMembers)
        .innerJoin(users, eq(users.id, orgMembers.userId))
        .where(and(eq(orgMembers.orgId, me.orgId), isNull(orgMembers.removedAt)))
        .orderBy(asc(orgMembers.createdAt), asc(orgMembers.id)),
      db
        .select({ id: orgInvites.id, kind: orgInvites.kind, role: orgInvites.role, domain: orgInvites.emailDomain, name: users.name, createdAt: orgInvites.createdAt, expiresAt: orgInvites.expiresAt })
        .from(orgInvites)
        .leftJoin(users, eq(users.id, orgInvites.userId))
        .where(and(eq(orgInvites.orgId, me.orgId), isNull(orgInvites.acceptedAt), isNull(orgInvites.cancelledAt), gt(orgInvites.expiresAt, now)))
        .orderBy(asc(orgInvites.createdAt)),
    ]);
    team = {
      members: members.map((m) => ({
        id: m.id,
        name: m.deleted ? "Account deleted" : displayName(m.name),
        role: m.role,
        workEmailVerifiedOn: isoDay(m.verifiedAt),
        recheckDue: m.recheckDueAt <= now,
        isYou: m.userId === userId,
      })),
      // An approved request is waiting for its code, like an invite; one not answered yet is a request.
      invites: waiting.filter((w) => w.role).map((w) => ({ id: w.id, role: w.role!, domain: w.domain, createdOn: isoDay(w.createdAt), expiresOn: isoDay(w.expiresAt) })),
      requests: waiting.filter((w) => w.kind === "request" && !w.role).map((w) => ({ id: w.id, name: displayName(w.name), domain: w.domain, createdOn: isoDay(w.createdAt) })),
    };
  }
  return {
    org: { name: org.name, type: org.type, domain: org.domain ?? "", website: org.website, status: org.status, createdOn: isoDay(org.createdAt), hasPage: !!org.about },
    me: { role: me.role, since: isoDay(me.since) },
    adminCount,
    secondAdminDaysLeft: secondAdminDaysLeft({ adminCount, secondAdminDueAt: org.secondAdminDueAt }, now),
    canOpenJobs: canOpenJobs(facts, now),
    jobs,
    team,
  };
}

/** The person's company roles, past and present, for "Download your data". */
export async function exportCorporate(userId: string, db: Db = getDb()) {
  const rows = await db
    .select({ company: organizations.name, role: orgMembers.role, since: orgMembers.createdAt, workEmailDomain: orgMembers.workEmailDomain, workEmailVerifiedAt: orgMembers.workEmailVerifiedAt, removedAt: orgMembers.removedAt })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(asc(orgMembers.createdAt));
  return rows.map((r) => ({ ...r, role: ORG_ROLE_LABELS[r.role] }));
}
