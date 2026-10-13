import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import {
  applications,
  blocks,
  companyBlocks,
  companyProfileViews,
  conversationMembers,
  conversations,
  gapAnalyses,
  jobs,
  jobTeam,
  messages,
  orgMembers,
  organizations,
  profiles,
  resumes,
  userSettings,
  users,
} from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { displayName } from "@/lib/account/name";
import { COMPANY_TEAM, formatAt, MESSAGES_PER_CHAT } from "@/lib/inbox/store";
import { logEvent } from "@/lib/log";
import { duration, meFromProfile } from "@/lib/me/build";
import { publicProfile as publicMe } from "@/lib/me/public";
import {
  companyBlockInput,
  findOpenInput,
  findRequestInput,
  findSearchInput,
  foundMessageInput,
  gapAnalysis,
  storedProfile,
  type FindBand,
  type GapAnalysis,
  type Profile,
  type PublicParts,
} from "@/lib/schemas";
import { FIND_PAGE_SIZE, FIND_SCAN_MAX, FIND_VIEWS_KEEP_DAYS } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { provedByUser } from "./applications-store";
import { writeAudit } from "./audit-line";
import { blockCompanyIn } from "./company-blocks";
import { openRef, sealRef } from "./find-ref";
import { compareFound, findRefusal, inBand, matchesJob, yearsWorked, type FindRefusal } from "./find-rules";
import type { DiscoveryView, FindJobOption, FindPeopleView, FindPersonCard, FoundPersonView, FoundRequestState, SentRequestView } from "./find-types";
import { formatDay } from "./format";
import { jobMatch } from "./match";
import { activeMembership } from "./store";
import type { CompanyChatListItem, CompanyChatMessage, CompanyChatView, JobTeamRole } from "./types";

/*
 * Let companies find me (pending item 19, dev/companies-find-me-plan.md). A verified company's Recruiter admins, and
 * Hiring HR on the job, search from one of the company's open jobs for people who turned on "Let companies find me",
 * ranked by Match to this job in plain code (no model). They see the public profile parts the person switched on
 * (never gaps) and the match, and can send one message request, which the person accepts or deletes in their Inbox.
 * Every read re-checks the live role, the company's state, the switch and blocks, so turning the switch off or blocking
 * takes the person out at once. Each search, profile opening and request writes an audit line naming only the job.
 * Logs carry event names and reasons only: never names, refs, bands or messages.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type FindDeps = { db?: Db; now?: Date; env?: Record<string, string | undefined> };

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skillNames = new Map(skills.map((s) => [s.id, s.name]));
const roleTitles = new Map(roleProfiles.map((r) => [r.slug, r.title]));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type FindError = "invalid" | "not_member" | FindRefusal | "not_found" | "limit" | "unavailable" | "waiting" | "accepted" | "message";

export const FIND_ERROR_TEXT: Record<FindError, string> = {
  invalid: "Check the details and try again.",
  not_member: "You don't have access to this company.",
  interviewer: "Interviewers can't search for people. Recruiter admins and Hiring HR can.",
  not_verified: "Only verified companies can search for people.",
  not_on_job: "Hiring HR search from the jobs they are on.",
  job_not_open: "Search from one of your open jobs.",
  not_found: "This person isn't available any more.",
  limit: "You've reached the limit for this for now. Try again later.",
  unavailable: "Searching for people isn't available right now.",
  waiting: "Your message request is waiting for them to accept.",
  accepted: "They accepted your request. Write to them in Messages.",
  message: "Write a message of up to 2,000 characters.",
};

export type FindResult<T = object> = ({ ok: true } & T) | { ok: false; error: FindError };
const fail = (error: FindError) => ({ ok: false as const, error });

/* Who may search, from which job ---------------------------------------------------------------------------------- */

type Member = NonNullable<Awaited<ReturnType<typeof activeMembership>>>;
type JobContext = { me: Member; job: { id: string; title: string; requirements: (typeof jobs.$inferSelect)["requirements"] } };

const movesOnJob = (teamRole: JobTeamRole | null) => teamRole === "owner" || teamRole === "hiring";

/** The person's live role, the company's state and the job, or why they can't search from it. */
async function jobContext(userId: string, jobId: string, db: Db | Tx, now: Date): Promise<FindResult<JobContext>> {
  const me = await activeMembership(userId, db, now);
  if (!me) return fail("not_member");
  if (!UUID.test(jobId)) return fail("job_not_open");
  const [job] = await db
    .select({ id: jobs.id, title: jobs.title, status: jobs.status, requirements: jobs.requirements, orgStatus: organizations.reviewStatus })
    .from(jobs)
    .innerJoin(organizations, eq(organizations.id, jobs.orgId))
    .where(and(eq(jobs.id, jobId), eq(jobs.orgId, me.orgId)));
  const [org] = job ? [] : await db.select({ status: organizations.reviewStatus }).from(organizations).where(eq(organizations.id, me.orgId));
  const [team] = job ? await db.select({ role: jobTeam.role }).from(jobTeam).where(and(eq(jobTeam.jobId, job.id), eq(jobTeam.userId, userId))) : [];
  const refusal = findRefusal({ role: me.role, onJobTeam: movesOnJob(team?.role ?? null), orgStatus: job?.orgStatus ?? org?.status ?? "pending", jobStatus: job?.status ?? "none" });
  if (refusal) return fail(refusal);
  return { ok: true, me, job: { id: job!.id, title: job!.title, requirements: job!.requirements } };
}

/**
 * The people a company may find, as one condition on `users` joined to `user_settings`: the switch on; not deleted;
 * not the searcher; not on the company's own team (an employee's job search stays hidden); not blocking the company;
 * no block either way with the searcher; not already applied to this job (they are on its board).
 */
function findableWhere(orgId: string, searcherId: string, jobId: string): SQL {
  return and(
    eq(userSettings.companiesCanFind, true),
    isNull(users.deletionRequestedAt),
    ne(users.id, searcherId),
    sql`not exists (select 1 from ${orgMembers} m where m.user_id = ${users.id} and m.org_id = ${orgId} and m.removed_at is null)`,
    sql`not exists (select 1 from ${companyBlocks} cb where cb.user_id = ${users.id} and cb.org_id = ${orgId})`,
    sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${users.id} and b.blocked_id = ${searcherId}) or (b.blocker_id = ${searcherId} and b.blocked_id = ${users.id}))`,
    sql`not exists (select 1 from ${applications} a where a.job_id = ${jobId} and a.user_id = ${users.id})`,
  )!;
}

const personColumns = {
  id: users.id,
  name: users.name,
  headline: users.headline,
  createdAt: users.createdAt,
  showTargetRole: userSettings.showTargetRole,
  showExperience: userSettings.showExperience,
  showEducation: userSettings.showEducation,
  showSkills: userSettings.showSkills,
  showCertifications: userSettings.showCertifications,
};
type Person = { id: string; name: string | null; headline: string | null; createdAt: Date } & Omit<PublicParts, "showGaps">;

/**
 * The people found, read fresh: the switch, blocks and roles as they are now. At most FIND_SCAN_MAX are read, most
 * recently saved settings first (turning the switch on saves them), so the cap drops the longest-standing opt-ins
 * rather than ever hiding a new one. Reaching the cap is logged with the count only.
 */
async function findable(orgId: string, searcherId: string, jobId: string, db: Db | Tx, only?: string): Promise<Person[]> {
  const rows = await db
    .select(personColumns)
    .from(userSettings)
    .innerJoin(users, eq(users.id, userSettings.userId))
    .where(and(findableWhere(orgId, searcherId, jobId), only ? eq(users.id, only) : undefined))
    .orderBy(desc(userSettings.updatedAt), asc(users.id))
    .limit(FIND_SCAN_MAX);
  if (!only && rows.length >= FIND_SCAN_MAX) logEvent("warn", "find_scan_capped", { scanned: rows.length });
  return rows;
}

/**
 * Each person's current analysis and resume, as on their own Gaps page: the newest analysis of the latest version of
 * one of their resumes' profiles. People without one aren't listed.
 */
async function currentResumes(userIds: string[], db: Db | Tx): Promise<Map<string, { resumeId: string; analysis: GapAnalysis; profile: Profile }>> {
  const out = new Map<string, { resumeId: string; analysis: GapAnalysis; profile: Profile }>();
  if (!userIds.length) return out;
  // One row per person, with the profile of that latest version: never every version of every resume.
  const rows = await db
    .selectDistinctOn([resumes.userId], { userId: resumes.userId, resumeId: resumes.id, result: gapAnalyses.result, data: profiles.data })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(and(inArray(resumes.userId, userIds), sql`${profiles.version} = (select max(p2.version) from profiles p2 where p2.resume_id = ${profiles.resumeId})`))
    .orderBy(resumes.userId, desc(gapAnalyses.createdAt));
  for (const r of rows) {
    const parsed = gapAnalysis.safeParse(r.result);
    if (r.userId && parsed.success) out.set(r.userId, { resumeId: r.resumeId, analysis: parsed.data, profile: storedProfile(r.data) });
  }
  return out;
}

/** How the company's found chats with these people stand. */
async function requestStates(orgId: string, userIds: string[], db: Db | Tx): Promise<Map<string, FoundRequestState>> {
  const out = new Map<string, FoundRequestState>();
  if (!userIds.length) return out;
  const rows = await db
    .select({ id: conversations.id, status: conversations.status, userId: conversationMembers.userId })
    .from(conversations)
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.role, "member")))
    .where(and(eq(conversations.orgId, orgId), eq(conversations.kind, "found"), inArray(conversationMembers.userId, userIds)));
  for (const r of rows) out.set(r.userId, r.status === "closed" ? { state: "closed" } : { state: r.status === "request" ? "waiting" : "open", conversationId: r.id });
  return out;
}

/** The person's experience total as their profile shows it, or null when that part is off. */
const experienceText = (person: Person, years: number) => (person.showExperience && years > 0 ? duration(0, years) : null);

/* Searching ------------------------------------------------------------------------------------------------------- */

/**
 * One page of people found from one of the company's open jobs, ranked by Match to this job, with an experience band if
 * asked. Counts against the person's and the company's search limits, inside the transaction that writes the audit line.
 */
export async function searchPeople(userId: string, raw: unknown, deps: FindDeps = {}): Promise<FindResult<{ cards: FindPersonCard[]; total: number; hasMore: boolean }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = findSearchInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const { jobId, band, page } = parsed.data;
  const result = await db.transaction(async (tx): Promise<FindResult<{ cards: FindPersonCard[]; total: number; hasMore: boolean }>> => {
    const ctx = await jobContext(userId, jobId, tx, now);
    if (!ctx.ok) return ctx;
    const { me, job } = ctx;
    if (!sealRef(userId, me.orgId, deps.env)) return fail("unavailable");
    const at = { db: tx, now: now.getTime() };
    if (!(await takeShared(LIMITS.findSearchesPerUserHour, userId, at))) return fail("limit");
    if (!(await takeShared(LIMITS.findSearchesPerCompanyDay, me.orgId, at))) return fail("limit");
    const ranked = await rankPeople(me.orgId, userId, job, band, tx, now, deps.env);
    const slice = ranked.slice((page - 1) * FIND_PAGE_SIZE, page * FIND_PAGE_SIZE);
    const states = await requestStates(
      me.orgId,
      slice.map((p) => p.userId),
      tx,
    );
    await writeAudit(tx, { orgId: me.orgId, actor: { memberId: me.memberId }, action: "people_searched", target: { job: job.id } }, now);
    return {
      ok: true,
      total: ranked.length,
      hasMore: ranked.length > page * FIND_PAGE_SIZE,
      cards: slice.map(({ userId: id, card }) => ({ ...card, request: states.get(id) ?? { state: "none" } })),
    };
  });
  logEvent("info", result.ok ? "people_searched" : "people_search_refused", result.ok ? { shown: result.cards.length } : { reason: result.error });
  return result;
}

/** Every findable person who matches the job (and the band), ranked. Internal: the user id never leaves this module. */
async function rankPeople(orgId: string, searcherId: string, job: JobContext["job"], band: FindBand | null, db: Db | Tx, now: Date, env?: Record<string, string | undefined>) {
  const people = await findable(orgId, searcherId, job.id, db);
  const current = await currentResumes(
    people.map((p) => p.id),
    db,
  );
  const withResume = people.filter((p) => current.has(p.id));
  const proved = await provedByUser(
    withResume.map((p) => p.id),
    db,
    now,
  );
  const found: { userId: string; card: Omit<FindPersonCard, "request">; match: FindPersonCard["match"]; ref: string }[] = [];
  for (const person of withResume) {
    const { profile } = current.get(person.id)!;
    const years = yearsWorked(profile, now);
    if (!inBand(band, years, person.showExperience)) continue;
    const match = jobMatch(job.requirements, profile, proved.get(person.id) ?? new Set(), now);
    if (!matchesJob(match)) continue;
    const ref = sealRef(person.id, orgId, env);
    if (!ref) continue;
    found.push({ userId: person.id, ref, match, card: { ref, name: displayName(person.name), headline: person.headline, experience: experienceText(person, years), match } });
  }
  return found.sort(compareFound);
}

/* Opening one person ---------------------------------------------------------------------------------------------- */

/** What a company sees of one person: the profile parts they switched on (never gaps) and the role they aim at if shown. */
function companyView(person: Person, profile: Profile, analysis: GapAnalysis, now: Date) {
  const me = meFromProfile({
    name: displayName(person.name),
    headline: person.headline,
    profile,
    analysis,
    line: null,
    skillName: (id) => skillNames.get(id) ?? id,
    joinedAt: person.createdAt,
    resumeReadAt: null,
    now,
  });
  const aim = roleTitles.get(analysis.roleSlug) ?? null;
  return publicMe({ ...me, aim }, { ...person, showGaps: false });
}

/** A person found from a search, resolved from the company's ref and checked again now. */
async function resolve(ctx: JobContext, userId: string, ref: string, db: Db | Tx, env?: Record<string, string | undefined>): Promise<Person | null> {
  const target = openRef(ref, ctx.me.orgId, env);
  if (!target) return null;
  const [person] = await findable(ctx.me.orgId, userId, ctx.job.id, db, target);
  return person ?? null;
}

/**
 * Opens one person found from a job: their public profile parts and Match to this job. Writes a profile view the person
 * sees in Settings (company and day, never who) and an audit line naming the job.
 */
export async function openFoundPerson(userId: string, raw: unknown, deps: FindDeps = {}): Promise<FindResult<{ person: FoundPersonView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = findOpenInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const result = await db.transaction(async (tx): Promise<FindResult<{ person: FoundPersonView }>> => {
    const ctx = await jobContext(userId, parsed.data.jobId, tx, now);
    if (!ctx.ok) return ctx;
    const { me, job } = ctx;
    if (!(await takeShared(LIMITS.findOpensPerUserHour, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    const person = await resolve(ctx, userId, parsed.data.ref, tx, deps.env);
    if (!person) return fail("not_found");
    const current = (await currentResumes([person.id], tx)).get(person.id);
    if (!current) return fail("not_found");
    const { profile } = current;
    const proved = (await provedByUser([person.id], tx, now)).get(person.id) ?? new Set<string>();
    const state = (await requestStates(me.orgId, [person.id], tx)).get(person.id) ?? { state: "none" as const };
    await tx.insert(companyProfileViews).values({ orgId: me.orgId, userId: person.id, jobId: job.id, viewedAt: now });
    await writeAudit(tx, { orgId: me.orgId, actor: { memberId: me.memberId }, action: "found_profile_viewed", target: { job: job.id } }, now);
    return {
      ok: true,
      person: {
        ref: parsed.data.ref,
        jobId: job.id,
        job: job.title,
        profile: companyView(person, profile, current.analysis, now),
        match: jobMatch(job.requirements, profile, proved, now),
        request: state,
      },
    };
  });
  logEvent("info", result.ok ? "found_profile_viewed" : "found_profile_refused", result.ok ? {} : { reason: result.error });
  return result;
}

/* Message requests ------------------------------------------------------------------------------------------------ */

/**
 * Sends a message request to one person found from a job: one message in a company-owned chat, then nothing until they
 * accept. One found chat per company and person. Counts against the sender's 20 new requests a day and the company's
 * 200 messages a day, inside the transaction.
 */
export async function sendFoundRequest(userId: string, raw: unknown, deps: FindDeps = {}): Promise<FindResult<{ conversationId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = findRequestInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues.some((i) => i.path[0] === "body") ? "message" : "invalid");
  const input = parsed.data;
  const result = await db.transaction(async (tx): Promise<FindResult<{ conversationId: string }>> => {
    const ctx = await jobContext(userId, input.jobId, tx, now);
    if (!ctx.ok) return ctx;
    const { me, job } = ctx;
    const person = await resolve(ctx, userId, input.ref, tx, deps.env);
    if (!person) return fail("not_found");
    // One request at a time per company and person, so two tabs can't both start a chat.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`found|${me.orgId}|${person.id}`}))`);
    const state = (await requestStates(me.orgId, [person.id], tx)).get(person.id);
    if (state?.state === "waiting") return fail("waiting");
    if (state?.state === "open") return fail("accepted");
    if (state?.state === "closed") return fail("not_found");
    const at = { db: tx, now: now.getTime() };
    if (!(await takeShared(LIMITS.inboxRequestsPerUser, userId, at))) return fail("limit");
    if (!(await takeShared(LIMITS.companyMessagesPerCompanyDay, me.orgId, at))) return fail("limit");
    const [conversation] = await tx
      .insert(conversations)
      .values({ kind: "found", status: "request", startedBy: userId, orgId: me.orgId, jobId: job.id, createdAt: now, lastMessageAt: now })
      .returning({ id: conversations.id });
    await tx.insert(conversationMembers).values([
      { conversationId: conversation.id, userId: person.id, role: "member" },
      { conversationId: conversation.id, userId, role: "company_team", lastReadAt: now },
    ]);
    await tx.insert(messages).values({ conversationId: conversation.id, senderId: userId, body: input.body, createdAt: now });
    await writeAudit(tx, { orgId: me.orgId, actor: { memberId: me.memberId }, action: "found_request_sent", target: { job: job.id } }, now);
    return { ok: true, conversationId: conversation.id };
  });
  logEvent("info", result.ok ? "found_request_sent" : "found_request_refused", result.ok ? {} : { reason: result.error });
  return result;
}

/* Found chats on the company side ---------------------------------------------------------------------------------- */

/**
 * The company's found chats this member may read: Recruiter admins all of them; Hiring HR those whose job they move
 * candidates on. Interviewers none. People whose accounts are deleted never show.
 */
function foundChatsWhere(me: Member, userId: string): SQL {
  const scope =
    me.role === "admin"
      ? undefined
      : sql`exists (select 1 from ${jobTeam} t where t.job_id = ${conversations.jobId} and t.user_id = ${userId} and t.role in ('owner', 'hiring'))`;
  // A block is silent: the company's list reads as it did, so a blocked request looks exactly like a deleted one.
  return and(eq(conversations.orgId, me.orgId), eq(conversations.kind, "found"), isNull(users.deletionRequestedAt), scope)!;
}

const candidateJoin = and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.role, "member"));

/** The message requests the company sent to people it found, newest first, for Find people. */
export async function sentRequests(userId: string, deps: { db?: Db; now?: Date } = {}): Promise<SentRequestView[]> {
  const db = deps.db ?? getDb();
  const me = await activeMembership(userId, db, deps.now);
  if (!me || me.role === "interviewer") return [];
  const rows = await db
    .select({ id: conversations.id, status: conversations.status, name: users.name, job: jobs.title, createdAt: conversations.createdAt })
    .from(conversations)
    .innerJoin(conversationMembers, candidateJoin)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .leftJoin(jobs, eq(jobs.id, conversations.jobId))
    .where(foundChatsWhere(me, userId))
    .orderBy(desc(conversations.createdAt))
    .limit(50);
  return rows.map((r) => ({
    conversationId: r.id,
    name: displayName(r.name),
    job: r.job,
    state: r.status === "request" ? "waiting" : r.status === "open" ? "open" : "closed",
    sentOn: isoDay(r.createdAt),
  }));
}

/** Corporate Messages' list items for found chats, with the same preview and unread rules as application chats. */
export async function foundChatItems(userId: string, now: Date, db: Db = getDb()): Promise<(CompanyChatListItem & { lastAt: Date })[]> {
  const me = await activeMembership(userId, db, now);
  if (!me || me.role === "interviewer") return [];
  const rows = await db
    .select({ id: conversations.id, name: users.name, job: jobs.title, lastMessageAt: conversations.lastMessageAt })
    .from(conversations)
    .innerJoin(conversationMembers, candidateJoin)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .leftJoin(jobs, eq(jobs.id, conversations.jobId))
    .where(foundChatsWhere(me, userId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(200);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const last = await db
    .selectDistinctOn([messages.conversationId], { conversationId: messages.conversationId, body: messages.body, createdAt: messages.createdAt })
    .from(messages)
    .where(and(inArray(messages.conversationId, ids), ne(messages.kind, "system")))
    .orderBy(messages.conversationId, desc(messages.createdAt));
  const unread = await db.execute<{ id: string }>(sql`
    select c.id from ${conversations} c
    where c.id in ${ids} and exists (
      select 1 from ${messages} x where x.conversation_id = c.id and x.kind <> 'system' and x.sender_id is distinct from ${userId}
        and x.created_at > coalesce((select m.last_read_at from ${conversationMembers} m where m.conversation_id = c.id and m.user_id = ${userId}), '-infinity'::timestamptz))`);
  const unreadIds = new Set([...unread].map((r) => r.id));
  return rows.map((r) => {
    const l = last.find((m) => m.conversationId === r.id);
    return {
      applicationId: "",
      found: r.id,
      name: displayName(r.name),
      job: r.job ?? "A closed job",
      stage: null,
      preview: l?.body ?? null,
      at: l ? formatAt(l.createdAt, now) : null,
      unread: unreadIds.has(r.id),
      lastAt: r.lastMessageAt,
    };
  });
}

/** One found chat the member may read, locked for a write when asked. */
async function visibleFoundChat(userId: string, conversationId: string, db: Db | Tx, now: Date, lock = false) {
  if (!UUID.test(conversationId)) return fail("not_found");
  const me = await activeMembership(userId, db, now);
  if (!me) return fail("not_member");
  if (me.role === "interviewer") return fail("interviewer");
  const q = db
    .select({
      id: conversations.id,
      status: conversations.status,
      jobId: conversations.jobId,
      job: jobs.title,
      candidateId: users.id,
      name: users.name,
      orgStatus: organizations.reviewStatus,
    })
    .from(conversations)
    .innerJoin(conversationMembers, candidateJoin)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, conversations.orgId))
    .leftJoin(jobs, eq(jobs.id, conversations.jobId))
    .where(and(eq(conversations.id, conversationId), foundChatsWhere(me, userId)));
  const [chat] = lock ? await q.for("update", { of: conversations }) : await q;
  if (!chat) return fail("not_found");
  return { ok: true as const, me, chat };
}

/** Whether the company may write in a found chat now, or why not, in the board's chat states. */
async function foundChatState(chat: { status: string; orgStatus: string; candidateId: string }, orgId: string, db: Db | Tx): Promise<CompanyChatView["state"]> {
  if (chat.orgStatus !== "verified") return "suspended";
  if (chat.status === "closed") return "closed";
  // A request the person blocked reads "Waiting", like one they deleted: nothing more can be sent either way.
  if (chat.status === "request") return "waiting";
  const [blocked] = await db.select({ at: companyBlocks.createdAt }).from(companyBlocks).where(and(eq(companyBlocks.userId, chat.candidateId), eq(companyBlocks.orgId, orgId)));
  return blocked ? "closed" : "open";
}

/** One found chat for the company, as Corporate Messages shows it. With `markRead` it counts as read up to now. */
export async function companyFoundChat(userId: string, conversationId: string, deps: FindDeps & { markRead?: boolean } = {}): Promise<FindResult<{ chat: CompanyChatView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const found = await visibleFoundChat(userId, conversationId, db, now);
  if (!found.ok) return found;
  const { me, chat } = found;
  const rows = await db
    .select({ id: messages.id, senderId: messages.senderId, kind: messages.kind, body: messages.body, createdAt: messages.createdAt, name: users.name, deleted: users.deletionRequestedAt })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(and(eq(messages.conversationId, chat.id), sql`${messages.id} in (select id from ${messages} where conversation_id = ${chat.id} order by created_at desc limit ${MESSAGES_PER_CHAT})`))
    .orderBy(asc(messages.createdAt));
  const candidate = displayName(chat.name);
  const list = rows.map((m): CompanyChatMessage => {
    if (m.kind === "system") return { id: m.id, by: "system", who: "", text: m.body === "accepted" ? `${candidate} accepted your message request.` : "" };
    const base = { id: m.id, text: m.body, at: formatAt(m.createdAt, now) };
    if (m.senderId === userId) return { ...base, by: "me", who: "You" };
    if (m.senderId === chat.candidateId) return { ...base, by: "candidate", who: candidate };
    return { ...base, by: "team", who: m.senderId && !m.deleted ? displayName(m.name) : COMPANY_TEAM };
  });
  if (deps.markRead) {
    await db
      .insert(conversationMembers)
      .values({ conversationId: chat.id, userId, role: "company_team", lastReadAt: now })
      .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { lastReadAt: now } });
  }
  return {
    ok: true,
    chat: {
      applicationId: "",
      found: chat.id,
      jobId: chat.jobId ?? "",
      job: chat.job ?? "A closed job",
      candidate,
      stage: null,
      messages: list.filter((m) => m.text),
      state: await foundChatState(chat, me.orgId, db),
      canAskTimes: false,
    },
  };
}

/**
 * The company writes in a found chat the person accepted: Recruiter admins, and Hiring HR on its job, of a verified
 * company the person hasn't blocked. 20 a day per chat and the company's 200 a day.
 */
export async function sendFoundMessage(userId: string, raw: unknown, deps: FindDeps = {}): Promise<FindResult<{ messageId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = foundMessageInput.safeParse(raw);
  if (!parsed.success) return fail("message");
  const result = await db.transaction(async (tx): Promise<FindResult<{ messageId: string }>> => {
    const found = await visibleFoundChat(userId, parsed.data.conversationId, tx, now, true);
    if (!found.ok) return found;
    const { me, chat } = found;
    const state = await foundChatState(chat, me.orgId, tx);
    if (state === "suspended") return fail("not_verified");
    if (state === "waiting") return fail("waiting");
    if (state !== "open") return fail("not_found");
    const at = { db: tx, now: now.getTime() };
    if (!(await takeShared(LIMITS.companyMessagesPerFoundChatDay, chat.id, at))) return fail("limit");
    if (!(await takeShared(LIMITS.companyMessagesPerCompanyDay, me.orgId, at))) return fail("limit");
    const [message] = await tx.insert(messages).values({ conversationId: chat.id, senderId: userId, body: parsed.data.body, createdAt: now }).returning({ id: messages.id });
    await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, chat.id));
    await tx
      .insert(conversationMembers)
      .values({ conversationId: chat.id, userId, role: "company_team", lastReadAt: now })
      .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { lastReadAt: now } });
    return { ok: true, messageId: message.id };
  });
  logEvent("info", result.ok ? "found_message_sent" : "found_message_refused", result.ok ? {} : { reason: result.error });
  return result;
}

/* The page -------------------------------------------------------------------------------------------------------- */

/** The open jobs this member may search from: every open job for a Recruiter admin, the ones they are on for Hiring HR. */
async function searchableJobs(userId: string, me: Member, db: Db): Promise<FindJobOption[]> {
  const rows = await db
    .select({ id: jobs.id, title: jobs.title, city: jobs.city })
    .from(jobs)
    .where(
      and(
        eq(jobs.orgId, me.orgId),
        eq(jobs.status, "open"),
        me.role === "admin" ? undefined : sql`exists (select 1 from ${jobTeam} t where t.job_id = ${jobs.id} and t.user_id = ${userId} and t.role in ('owner', 'hiring'))`,
      ),
    )
    .orderBy(desc(jobs.createdAt));
  return rows;
}

/**
 * Corporate > Find people for this member. The job and band in the address only fill in the form: opening or sharing a
 * link never runs a search, uses up a limit or writes an audit line (Testing T41). A search runs only when the member
 * presses Search (searchPeople, from a server action).
 */
export async function findPeoplePage(
  userId: string,
  params: { jobId: string | null; band: FindBand | null; page: number },
  deps: FindDeps = {},
): Promise<FindPeopleView | null> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await activeMembership(userId, db, now);
  if (!me) return null;
  const [org] = await db.select({ status: organizations.reviewStatus }).from(organizations).where(eq(organizations.id, me.orgId));
  const status = org?.status ?? "pending";
  const view: FindPeopleView = { company: me.orgName, status, role: me.role, refusal: null, jobs: [], search: null, results: null, error: null, sent: [] };
  if (me.role === "interviewer") return { ...view, refusal: "interviewer" };
  if (status !== "verified") return { ...view, refusal: "not_verified" };
  if (!sealRef(userId, me.orgId, deps.env)) return { ...view, refusal: "unavailable" };
  const [jobOptions, sent] = await Promise.all([searchableJobs(userId, me, db), sentRequests(userId, { db, now })]);
  view.jobs = jobOptions;
  view.sent = sent;
  if (params.jobId) view.search = { jobId: params.jobId, band: params.band, page: params.page };
  return view;
}

/* The person's side ----------------------------------------------------------------------------------------------- */

/** Which companies opened the person's profile from a search in the last 30 days, and the companies they blocked. */
export async function discoveryFor(userId: string, deps: { db?: Db; now?: Date } = {}): Promise<DiscoveryView> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - FIND_VIEWS_KEEP_DAYS * DAY);
  const [views, blocked] = await Promise.all([
    db
      .select({ orgId: companyProfileViews.orgId, company: organizations.name, times: sql<number>`count(*)::int`, last: sql<Date>`max(${companyProfileViews.viewedAt})` })
      .from(companyProfileViews)
      .innerJoin(organizations, eq(organizations.id, companyProfileViews.orgId))
      .where(and(eq(companyProfileViews.userId, userId), gte(companyProfileViews.viewedAt, since)))
      .groupBy(companyProfileViews.orgId, organizations.name)
      .orderBy(desc(sql`max(${companyProfileViews.viewedAt})`)),
    db
      .select({ orgId: companyBlocks.orgId, company: organizations.name, since: companyBlocks.createdAt })
      .from(companyBlocks)
      .innerJoin(organizations, eq(organizations.id, companyBlocks.orgId))
      .where(eq(companyBlocks.userId, userId))
      .orderBy(desc(companyBlocks.createdAt)),
  ]);
  const blockedIds = new Set(blocked.map((b) => b.orgId));
  return {
    views: views.map((v) => ({ orgId: v.orgId, company: v.company, times: v.times, lastOn: formatDay(isoDay(new Date(v.last))), blocked: blockedIds.has(v.orgId) })),
    blocked: blocked.map((b) => ({ orgId: b.orgId, company: b.company, since: formatDay(isoDay(b.since)) })),
  };
}

/** Blocks a company from Settings. Only a company that exists; the answer never says more. */
export async function blockCompany(userId: string, raw: unknown, deps: { db?: Db; now?: Date } = {}): Promise<boolean> {
  const db = deps.db ?? getDb();
  const parsed = companyBlockInput.safeParse(raw);
  if (!parsed.success) return false;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, parsed.data.orgId));
  if (!org) return false;
  await db.transaction((tx) => blockCompanyIn(tx, userId, org.id, deps.now ?? new Date()));
  logEvent("info", "company_blocked");
  return true;
}

/** Lifts a company block. Chats the block closed stay closed. */
export async function unblockCompany(userId: string, raw: unknown, deps: { db?: Db } = {}): Promise<boolean> {
  const db = deps.db ?? getDb();
  const parsed = companyBlockInput.safeParse(raw);
  if (!parsed.success) return false;
  await db.delete(companyBlocks).where(and(eq(companyBlocks.userId, userId), eq(companyBlocks.orgId, parsed.data.orgId)));
  logEvent("info", "company_unblocked");
  return true;
}

/** For "Download your data": every company profile view still kept, and the companies blocked. */
export async function exportDiscovery(userId: string, db: Db = getDb()) {
  const [views, blocked] = await Promise.all([
    db
      .select({ company: organizations.name, job: jobs.title, viewedAt: companyProfileViews.viewedAt })
      .from(companyProfileViews)
      .innerJoin(organizations, eq(organizations.id, companyProfileViews.orgId))
      .leftJoin(jobs, eq(jobs.id, companyProfileViews.jobId))
      .where(eq(companyProfileViews.userId, userId))
      .orderBy(asc(companyProfileViews.viewedAt)),
    db
      .select({ company: organizations.name, blockedAt: companyBlocks.createdAt })
      .from(companyBlocks)
      .innerJoin(organizations, eq(organizations.id, companyBlocks.orgId))
      .where(eq(companyBlocks.userId, userId))
      .orderBy(asc(companyBlocks.createdAt)),
  ]);
  return { profileViews: views, blockedCompanies: blocked };
}

/** The daily clean-up: profile views older than 30 days. Returns how many went. */
export async function clearOldProfileViews(db: Db = getDb(), now = new Date()): Promise<number> {
  const gone = await db
    .delete(companyProfileViews)
    .where(lt(companyProfileViews.viewedAt, new Date(now.getTime() - FIND_VIEWS_KEEP_DAYS * DAY)))
    .returning({ id: companyProfileViews.id });
  return gone.length;
}

/**
 * Run inside the account purge, before the user row goes: the found chats sent to this person go with them, and the
 * messages they wrote for a company in found chats stay, from "the company team".
 */
export async function purgeFoundChats(tx: Db | Tx, userId: string): Promise<void> {
  await tx.execute(sql`delete from ${conversations} c where c.kind = 'found'
    and exists (select 1 from ${conversationMembers} m where m.conversation_id = c.id and m.user_id = ${userId} and m.role = 'member')`);
  await tx.execute(sql`update ${messages} m set sender_id = null from ${conversations} c
    where m.conversation_id = c.id and c.kind = 'found' and m.sender_id = ${userId}`);
}
