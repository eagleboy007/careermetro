import "server-only";
import { createHmac } from "node:crypto";
import { ipHashKey } from "@/lib/hash-keys";
import { and, eq, lt, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { rateLimits } from "@/db/schema";
import { errorFields, logEvent } from "@/lib/log";
import {
  AVAILABILITY_SAVES_PER_DAY,
  DEPARTURE_CHANGES_PER_DAY,
  ELITE_CHANGES_PER_DAY,
  JOB_SEARCH_CHANGES_PER_DAY,
  LIBRARY_CHANGES_PER_DAY,
  ME_EDITS_PER_DAY,
  MOCK_FEEDBACK_PER_DAY,
  MOCK_SESSIONS_PER_DAY,
  NOTIFICATION_READS_PER_DAY,
  RESOURCE_REPORTS_PER_DAY,
  SUGGESTIONS_PER_DAY,
  TIMED_TESTS_PER_DAY,
  TRACK_CHANGES_PER_DAY,
} from "@/lib/schemas/constants";

type Db = ReturnType<typeof getDb>;

/** A limit every server shares (H11): at most `max` hits per key in each fixed window of `windowMs`. */
export type SharedLimit = { bucket: string; max: number; windowMs: number };

const HOUR = 60 * 60 * 1000;

export const LIMITS = {
  /** Sign-in codes emailed to one address. */
  signInCodePerEmail: { bucket: "signin-code-email", max: 5, windowMs: HOUR },
  /** Sign-in codes asked for from one network address, to any addresses. */
  signInCodePerIp: { bucket: "signin-code-ip", max: 20, windowMs: HOUR },
  /** Waitlist sign-ups from one network address: enough for a family on one connection, not for a script. */
  waitlistPerIp: { bucket: "waitlist", max: 10, windowMs: HOUR },
  /** Files that couldn't be read, per network address per day (T18). Generous: a college network shares one address. */
  failedReadsPerIp: { bucket: "failed-read", max: 30, windowMs: 24 * HOUR },
  /** New message requests one person sends to people who aren't connections (dev/inbox-plan.md). */
  inboxRequestsPerUser: { bucket: "inbox-request", max: 20, windowMs: 24 * HOUR },
  /** Reports one person files: each starts IT Rules deadlines, so the grievance queue can't be flooded. */
  inboxReportsPerUser: { bucket: "inbox-report", max: 20, windowMs: 24 * HOUR },
  /** Tries at adding a certificate, whatever the outcome, so names and credential ids can't be guessed at by script. */
  certificateTriesPerUser: { bucket: "certificate-try", max: 30, windowMs: 24 * HOUR },
  /** Credly badge checks one person runs a day, on adding a certificate or from their profile (dev/profile-certs-plan.md). */
  credlyChecksPerUser: { bucket: "credly-check-user", max: 10, windowMs: 24 * HOUR },
  /** Credly badge checks an hour from everyone together, keyed "all", so we stay a polite caller of Credly. */
  credlyChecksAll: { bucket: "credly-check-all", max: 300, windowMs: HOUR },
  /** Work-email codes one person asks for (handoff 12d): 3 an hour and 10 a day. */
  workEmailCodePerUserHour: { bucket: "work-email-code-user-hour", max: 3, windowMs: HOUR },
  workEmailCodePerUserDay: { bucket: "work-email-code-user-day", max: 10, windowMs: 24 * HOUR },
  /** Work-email codes to one domain, from anyone, so the sender can't be used to flood a company's mail. */
  workEmailCodePerDomainDay: { bucket: "work-email-code-domain", max: 20, windowMs: 24 * HOUR },
  /** "Ask for access" requests one person sends to companies. */
  corporateRequestsPerUser: { bucket: "corporate-request", max: 5, windowMs: 24 * HOUR },
  /** Missing roles one person adds to role_requests a day (role-suggest-plan.md part B), so no one can fill the list. */
  roleRequestsPerOwner: { bucket: "role-request", max: 10, windowMs: 24 * HOUR },
  /** The same missing role counted for one person: once a day, however often they search for it. */
  roleRequestTitlePerOwner: { bucket: "role-request-title", max: 1, windowMs: 24 * HOUR },
  /** New jobs one company makes a day (dev/corporate-plan.md, Abuse and compliance). Keyed by the company's id. */
  jobsPerCompanyDay: { bucket: "job-create-company", max: 20, windowMs: 24 * HOUR },
  /** Applications one person makes a day on CareerMetro (corporate build step 4), so no script can spray a company. */
  applicationsPerUserDay: { bucket: "application-user", max: 20, windowMs: 24 * HOUR },
  /** Messages one company sends in its application chats a day, all its people together (plan, Abuse and compliance). Keyed by the company's id. */
  companyMessagesPerCompanyDay: { bucket: "company-message", max: 200, windowMs: 24 * HOUR },
  /** Messages a company sends in one application chat a day, so one candidate can't be flooded. Keyed by the application's id. */
  companyMessagesPerApplicationDay: { bucket: "company-message-application", max: 20, windowMs: 24 * HOUR },
  /** Messages one person sends in their application chats a day, across every company. */
  applicationMessagesPerUserDay: { bucket: "application-message-user", max: 50, windowMs: 24 * HOUR },
  /** "Is this username free?" checks one person makes, so the list of usernames can't be read out by script. */
  usernameChecksPerUser: { bucket: "username-check", max: 60, windowMs: HOUR },
  /** Tries at saving a new username, whatever the outcome. The 30-day rule limits changes that succeed. */
  usernameSavesPerUser: { bucket: "username-save", max: 10, windowMs: 24 * HOUR },
  /** Searches for people one company member runs (dev/companies-find-me-plan.md), so results can't be read out by script. */
  findSearchesPerUserHour: { bucket: "find-search-user", max: 30, windowMs: HOUR },
  /** Searches for people one company runs a day, all its people together. Keyed by the company's id. */
  findSearchesPerCompanyDay: { bucket: "find-search-company", max: 200, windowMs: 24 * HOUR },
  /** Profiles one company member opens from searches an hour. */
  findOpensPerUserHour: { bucket: "find-open-user", max: 60, windowMs: HOUR },
  /**
   * Profiles one company opens from searches a day, all its people together, so adding Hiring HR adds no openings
   * (security review 2026-10-13). 1.5 times the company's 200 searches. Keyed by the company's id.
   */
  findOpensPerCompanyDay: { bucket: "find-open-company", max: 300, windowMs: 24 * HOUR },
  /** Messages a company sends in one found chat a day, after the person accepted. Keyed by the chat's id. */
  companyMessagesPerFoundChatDay: { bucket: "company-message-found", max: 20, windowMs: 24 * HOUR },
  /** New connection requests one person sends a day (Network, FR-49). */
  networkRequestsPerUser: { bucket: "network-request", max: 20, windowMs: 24 * HOUR },
  /** Network searches by name one person runs an hour, so the list of people can't be read out by script. */
  networkSearchesPerUserHour: { bucket: "network-search", max: 30, windowMs: HOUR },
  /**
   * Build your resume (FR-36): draft saves an hour per person. The screen saves only when the answers changed, at most
   * once every two seconds while typing, and on each Next; seven sections of about 30 fields, each changed and maybe
   * corrected, come to well under 200 in a sitting, while a script still gets only about 3 writes a minute.
   */
  builderSavesPerUserHour: { bucket: "builder-save", max: 200, windowMs: HOUR },
  /** Reviews ("Review my resume", "Update my resume") an hour per person: each saves and builds, and may reword. */
  builderBuildsPerUserHour: { bucket: "builder-build", max: 30, windowMs: HOUR },
  /** Rewords a day per person; they also count toward the parse budget. */
  builderRewordsPerUserDay: { bucket: "builder-reword", max: 5, windowMs: 24 * HOUR },
  /** Elite (FR-50): turning it on or off, each try counted, so the switch can't be scripted. */
  eliteChangesPerUserDay: { bucket: "elite-change", max: ELITE_CHANGES_PER_DAY, windowMs: 24 * HOUR },
  /** "Show the Elite badge on my profile" switched a day per person. */
  eliteBadgePerUserDay: { bucket: "elite-badge", max: 20, windowMs: 24 * HOUR },
  /** Timed tests (FR-50 part 2) one person starts a day, each start counted, so the bank can't be read out by script. */
  timedTestsPerUserDay: { bucket: "timed-test", max: TIMED_TESTS_PER_DAY, windowMs: 24 * HOUR },
  /** Mock interviews (FR-50 part 3) one person starts a day, each start counted. */
  mockSessionsPerUserDay: { bucket: "mock-session", max: MOCK_SESSIONS_PER_DAY, windowMs: 24 * HOUR },
  /** Mock interview sessions one person gets feedback on a day: each is one model call, inside its own daily budget. */
  mockFeedbackPerUserDay: { bucket: "mock-feedback", max: MOCK_FEEDBACK_PER_DAY, windowMs: 24 * HOUR },
  /** "Looking for a job" and the notice period (docs/plans/job-search-plan.md): changes a day per person, each try counted. */
  jobSearchChangesPerUserDay: { bucket: "job-search-change", max: JOB_SEARCH_CHANGES_PER_DAY, windowMs: 24 * HOUR },
  /** Saves and stage changes on Departures (docs/plans/departures-live-plan.md), each try counted. */
  departureChangesPerUserDay: { bucket: "departure-change", max: DEPARTURE_CHANGES_PER_DAY, windowMs: 24 * HOUR },
  /** Save, "I finished this" and Add to my rides in the Library (docs/plans/library-part-2-plan.md), each try counted. */
  libraryChangesPerUserDay: { bucket: "library-change", max: LIBRARY_CHANGES_PER_DAY, windowMs: 24 * HOUR },
  /** "Report a broken link" tries one person makes a day. */
  resourceReportsPerUserDay: { bucket: "resource-report", max: RESOURCE_REPORTS_PER_DAY, windowMs: 24 * HOUR },
  /** "Suggest a free resource" tries one person makes a day. */
  resourceSuggestionsPerUserDay: { bucket: "resource-suggestion", max: SUGGESTIONS_PER_DAY, windowMs: 24 * HOUR },
  /** Adds, edits and deletes on Me (docs/plans/me-editing-plan.md): roles, education, stories and interests, each try counted. */
  meEditsPerUserDay: { bucket: "me-edit", max: ME_EDITS_PER_DAY, windowMs: 24 * HOUR },
  /** Opening the notifications panel, which marks every row read (docs/plans/notifications-plan.md), each try counted. */
  notificationReadsPerUserDay: { bucket: "notification-read", max: NOTIFICATION_READS_PER_DAY, windowMs: 24 * HOUR },
  /** "Usually free" saves from the Inbox (docs/plans/settings-columns-plan.md), each try counted. */
  availabilityPerUserDay: { bucket: "availability-save", max: AVAILABILITY_SAVES_PER_DAY, windowMs: 24 * HOUR },
  /** Today's signal check answers (docs/plans/today-live-plan.md), each try counted; one question a day, so this is generous. */
  signalAnswersPerUserDay: { bucket: "signal-answer", max: 100, windowMs: 24 * HOUR },
  /** Track switches on Your goals (docs/plans/tracks-plan.md), each try counted. */
  trackChangesPerUserDay: { bucket: "track-change", max: TRACK_CHANGES_PER_DAY, windowMs: 24 * HOUR },
  /**
   * Account settings saves a day per person, each try counted (launch-readiness pass, docs/plans/launch-readiness-pass.md).
   * One Save sends the whole form, so 100 is far more than anyone needs, while a script can't turn "Let companies find
   * me" on and off without end, each on writing a consent row.
   */
  settingsSavesPerUserDay: { bucket: "settings-save", max: 100, windowMs: 24 * HOUR },
  /** Unblocks from Settings > Privacy a day per person, each try counted, so a block and unblock loop can't be scripted. */
  unblocksPerUserDay: { bucket: "unblock", max: 50, windowMs: 24 * HOUR },
} satisfies Record<string, SharedLimit>;

/** Rows this much older than their window are deleted by the daily cleanup (clearOldRateLimits). */
const KEEP_MS = 2 * 24 * HOUR;

/** A keyed hash of the email or IP, so the table never holds either. The key is the same one as the client hash. */
const keyHash = (bucket: string, key: string) => createHmac("sha256", ipHashKey()).update(`${bucket}|${key}`).digest("base64url");

const windowStart = (limit: SharedLimit, now: number) => new Date(Math.floor(now / limit.windowMs) * limit.windowMs);

/**
 * Counts one hit for `key` and says whether it is still within the limit. One statement adds the hit and returns the
 * new count, so two servers can't both pass the last free hit. Windows are fixed, so a burst across a boundary can
 * reach twice the limit; fine for abuse limits. If the database can't be reached the request is let through and
 * logged: a broken limiter must not lock everyone out. Old windows are deleted by the daily cleanup, never here, so a
 * hit can't wipe counts another request is still using (it made the daily-limit tests flaky, 2026-10-16).
 *
 * Inside a transaction, pass the transaction as `db`: the hit then uses the connection the transaction already holds
 * (a second pooled connection per send would deadlock the pool under load) and is undone if the transaction rolls
 * back. It runs in a savepoint, so a failed count can't abort the caller's transaction.
 */
export async function takeShared(limit: SharedLimit, key: string, deps: { db?: Db | Tx; now?: number } = {}): Promise<boolean> {
  const now = deps.now ?? Date.now();
  try {
    const db = deps.db ?? getDb();
    const inTransaction = db instanceof PgTransaction;
    const count = (on: Db | Tx) =>
      on
        .insert(rateLimits)
        .values({ bucket: limit.bucket, keyHash: keyHash(limit.bucket, key), windowStart: windowStart(limit, now) })
        .onConflictDoUpdate({
          target: [rateLimits.bucket, rateLimits.keyHash, rateLimits.windowStart],
          set: { hits: sql`${rateLimits.hits} + 1` },
        })
        .returning({ hits: rateLimits.hits });
    const [row] = inTransaction ? await db.transaction((savepoint) => count(savepoint)) : await count(db);
    return row.hits <= limit.max;
  } catch (error) {
    logEvent("error", "rate_limit_unavailable", { bucket: limit.bucket, ...errorFields(error) });
    return true;
  }
}

/** Daily cleanup (api/cron/cleanup): deletes windows that started more than two days ago. Returns how many. */
export async function clearOldRateLimits(db: Db = getDb(), now = new Date()): Promise<number> {
  const gone = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - KEEP_MS)))
    .returning({ bucket: rateLimits.bucket });
  return gone.length;
}

/** Whether `key` has hits left in the current window, without counting one. Lets the request through on a database error. */
export async function allowsShared(limit: SharedLimit, key: string, deps: { db?: Db; now?: number } = {}): Promise<boolean> {
  const now = deps.now ?? Date.now();
  try {
    const [row] = await (deps.db ?? getDb())
      .select({ hits: rateLimits.hits })
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.bucket, limit.bucket),
          eq(rateLimits.keyHash, keyHash(limit.bucket, key)),
          eq(rateLimits.windowStart, windowStart(limit, now)),
        ),
      );
    return (row?.hits ?? 0) < limit.max;
  } catch (error) {
    logEvent("error", "rate_limit_unavailable", { bucket: limit.bucket, ...errorFields(error) });
    return true;
  }
}

/**
 * The key for a per-address limit. An IPv6 address counts by its /64, since one connection is usually given a whole
 * /64 and could step through it to dodge the limit. IPv4 addresses count as they are.
 */
export function addressKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
