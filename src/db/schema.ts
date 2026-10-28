import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  CONVERSATION_KINDS,
  CONVERSATION_STATUSES,
  MEMBER_ROLES,
  MESSAGE_KINDS,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGETS,
} from "../lib/schemas/inbox";
import { NOTIFICATION_KINDS, RESOURCE_REPORT_REASONS, RESOURCE_REPORT_STATUSES, SUGGESTION_DECLINE_REASONS, SUGGESTION_STATUSES } from "../lib/schemas/constants";
import {
  APPLICATION_EVENT_KINDS,
  APPLICATION_STAGES,
  CAN_JOIN,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_ROUNDS,
  INTERVIEW_STATUSES,
  CONNECTION_HOWS, CONNECTION_REQUEST_STATUSES, GAPS_VISIBLE_TO, JOB_CHECK_SOURCES, JOB_EMAIL_CHECK_STATUSES, JOB_STATUSES, JOB_TEAM_ROLES, JOB_WORK_TYPES, MOCK_FOCUSES, MOCK_LENGTHS, ORG_INVITE_KINDS, ORG_REVIEW_STATUSES, ORG_ROLES, ORG_TYPES, PROFILE_VISIBILITIES, REQUESTS_FROM, RIDE_REMINDERS, WORK_EMAIL_PURPOSES } from "../lib/schemas/constants";
import { GOAL_SOURCES, GOAL_STATUSES, PROOF_STATUSES, PROOF_TYPES, PROOF_VERIFIERS, STEP_KINDS, STEP_SOURCES } from "../lib/schemas/goals";
import type { BuilderAnswers, CredlyCheckNote, GapAnalysis, JobCriteria, JobRequirements, MockSessionFeedback, PracticeFeedback, Profile, ProofEvidence, ResumeScreening, RoleProfile } from "@/lib/schemas";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* Accounts ---------------------------------------------------------------- */

export const orgType = pgEnum("org_type", ORG_TYPES);
export const orgReviewStatus = pgEnum("org_review_status", ORG_REVIEW_STATUSES);
export const orgRole = pgEnum("org_role", ORG_ROLES);
export const workEmailPurpose = pgEnum("work_email_purpose", WORK_EMAIL_PURPOSES);
export const orgInviteKind = pgEnum("org_invite_kind", ORG_INVITE_KINDS);

/**
 * A company on the employer side (dev/corporate-plan.md, handoff 12f). It owns one email domain, proved by a code to
 * its first Recruiter admin's work email, and is checked by hand (`review_status`) before its jobs can go live. Access
 * comes only from `org_members`; `users.organization_id` stays unused (it was for the Phase 3 team shuttle).
 */
export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    /** The name candidates see. */
    name: text("name").notNull(),
    type: orgType("type").notNull().default("company"),
    /** As on the incorporation or GST papers. */
    legalName: text("legal_name"),
    website: text("website"),
    /** Lowercase. Work emails on it or its subdomains confirm members. One company per domain. */
    emailDomain: text("email_domain"),
    size: text("size"),
    city: text("city"),
    about: text("about"),
    industry: text("industry"),
    offices: text("offices"),
    /** Optional GSTIN or CIN, only for the hand check. Never shown to anyone. */
    gstinOrCin: text("gstin_or_cin"),
    /** When the first admin's work-email code proved the domain. */
    domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),
    reviewStatus: orgReviewStatus("review_status").notNull().default("pending"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Who checked it: "admin:<user id>" from /admin/companies, or "github:<login>" from the Companies workflow. Never an email. */
    reviewedBy: text("reviewed_by"),
    /** The admin rule (Milin, 2026-10-12): a second Recruiter admin by this date, or no new jobs open. */
    secondAdminDueAt: timestamp("second_admin_due_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  // The domain is stored lowercase by the code that writes it (src/lib/corporate/domains.ts). No CHECK constraints
  // here: adding one to an existing table is a contract step (src/db/migrations.test.ts), and Zod checks lengths.
  (t) => [uniqueIndex("organizations_email_domain").on(t.emailDomain)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    /** The full name, made from first and last name. Shown on the profile and used for the resume name check. */
    name: text("name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** The sign-in provider's id for this user. No foreign key to the provider's tables, so it can be swapped. */
    authSubject: text("auth_subject").unique(),
    /** When the user ticked "I am 18 or older" at sign-up. */
    ageConfirmedAt: timestamp("age_confirmed_at", { withTimezone: true }),
    /** Updated at most once a day; drives the inactive-account policy. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    organizationId: uuid("organization_id").references(() => organizations.id),
    weeklyHours: integer("weekly_hours").notNull().default(5),
    createdAt: createdAt(),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    /**
     * The profile link careermetro.com/u/<username> (account settings part 2). Stored lowercase, unique ignoring case.
     * Never logged and never in a URL except that link.
     */
    username: text("username"),
    /** When the username was last saved; the next change waits USERNAME_CHANGE_DAYS. */
    usernameChangedAt: timestamp("username_changed_at", { withTimezone: true }),
    /** Optional one line under the name on the profile. */
    headline: text("headline"),
    /**
     * Optional city, one of PERSON_CITIES (T44, Milin 2026-10-15). Only companies that can find the person see it and
     * filter by it; never on the public profile. Checked by Zod, so no CHECK constraint on this existing table.
     */
    city: text("city"),
    /**
     * Suspended by a CareerMetro admin after a report (FR-46, docs/plans/reports-review-plan.md): the person sees only the
     * suspension notice and companies stop seeing them. Lifting clears all three. Never deletes anything.
     */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    /** The admin who suspended the account. Not indexed: an admin's id, never queried by. */
    suspendedBy: uuid("suspended_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    /** The admin's reason, shown to the person on the notice. Never logged. */
    suspendedReason: text("suspended_reason"),
  },
  // Matching by email when the provider changes must ignore case. So must usernames.
  (t) => [
    uniqueIndex("users_email_lower").on(sql`lower(${t.email})`),
    uniqueIndex("users_username_lower").on(sql`lower(${t.username})`),
    check("users_suspended_reason_length", sql`char_length(${t.suspendedReason}) between 1 and 500`),
  ],
);

export const profileVisibility = pgEnum("profile_visibility", PROFILE_VISIBILITIES);
export const rideReminder = pgEnum("ride_reminder", RIDE_REMINDERS);

/**
 * An old username after a change: /u/<old> redirects to the person's profile until `expires_at` (14 days), and nobody
 * else can take it before then. Removed with the account.
 */
export const usernameRedirects = pgTable(
  "username_redirects",
  {
    /** Lowercase, as in users.username. */
    username: text("username").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("username_redirects_user").on(t.userId)],
);

/**
 * Current and expected pay, in lakh a year (handoff 12c). Owner-only: read by the person's own settings and download,
 * never by a profile, a company or anything else, and never logged. Clearing both removes the row.
 */
export const userPay = pgTable(
  "user_pay",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    currentLakh: numeric("current_lakh", { precision: 6, scale: 2, mode: "number" }),
    expectedLakh: numeric("expected_lakh", { precision: 6, scale: 2, mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("user_pay_current", sql`${t.currentLakh} is null or ${t.currentLakh} between 0.1 and 999`),
    check("user_pay_expected", sql`${t.expectedLakh} is null or ${t.expectedLakh} between 0.1 and 999`),
  ],
);

/**
 * Privacy and notification choices from Account settings. No row means DEFAULT_SETTINGS (src/lib/schemas/account-settings.ts).
 * Notification choices are stored only: nothing is sent until there is an email sender (pending item 21).
 */
export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  profileVisibility: profileVisibility("profile_visibility").notNull().default("only_me"),
  showTargetRole: boolean("show_target_role").notNull().default(false),
  showExperience: boolean("show_experience").notNull().default(true),
  showEducation: boolean("show_education").notNull().default(true),
  showSkills: boolean("show_skills").notNull().default(true),
  showGaps: boolean("show_gaps").notNull().default(false),
  showCertifications: boolean("show_certifications").notNull().default(true),
  /** "Let companies find me" (pending item 19): off until the person turns it on. Off takes them out of searches at once. */
  companiesCanFind: boolean("companies_can_find").notNull().default(false),
  /** "Let people find me" (Network, FR-49, handoff 12j): off until the person turns it on. Off takes them out of name search at once. */
  peopleCanFind: boolean("people_can_find").notNull().default(false),
  /**
   * "Your gaps show to" (handoff 12j): nobody, connections, or everyone who can open the profile. New rows default to
   * connections (ruling 4, new users only); migration 0034 set existing rows from show_gaps (on: profile, off: nobody).
   */
  gapsVisibleTo: text("gaps_visible_to", { enum: GAPS_VISIBLE_TO }).notNull().default("connections"),
  /** "Connection requests from" (handoff 12j): anyone who can reach the person, or nobody. */
  requestsFrom: text("requests_from", { enum: REQUESTS_FROM }).notNull().default("anyone"),
  rideReminder: rideReminder("ride_reminder").notNull().default("19:30"),
  emailCompanyMessages: boolean("email_company_messages").notNull().default(true),
  emailWeeklySummary: boolean("email_weekly_summary").notNull().default(false),
  /**
   * "Looking for a job" (handoff 6, docs/plans/job-search-plan.md, migration 0039). Off pauses Departures and Arrivals:
   * no Express apply, out of company search, no Today board. Rides, streak and the map keep going.
   */
  jobSearch: boolean("job_search").notNull().default(true),
  /** The notice period in days (15, 30, 60 or 90), private: never on a profile or sent to a company. */
  noticeDays: smallint("notice_days"),
  /** The India date the person resigned, which starts the countdown. Never later than today; needs notice_days. */
  resignedOn: date("resigned_on"),
  /**
   * "Allow message requests from people who aren't connections" (FR-55, migration 0045): on by default. Off, a first
   * message from someone who isn't a connection is refused like a block; requests already there stay.
   */
  messageRequests: boolean("message_requests").notNull().default(true),
  /**
   * "Open to work in" (FR-55): Remote or PERSON_CITIES, at most 6, Remote first. Filters the person's Departures, is
   * copied onto each Express apply application, and companies that can find them see it. Never on a profile.
   */
  openToWorkIn: text("open_to_work_in").array().notNull().default(sql`'{}'::text[]`),
  /**
   * "Usually free" (FR-55): weekday picker hours as "mon 17:00", at most 40. Private: it never leaves the person's own
   * pages and only pre-ticks open times when a company asks for times.
   */
  usuallyFree: text("usually_free").array().notNull().default(sql`'{}'::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [
    check("user_settings_notice_days", sql`${t.noticeDays} is null or ${t.noticeDays} in (15, 30, 60, 90)`),
    check("user_settings_resigned_needs_days", sql`${t.resignedOn} is null or ${t.noticeDays} is not null`),
    check("user_settings_open_to_work_in_max", sql`cardinality(${t.openToWorkIn}) <= 6`),
    // Each entry a weekday and a picker time (FREE_DAYS by SLOT_TIMES), checked again by usuallyFreeInput.
    check("user_settings_usually_free_slots", sql`cardinality(${t.usuallyFree}) <= 40 and ${t.usuallyFree} <@ array['mon 10:00', 'mon 11:00', 'mon 12:00', 'mon 14:00', 'mon 15:00', 'mon 16:00', 'mon 17:00', 'mon 18:00', 'tue 10:00', 'tue 11:00', 'tue 12:00', 'tue 14:00', 'tue 15:00', 'tue 16:00', 'tue 17:00', 'tue 18:00', 'wed 10:00', 'wed 11:00', 'wed 12:00', 'wed 14:00', 'wed 15:00', 'wed 16:00', 'wed 17:00', 'wed 18:00', 'thu 10:00', 'thu 11:00', 'thu 12:00', 'thu 14:00', 'thu 15:00', 'thu 16:00', 'thu 17:00', 'thu 18:00', 'fri 10:00', 'fri 11:00', 'fri 12:00', 'fri 14:00', 'fri 15:00', 'fri 16:00', 'fri 17:00', 'fri 18:00']::text[]`),
  ],
);

/** What the user agreed to and when (DPDP Act, SEC-1). */
export const consents = pgTable("consents", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email"),
  purpose: text("purpose").notNull(),
  policyVersion: text("policy_version").notNull(),
  givenAt: timestamp("given_at", { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
},
  (t) => [index("consents_user").on(t.userId)],
);

export const waitlistEntries = pgTable("waitlist_entries", {
  id: id(),
  email: text("email").notNull().unique(),
  targetRole: text("target_role"),
  confirmToken: text("confirm_token").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* Resume and profile ------------------------------------------------------ */

export const parseStatus = pgEnum("parse_status", ["uploaded", "parsing", "parsed", "partial", "failed"]);

export const resumes = pgTable(
  "resumes",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Anonymous first analysis (FR-2): deleted after 24 hours unless claimed. */
    anonymousSessionId: text("anonymous_session_id"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: parseStatus("status").notNull().default("uploaded"),
    /** The consent the user gave at upload (SEC-1). */
    consentId: uuid("consent_id").references(() => consents.id),
    /** Keyed hash of the uploader's IP and the day, for daily upload limits. Can't be reversed or linked across days. */
    clientHash: text("client_hash"),
    /**
     * Keyed hashes of the words of the name printed on the resume, for the name check before it joins an account
     * (src/lib/resume/name-match.ts). The name itself is never stored. Null when the resume shows no name.
     */
    nameHashes: text("name_hashes").array(),
    /**
     * FR-34: what the upload found about layout and section headings, read while the file was in memory
     * (src/lib/resume/layout.ts, sections.ts). Counts, yes/no flags and fixed codes only, never resume text.
     * Null for resumes uploaded before the check, which are never guessed.
     */
    screening: jsonb("screening").$type<ResumeScreening>(),
    createdAt: createdAt(),
    /** When the raw file must be removed (SEC-5). Null when no file was kept, the default: text is read in memory. */
    fileDeleteAfter: timestamp("file_delete_after", { withTimezone: true }),
    /** "builder" for a resume made from answers at /builder (FR-36): no file, no storage key, its draft in resume_drafts. */
    source: text("source", { enum: ["upload", "builder"] }).notNull().default("upload"),
  },
  (t) => [
    check("resumes_source", sql`${t.source} in ('upload', 'builder')`),
    index("resumes_anonymous_session").on(t.anonymousSessionId),
    index("resumes_client_hash").on(t.clientHash, t.createdAt),
    index("resumes_user").on(t.userId),
    index("resumes_consent").on(t.consentId),
  ],
);

/**
 * The answers of Build your resume (FR-36, docs/plans/resume-builder-plan.md), one draft a person, saved as they go.
 * Resume text: never logged. `resumeId` is the resume last built from it. Goes with the account; in Download your data.
 */
export const resumeDrafts = pgTable(
  "resume_drafts",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<BuilderAnswers>().notNull(),
    resumeId: uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resume_drafts_resume").on(t.resumeId)],
);

/** Versioned: every user correction creates a new row. */
export const profiles = pgTable(
  "profiles",
  {
    id: id(),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    data: jsonb("data").$type<Profile>().notNull(),
    confirmedByUser: boolean("confirmed_by_user").notNull().default(false),
    aiCallId: uuid("ai_call_id").references(() => aiCalls.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("profiles_resume_version").on(t.resumeId, t.version)],
);

/* Skills and roles -------------------------------------------------------- */

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  createdAt: createdAt(),
});

/** Exact-match aliases ("MS Excel", "Excel") map to one skill before any fuzzy matching. */
export const skillAliases = pgTable(
  "skill_aliases",
  {
    alias: text("alias").notNull(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.alias, t.skillId] })],
);

export const roleProfiles = pgTable(
  "role_profiles",
  {
    id: id(),
    slug: text("slug").notNull(),
    version: integer("version").notNull(),
    data: jsonb("data").$type<RoleProfile>().notNull(),
    published: boolean("published").notNull().default(false),
    updatedOn: date("updated_on").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("role_profiles_slug_version").on(t.slug, t.version)],
);

/** A job description the user pasted; private to them. */
export const jobDescriptions = pgTable("job_descriptions", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  rawText: text("raw_text").notNull(),
  parsed: jsonb("parsed").$type<RoleProfile>(),
  createdAt: createdAt(),
},
  (t) => [index("job_descriptions_user").on(t.userId)],
);

/**
 * "Check against a job" (role-suggest-plan.md part B): the skills one pasted posting asks for, checked against a resume
 * and its target role, with a keyed hash of the text so the same text isn't read twice. A job added to My jobs ("Add a
 * job you found", docs/plans/application-tracker-plan.md) also keeps its link, where it came from, its city and the
 * person's own copy of the description (Milin, 2026-10-28): private, never logged, in Download your data. The Gaps
 * page's check keeps no text. Goes with its resume: an anonymous one with the 24-hour cleanup, an account's with
 * account deletion (an account's resumes are never deleted before that).
 */
export const jobChecks = pgTable(
  "job_checks",
  {
    id: id(),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    /** The target role checked against; null when the check stands in for a role our library doesn't have yet. */
    roleSlug: text("role_slug"),
    company: text("company").notNull(),
    title: text("title").notNull(),
    requiredSkillIds: text("required_skill_ids").array().notNull().default(sql`'{}'::text[]`),
    niceSkillIds: text("nice_skill_ids").array().notNull().default(sql`'{}'::text[]`),
    /** Names the posting asks for that aren't in our skill list yet. Shown, never scored. */
    unknownSkills: text("unknown_skills").array().notNull().default(sql`'{}'::text[]`),
    /** HMAC of the posting text (src/lib/jobs/store.ts). */
    textHash: text("text_hash").notNull(),
    aiCallId: uuid("ai_call_id").references(() => aiCalls.id),
    /** The job's own page, https, from "Add a job you found"; fetched only when it is a company job board's. */
    url: text("url"),
    /** "pasted" (the person pasted it) or "board" (read from a company job board's public API). */
    source: text("source", { enum: ["pasted", "board"] }).notNull().default("pasted"),
    city: text("city"),
    /** The person's own copy of the description, for My jobs only; never logged. */
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [
    index("job_checks_resume").on(t.resumeId, t.createdAt),
    check("job_checks_source", sql`${t.source} in ('pasted', 'board')`),
    check("job_checks_url", sql`${t.url} is null or (${t.url} like 'https://%' and char_length(${t.url}) <= 2000)`),
    check("job_checks_city_length", sql`${t.city} is null or char_length(${t.city}) between 1 and 60`),
    check("job_checks_description_length", sql`${t.description} is null or char_length(${t.description}) <= 20000`),
  ],
);

/**
 * Roles people looked for that our library doesn't have (role-suggest-plan.md part B): a typed title, normalised
 * (src/lib/schemas/job-check.ts), and how often it was asked for. Nothing about the person is kept, so the daily
 * cleanup leaves it alone. Counted by src/lib/jobs/role-requests.ts, at most once a day per person and title.
 */
export const roleRequests = pgTable("role_requests", {
  title: text("title").primaryKey(),
  count: integer("count").notNull().default(1),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
});

/* AI calls and analyses --------------------------------------------------- */

/** Every model call: what ran, on which inputs, and what it cost (AI-3, AI-6). Never stores resume text. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: id(),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputRefs: jsonb("input_refs").$type<Record<string, string>>().notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    ok: boolean("ok").notNull(),
    /**
     * Set only on calls reserved before they run (Gaps and Path wording): "reserved" while the call runs, "done" once
     * its numbers are written. Null on calls logged after the fact. Reservations count toward the daily limits at once.
     */
    status: text("status").$type<"reserved" | "done">(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_created_at").on(t.createdAt)],
);

export const gapAnalyses = pgTable("gap_analyses", {
  id: id(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  roleProfileId: uuid("role_profile_id").references(() => roleProfiles.id),
  jobDescriptionId: uuid("job_description_id").references(() => jobDescriptions.id, { onDelete: "cascade" }),
  result: jsonb("result").$type<GapAnalysis>().notNull(),
  matcherVersion: text("matcher_version").notNull(),
  aiCallId: uuid("ai_call_id").references(() => aiCalls.id),
  userRating: integer("user_rating"),
  createdAt: createdAt(),
},
  (t) => [index("gap_analyses_profile").on(t.profileId, t.createdAt), index("gap_analyses_job_description").on(t.jobDescriptionId)],
);

/* Paths and resources ----------------------------------------------------- */

export const resources = pgTable("resources", {
  id: id(),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(),
  skillIds: text("skill_ids").array().notNull(),
  minutes: integer("minutes").notNull(),
  free: boolean("free").notNull().default(true),
  healthy: boolean("healthy").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: createdAt(),
  /**
   * Hidden by an admin from /admin/library (docs/plans/library-part-2-plan.md): it leaves the Library, paths and rides
   * at once. Apart from `healthy`, which the daily link check writes, so the check can't bring a hidden link back.
   */
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
});

export const resourceChecks = pgTable("resource_checks", {
  id: id(),
  resourceId: uuid("resource_id")
    .notNull()
    .references(() => resources.id, { onDelete: "cascade" }),
  ok: boolean("ok").notNull(),
  detail: text("detail"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index("resource_checks_resource").on(t.resourceId, t.checkedAt)],
);

export const goalStatus = pgEnum("goal_status", GOAL_STATUSES);
export const stepKind = pgEnum("step_kind", STEP_KINDS);
export const stepSource = pgEnum("step_source", STEP_SOURCES);
export const goalSource = pgEnum("goal_source", GOAL_SOURCES);
export const proofType = pgEnum("proof_type", PROOF_TYPES);
export const proofStatus = pgEnum("proof_status", PROOF_STATUSES);
export const proofVerifier = pgEnum("proof_verifier", PROOF_VERIFIERS);

export const paths = pgTable("paths", {
  id: id(),
  gapAnalysisId: uuid("gap_analysis_id")
    .notNull()
    .references(() => gapAnalyses.id, { onDelete: "cascade" }),
  weeklyHours: integer("weekly_hours").notNull(),
  aiCallId: uuid("ai_call_id").references(() => aiCalls.id),
  createdAt: createdAt(),
},
  (t) => [index("paths_gap_analysis").on(t.gapAnalysisId, t.createdAt)],
);

export const pathSteps = pgTable(
  "path_steps",
  {
    id: id(),
    pathId: uuid("path_id")
      .notNull()
      .references(() => paths.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    reason: text("reason").notNull(),
    hours: integer("hours").notNull(),
    resourceIds: uuid("resource_ids").array().notNull(),
    proofTask: text("proof_task").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    /** The person's goal for this skill. Null on an anonymous visitor's path, which has no goals. */
    goalId: uuid("goal_id").references(() => userGoals.id, { onDelete: "set null" }),
    kind: stepKind("kind").notNull().default("learn"),
    source: stepSource("source").notNull().default("app"),
  },
  (t) => [uniqueIndex("path_steps_position").on(t.pathId, t.position), index("path_steps_goal").on(t.goalId)],
);

/* Goals and proof ----------------------------------------------------------- */

/**
 * One goal per person and skill (handoff section 6). Goals belong to the person, not to one resume, so a new upload
 * keeps their order and proof. `swapped_to` and `skipped_at` are for "Not for me" (build step 10).
 */
export const userGoals = pgTable(
  "user_goals",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    source: goalSource("source").notNull().default("gap"),
    status: goalStatus("status").notNull().default("active"),
    position: integer("position").notNull(),
    /** The analysis that first made this goal. */
    gapAnalysisId: uuid("gap_analysis_id").references(() => gapAnalyses.id, { onDelete: "set null" }),
    swappedTo: text("swapped_to").references(() => skills.id),
    /** Set when the goal stands for a "one of these" group of the role: proof of any skill in the group fills it. */
    groupId: text("group_id"),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    metAt: timestamp("met_at", { withTimezone: true }),
    /**
     * A "Your choice" goal added from a job check's "Only for this job" group (role-suggest-plan.md part B). Deleting
     * the check keeps the goal and drops the tag.
     */
    jobCheckId: uuid("job_check_id").references(() => jobChecks.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("user_goals_skill").on(t.userId, t.skillId),
    index("user_goals_gap_analysis").on(t.gapAnalysisId),
    index("user_goals_job_check").on(t.jobCheckId),
    // "On your line right now" counts other people with an active goal on a skill (docs/plans/departures-live-plan.md).
    index("user_goals_skill_status").on(t.skillId, t.status),
  ],
);

/**
 * Which account a certificate's credential belongs to (dev/proof-plan.md rule 3): the first account to use it. One
 * row per certificate and credential, whatever skills the certificate proves, so the database itself keeps a
 * credential to one account. Another account using it is held for review. The id is only ever a keyed hash.
 */
export const certificateCredentials = pgTable(
  "certificate_credentials",
  {
    certId: text("cert_id").notNull(),
    credentialKey: text("credential_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.certId, t.credentialKey] }), index("certificate_credentials_user").on(t.userId)],
);

/**
 * Proof that fills a gap. Only an accepted proof does; pending and rejected ones never change a goal. Proof is per
 * skill, so it counts for every role that needs the skill. Evidence is structured and never holds resume text.
 */
export const gapProofs = pgTable(
  "gap_proofs",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    type: proofType("type").notNull(),
    status: proofStatus("status").notNull().default("pending"),
    evidence: jsonb("evidence").$type<ProofEvidence>().notNull(),
    verifier: proofVerifier("verifier"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Certificates (dev/proof-plan.md): which one from our list, its dates, and a keyed hash of its credential id. */
    certId: text("cert_id"),
    issuedOn: date("issued_on"),
    /** Null when it never expires. After this date the proof no longer fills its goal, which turns to "renew". */
    expiresOn: date("expires_on"),
    /** HMAC of the credential id (src/lib/proofs/credential.ts); the id itself is never stored. */
    credentialKey: text("credential_key"),
    /** Private storage path of the uploaded certificate file, when there is one. */
    filePath: text("file_path"),
    /** Whether the name on the certificate matched the account name. Proofs are only kept when it did. */
    nameMatched: boolean("name_matched"),
    /** Why a proof waits for review instead of filling the goal, e.g. a credential another account already used. */
    heldReason: text("held_reason"),
    /**
     * Credly check (dev/profile-certs-plan.md): the public badge id from the link, when it is a Credly badge, so one
     * badge is verified on one account only; when it was last checked; and why it wasn't verified (CREDLY_CHECK_NOTES),
     * null when verified or never checked. Verified means verifier 'credly', with verified_at set at the match.
     */
    badgeId: text("badge_id"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    checkNote: text("check_note").$type<CredlyCheckNote>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("gap_proofs_user_skill").on(t.userId, t.skillId),
    check("gap_proofs_evidence_type", sql`${t.evidence}->>'type' = ${t.type}::text`),
    index("gap_proofs_credential").on(t.certId, t.credentialKey),
    index("gap_proofs_badge").on(t.badgeId).where(sql`${t.verifier} = 'credly'`),
    index("gap_proofs_expires").on(t.expiresOn).where(sql`${t.status} = 'accepted' and ${t.expiresOn} is not null`),
  ],
);

/**
 * One row per person per India date with the ride tasks ticked that day (handoff section 5). The streak and the week
 * are counted from the rows, never stored as a counter. A row whose ticks were all taken back is not a ride.
 */
export const rideDays = pgTable(
  "ride_days",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    taskIds: text("task_ids").array().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/* Inbox ------------------------------------------------------------------- */

export const conversationKind = pgEnum("conversation_kind", CONVERSATION_KINDS);
export const conversationStatus = pgEnum("conversation_status", CONVERSATION_STATUSES);
export const memberRole = pgEnum("member_role", MEMBER_ROLES);
export const messageKind = pgEnum("message_kind", MESSAGE_KINDS);
export const reportTarget = pgEnum("report_target", REPORT_TARGETS);
export const reportReason = pgEnum("report_reason", REPORT_REASONS);
export const reportStatus = pgEnum("report_status", REPORT_STATUSES);

/**
 * One chat (dev/inbox-plan.md, approved 2026-10-11). A direct chat with someone who isn't a connection is a `request`
 * until the other person accepts. An application chat (corporate build step 5) is one per application and belongs to
 * the company (`org_id`), not to one recruiter: who may read it is checked against the live `org_members` and
 * `job_team` rows every time, and its company-side member rows only hold unread counts.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    kind: conversationKind("kind").notNull(),
    status: conversationStatus("status").notNull(),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    /** The application an application chat is about. The chat goes with it. */
    applicationId: uuid("application_id").references((): AnyPgColumn => applications.id, { onDelete: "cascade" }),
    /** The company that owns an application or found chat. Null for direct chats. */
    orgId: uuid("org_id").references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    /** A found chat's job: the open job the company searched from (pending item 19). Kept null if the job goes. */
    jobId: uuid("job_id").references((): AnyPgColumn => jobs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_started_by").on(t.startedBy),
    uniqueIndex("conversations_application").on(t.applicationId),
    index("conversations_org").on(t.orgId, t.lastMessageAt),
    index("conversations_job").on(t.jobId),
  ],
);

/** Who is in a chat. `last_read_at` drives unread; `hidden_at` is "Delete" on a request, which the sender is never told. */
export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("conversation_members_user").on(t.userId)],
);

/** The messages. A person's messages go when their account is deleted for good; the other side sees they left. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").references(() => users.id, { onDelete: "cascade" }),
    kind: messageKind("kind").notNull().default("text"),
    body: text("body").notNull(),
    /** The offered slots of an `ask_times` card (part 2). */
    payload: jsonb("payload"),
    createdAt: createdAt(),
    /**
     * Hidden by a CareerMetro admin after a report (FR-46): every read shows HIDDEN_MESSAGE_TEXT in its place
     * (src/lib/inbox/hidden.ts) and the body never leaves the database. The body is kept; unhiding clears all three.
     */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    /** The admin who hid it. Not indexed: an admin's id, never queried by. */
    hiddenBy: uuid("hidden_by").references(() => users.id, { onDelete: "set null" }),
    /** The admin's reason. Admin pages only; never logged. */
    hiddenReason: text("hidden_reason"),
  },
  (t) => [
    index("messages_conversation_created").on(t.conversationId, t.createdAt),
    index("messages_sender").on(t.senderId),
    check("messages_body_length", sql`char_length(${t.body}) between 1 and 2000`),
    check("messages_hidden_reason_length", sql`char_length(${t.hiddenReason}) between 1 and 500`),
  ],
);

/** Block is silent: the blocked person is not told and simply can't reach the person who blocked them. */
export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("blocks_blocked").on(t.blockedId), check("blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`)],
);

/**
 * Network connections (FR-49, handoff 12j): one row per connected pair, stored with user_low < user_high so a pair has
 * one row whoever asked. `how` is how the sender of the accepted request knows the other. Remove deletes the row, and
 * so does a block either way; both accounts going delete it.
 */
export const connections = pgTable(
  "connections",
  {
    userLow: uuid("user_low")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHigh: uuid("user_high")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    how: text("how", { enum: CONNECTION_HOWS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userLow, t.userHigh] }),
    index("connections_user_high").on(t.userHigh),
    check("connections_pair_order", sql`${t.userLow} < ${t.userHigh}`),
    check("connections_how", sql`${t.how} in ('same_line', 'worked_together', 'studied_together', 'event', 'other')`),
  ],
);

/**
 * Connection requests (handoff 12j). One open (pending) request per pair, either way. Ignore is silent: the sender's copy
 * reads Requested until it ends after CONNECTION_REQUEST_DAYS. Rows are kept as the record of who asked whom, and go
 * with either account.
 */
export const connectionRequests = pgTable(
  "connection_requests",
  {
    id: id(),
    fromUser: uuid("from_user")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUser: uuid("to_user")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    how: text("how", { enum: CONNECTION_HOWS }).notNull(),
    status: text("status", { enum: CONNECTION_REQUEST_STATUSES }).notNull().default("pending"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("connection_requests_open_pair")
      .on(sql`least(${t.fromUser}, ${t.toUser})`, sql`greatest(${t.fromUser}, ${t.toUser})`)
      .where(sql`${t.status} = 'pending'`),
    index("connection_requests_to").on(t.toUser, t.status),
    index("connection_requests_from").on(t.fromUser, t.status),
    check("connection_requests_not_self", sql`${t.fromUser} <> ${t.toUser}`),
    check("connection_requests_how", sql`${t.how} in ('same_line', 'worked_together', 'studied_together', 'event', 'other')`),
    check("connection_requests_status", sql`${t.status} in ('pending', 'accepted', 'ignored', 'withdrawn', 'expired')`),
  ],
);

/**
 * Reports, and the grievance queue with its IT Rules 2021 deadlines (reportDeadlines in lib/schemas/inbox). A report
 * outlives the reporter's account (reporter set to null) because the complaint record must be kept.
 */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    target: reportTarget("target").notNull(),
    /** The message, person or chat reported. No foreign key: the record stays when the target is removed. */
    targetId: uuid("target_id").notNull(),
    reason: reportReason("reason").notNull(),
    note: text("note"),
    status: reportStatus("status").notNull().default("open"),
    createdAt: createdAt(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("reports_reporter").on(t.reporterId), index("reports_status_created").on(t.status, t.createdAt), check("reports_note_length", sql`char_length(${t.note}) <= 500`)],
);

/* Corporate (employer side) -------------------------------------------------- */

/**
 * A person's company role (dev/corporate-plan.md). One active row (removed_at null) per person; removing the role ends
 * Corporate access on the next request, since access is read from these rows every time. Only the work email's domain
 * and the date it was confirmed are kept, never the address.
 */
export const orgMembers = pgTable(
  "org_members",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull(),
    workEmailDomain: text("work_email_domain").notNull(),
    workEmailVerifiedAt: timestamp("work_email_verified_at", { withTimezone: true }).notNull(),
    /** Every 180 days the person types the work email again. */
    recheckDueAt: timestamp("recheck_due_at", { withTimezone: true }).notNull(),
    /** The admin who gave the role; null for the company's first admin. No foreign key: the row outlives that admin. */
    grantedBy: uuid("granted_by"),
    createdAt: createdAt(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /** The admin who removed it, or the person themselves. No foreign key, as for granted_by. */
    removedBy: uuid("removed_by"),
  },
  (t) => [
    uniqueIndex("org_members_one_active_role").on(t.userId).where(sql`${t.removedAt} is null`),
    index("org_members_org").on(t.orgId, t.removedAt),
    index("org_members_user").on(t.userId),
  ],
);

/**
 * A role waiting for its work-email code (plan call A). `invite`: an admin typed a colleague's work email; only its
 * keyed hash and domain are kept. `request`: a signed-in person asked a company for access ("Ask for access", handoff
 * 12f); an admin answers it by giving a role. Either becomes an `org_members` row when the right person confirms a
 * work email on the company's domain with a code.
 */
export const orgInvites = pgTable(
  "org_invites",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: orgInviteKind("kind").notNull(),
    /** Null on a request until an admin gives a role. */
    role: orgRole("role"),
    /** HMAC of the invited work email (src/lib/corporate/codes.ts). Null on a request. */
    emailHash: text("email_hash"),
    emailDomain: text("email_domain").notNull(),
    /** The person who asked, on a request. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** The admin who invited or approved. No foreign key: the row outlives that admin. */
    invitedBy: uuid("invited_by"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    index("org_invites_org").on(t.orgId, t.createdAt),
    index("org_invites_email_hash").on(t.emailHash),
    index("org_invites_user").on(t.userId),
    check("org_invites_shape", sql`(${t.kind} = 'invite') = (${t.emailHash} is not null) and (${t.kind} = 'request') = (${t.userId} is not null)`),
  ],
);

/**
 * One 6-digit code to a work email (handoff 12d and 12f): 10 minutes, 5 wrong tries, then 15 minutes' wait. The code is
 * kept only as a keyed hash. The address is held only until the code is used or expires, then set to null.
 */
export const workEmailCodes = pgTable(
  "work_email_codes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: workEmailPurpose("purpose").notNull(),
    /** The company being joined; null when the code sets up a new company. No foreign key: the row is short-lived. */
    orgId: uuid("org_id"),
    email: text("email"),
    codeHash: text("code_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("work_email_codes_user").on(t.userId, t.createdAt), index("work_email_codes_expires").on(t.expiresAt).where(sql`${t.email} is not null`)],
);

/**
 * The work-email check of a person's current job (FR-47, handoff 12d, dev/current-job-check-plan.md). One row per job,
 * named by the employer (as on the confirmed profile, and its comparison key) and its start month, so a new company or
 * start date on the profile is a new job with no check. Only the email's domain is kept, never the address. "review":
 * the domain isn't that of a company CareerMetro verified under the employer's name, so an admin looks first; only "verified" shows a badge.
 */
export const jobEmailChecks = pgTable(
  "job_email_checks",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    employer: text("employer").notNull(),
    employerKey: text("employer_key").notNull(),
    /** "2024-06" or "2024" as on the profile; "" when the job has no start date. */
    startMonth: text("start_month").notNull(),
    domain: text("domain").notNull(),
    status: text("status", { enum: JOB_EMAIL_CHECK_STATUSES }).notNull(),
    /** The side of the profile the check was made on (T95): "resume" or "added"; null on checks saved before 0047. */
    roleSource: text("role_source", { enum: JOB_CHECK_SOURCES }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("job_email_checks_job").on(t.userId, t.employerKey, t.startMonth),
    index("job_email_checks_review").on(t.checkedAt).where(sql`${t.status} = 'review'`),
    check("job_email_checks_status", sql`${t.status} in ('verified', 'review', 'refused')`),
    check("job_email_checks_lengths", sql`char_length(${t.employer}) between 1 and 120 and char_length(${t.employerKey}) between 1 and 120 and char_length(${t.domain}) between 3 and 253`),
    check("job_email_checks_start", sql`${t.startMonth} ~ '^([0-9]{4}(-[0-9]{2})?)?$'`),
    check("job_email_checks_role_source", sql`${t.roleSource} is null or ${t.roleSource} in ('resume', 'added')`),
  ],
);

export const jobStatus = pgEnum("job_status", JOB_STATUSES);
export const jobWorkType = pgEnum("job_work_type", JOB_WORK_TYPES);
export const jobTeamRole = pgEnum("job_team_role", JOB_TEAM_ROLES);

/**
 * A job a company posts on CareerMetro (dev/corporate-plan.md build step 3, handoff 12g). It starts from one of our
 * role profiles and asks for skills from our taxonomy only: required, "one of these" groups and nice to have. The
 * model never writes a job. Candidates see it on Departures only while it is open and the company is verified.
 * `ai_round` is kept for the L1 AI interviewer and can't be turned on until that exists.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Who made it. The job belongs to the company, so it stays (owner set to null) when that account is deleted. */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    /** The role profile version it started from. */
    roleProfileId: uuid("role_profile_id")
      .notNull()
      .references(() => roleProfiles.id),
    /** A track of that role. Null until role profiles have tracks (handoff build order item 10). */
    track: text("track"),
    title: text("title").notNull(),
    workType: jobWorkType("work_type").notNull().default("full_time"),
    city: text("city").notNull(),
    requirements: jsonb("requirements").$type<JobRequirements>().notNull(),
    /** Express apply criteria (pending item 16): required skills that need accepted proof, and certificates. They warn, never block. */
    criteria: jsonb("criteria")
      .$type<JobCriteria>()
      .notNull()
      .default(sql`'{"verifiedSkills": [], "certificates": []}'::jsonb`),
    aiRound: boolean("ai_round").notNull().default(false),
    status: jobStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_org_status").on(t.orgId, t.status),
    index("jobs_status_created").on(t.status, t.createdAt),
    index("jobs_owner").on(t.ownerId),
    check("jobs_title_length", sql`char_length(${t.title}) between 2 and 120`),
    check("jobs_city_length", sql`char_length(${t.city}) between 2 and 60`),
    check("jobs_ai_round_off", sql`not ${t.aiRound}`),
  ],
);

/** Who works on which job: its owner, Hiring HR and interviewers. Access is still checked against live org_members. */
export const jobTeam = pgTable(
  "job_team",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: jobTeamRole("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.userId] }), index("job_team_user").on(t.userId)],
);

export const applicationStage = pgEnum("application_stage", APPLICATION_STAGES);
export const canJoin = pgEnum("can_join", CAN_JOIN);
export const applicationEventKind = pgEnum("application_event_kind", APPLICATION_EVENT_KINDS);

/**
 * One application to a job posted on CareerMetro (dev/corporate-plan.md build step 4). Made only with its own consent
 * row naming the company. The company sees the person's public profile and Match to this job, worked out from the
 * resume sent (`resume_id`) and accepted proofs; never resume lines, email, phone, pay or notice period (only Can
 * join). One application per person and job. `phone_shared` holds a phone only once the person chooses to share it for an
 * accepted interview (step 6).
 */
export const applications = pgTable(
  "applications",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    /** Copied from the job, so a company's applications are read without the job. */
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    consentId: uuid("consent_id")
      .notNull()
      .references(() => consents.id),
    stage: applicationStage("stage").notNull().default("applied"),
    canJoin: canJoin("can_join").notNull(),
    /** The resume sent. Its profile is read when the company looks, so the person's own corrections show. */
    resumeId: uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    /** Encrypted (src/lib/corporate/phone.ts); empty until the person chooses to share it when accepting an interview. */
    phoneShared: text("phone_shared"),
    /**
     * The note sent with Express apply (pending item 16): at most 300 characters, no email address or phone number
     * (checked by `applicationNote`, the only writer). Shown to the job team in the drawer; deleted with the application.
     */
    note: text("note"),
    /**
     * "Open to work in" as it was when the person sent this application with Express apply (FR-55, migration 0045). A
     * later change in Settings doesn't rewrite it. The job team sees it in the drawer next to Can join.
     */
    openToWorkIn: text("open_to_work_in").array().notNull().default(sql`'{}'::text[]`),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    /** Set by Not this time or withdrawing; cleared when the company opens it again. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** 180 days after closing; set by the clean-up job (step 7). */
    companyAccessEndsAt: timestamp("company_access_ends_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("applications_job_user").on(t.jobId, t.userId),
    index("applications_job_stage").on(t.jobId, t.stage),
    index("applications_org").on(t.orgId),
    index("applications_user").on(t.userId, t.createdAt),
    index("applications_consent").on(t.consentId),
    index("applications_resume").on(t.resumeId),
    check("applications_open_to_work_in_max", sql`cardinality(${t.openToWorkIn}) <= 6`),
  ],
);

/**
 * Every step of an application: made, moved between lanes, withdrawn. Shown on the candidate's Arrivals and in the
 * company's Activity. A move to Not this time carries the note the candidate reads. The mover's account may go; the
 * event stays (by set to null).
 */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: applicationEventKind("kind").notNull(),
    /** The lane after this event. */
    stage: applicationStage("stage").notNull(),
    byUserId: uuid("by_user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("application_events_application").on(t.applicationId, t.createdAt),
    index("application_events_by_user").on(t.byUserId),
    check("application_events_note_length", sql`char_length(${t.note}) <= 500`),
    check("application_events_not_this_time_note", sql`${t.kind} <> 'moved' or ${t.stage} <> 'not_this_time' or coalesce(char_length(${t.note}), 0) >= 10`),
  ],
);

/* Interviews (dev/corporate-plan.md build step 6) -------------------------------------------------------------------- */

export const interviewRound = pgEnum("interview_round", INTERVIEW_ROUNDS);
export const interviewStatus = pgEnum("interview_status", INTERVIEW_STATUSES);
export const interviewRecommendation = pgEnum("interview_recommendation", INTERVIEW_RECOMMENDATIONS);

/**
 * "Ask for times": the times a candidate offered for one application, in answer to one `ask_times` message. Times
 * only: never a calendar, busy times or anything about other companies. Only these reach the company.
 */
export const candidateSlots = pgTable(
  "candidate_slots",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    minutes: integer("minutes").notNull().default(60),
    /** The "Ask for times" message this answers. */
    askMessageId: uuid("ask_message_id").references(() => messages.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("candidate_slots_application").on(t.applicationId, t.startsAt),
    uniqueIndex("candidate_slots_ask_start").on(t.askMessageId, t.startsAt),
    check("candidate_slots_minutes", sql`${t.minutes} between 15 and 240`),
  ],
);

/**
 * An interview the job team booked on one of the candidate's offered times. The candidate accepts or declines it on
 * Arrivals; accepting, they may choose to share a phone with the interview's team (`phone_shared`; the number itself
 * sits encrypted on the application). `done` is read from the clock.
 */
export const interviews = pgTable(
  "interviews",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    round: interviewRound("round").notNull().default("team"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    minutes: integer("minutes").notNull(),
    status: interviewStatus("status").notNull().default("proposed"),
    /** The offered time it was booked on. */
    slotId: uuid("slot_id").references(() => candidateSlots.id, { onDelete: "set null" }),
    /** Who booked it. The interview is the company's, so it stays when that account goes. */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** The candidate chose to share their phone with this interview's team when accepting. */
    phoneShared: boolean("phone_shared").notNull().default(false),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("interviews_application").on(t.applicationId, t.startsAt),
    index("interviews_starts").on(t.startsAt),
    index("interviews_slot").on(t.slotId),
    index("interviews_created_by").on(t.createdBy),
    check("interviews_minutes", sql`${t.minutes} between 15 and 240`),
  ],
);

/** Who interviews. Being on a live interview is what lets an Interviewer see that candidate, read only. */
export const interviewInterviewers = pgTable(
  "interview_interviewers",
  {
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.interviewId, t.userId] }), index("interview_interviewers_user").on(t.userId)],
);

/**
 * An interviewer's feedback, written by them (never by the model). Seen by the job team, never by the candidate. It is
 * the company's record, so it stays when the interviewer's account goes (interviewer set to null).
 */
export const interviewFeedback = pgTable(
  "interview_feedback",
  {
    id: id(),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    interviewerId: uuid("interviewer_id").references(() => users.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    recommendation: interviewRecommendation("recommendation").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("interview_feedback_interviewer").on(t.interviewId, t.interviewerId),
    index("interview_feedback_by").on(t.interviewerId),
    check("interview_feedback_text_length", sql`char_length(${t.text}) between 1 and 2000`),
  ],
);

/* Let companies find me (pending item 19, dev/companies-find-me-plan.md) ------------------------------------------------ */

/**
 * Each time someone at a company opened the profile of a person found in a search: the person sees which companies did
 * in the last 30 days (never who at the company), and the daily clean-up deletes older rows. Goes with the person, the
 * company, and (set to null) the job.
 */
export const companyProfileViews = pgTable(
  "company_profile_views",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("company_profile_views_user").on(t.userId, t.viewedAt),
    index("company_profile_views_org").on(t.orgId),
    index("company_profile_views_job").on(t.jobId),
    index("company_profile_views_viewed").on(t.viewedAt),
  ],
);

/**
 * A company the person blocked: it never finds them in a search, can't open their profile and can't write to them again
 * in a found chat. Silent: the company is not told.
 */
export const companyBlocks = pgTable(
  "company_blocks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] }), index("company_blocks_org").on(t.orgId)],
);

/* Practice ---------------------------------------------------------------- */

/**
 * Practice answers (handoff 12h, FR-21 to FR-23): one row per "Get feedback", only ever read by its owner. The answer
 * is kept 30 days (the daily clean-up deletes older rows), is in the person's data download and never goes in a log.
 * `feedback` is the model's words (null when feedback wasn't available, and then the answer used none of the day's
 * 10); `confidence` is the person's own rating afterwards, 1 Not yet to 4 Very, the only input to their trend. Nothing
 * here fills a goal or moves the train. Deleting the account deletes the rows (on delete cascade).
 */
export const practiceAnswers = pgTable(
  "practice_answers",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    /** The bank question's stable id, such as "python-3" (src/content/practice-questions.json). */
    questionId: text("question_id").notNull(),
    answer: text("answer").notNull(),
    feedback: jsonb("feedback").$type<PracticeFeedback>(),
    confidence: smallint("confidence"),
    aiCallId: uuid("ai_call_id").references(() => aiCalls.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("practice_answers_user").on(t.userId, t.createdAt),
    index("practice_answers_created").on(t.createdAt),
    check("practice_answers_answer_length", sql`char_length(${t.answer}) between 1 and 4000`),
    check("practice_answers_confidence", sql`${t.confidence} is null or ${t.confidence} between 1 and 4`),
  ],
);

/* Elite ------------------------------------------------------------------- */

/**
 * Elite, free in the beta (FR-50, docs/plans/elite-plan.md): one row a person, written when they first turn it on.
 * `eliteSince` null is Free, and so is no row. Turning it off sets it back to null and keeps everything they made.
 * `badgeShown` is "Show the Elite badge on my profile", off by default. No billing: no price, card or payment here.
 * Goes with the account (on delete cascade); in Download your data.
 */
export const userPlans = pgTable("user_plans", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  eliteSince: timestamp("elite_since", { withTimezone: true }),
  badgeShown: boolean("badge_shown").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Timed tests (FR-50 part 2, handoff 12l): 12 multiple-choice questions from the bank (src/content/mock-bank.json) in 15
 * minutes, picked and scored by code, never by the model. `picks` holds one option index per question, -1 for none;
 * picks after `ended_at` or the 15 minutes are refused. `right` is set when the test ends. Goes with the account (on
 * delete cascade); in Download your data.
 */
export const timedTests = pgTable(
  "timed_tests",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleSlug: text("role_slug").notNull(),
    questionIds: text("question_ids").array().notNull(),
    picks: smallint("picks").array().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    right: smallint("right"),
  },
  (t) => [index("timed_tests_user").on(t.userId, t.startedAt)],
);

/**
 * Mock interviews (FR-50 part 3, handoff 12l): bank questions picked by code for a role, length (Quick: 4 in 10
 * minutes, Full: 8 in 20) and focus. `feedback` holds the summary in words once the session ends with feedback;
 * `ai_call_id` is the one call for it (prompts/mock-interview). Goes with the account (on delete cascade); in Download
 * your data. The daily clean-up deletes the answers after 30 days and keeps this row.
 */
export const mockSessions = pgTable(
  "mock_sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleSlug: text("role_slug").notNull(),
    length: text("length", { enum: MOCK_LENGTHS }).notNull(),
    focus: text("focus", { enum: MOCK_FOCUSES }).notNull(),
    questionIds: text("question_ids").array().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    feedback: jsonb("feedback").$type<MockSessionFeedback>(),
    aiCallId: uuid("ai_call_id").references(() => aiCalls.id),
  },
  (t) => [
    index("mock_sessions_user").on(t.userId, t.startedAt),
    index("mock_sessions_started").on(t.startedAt),
    check("mock_sessions_length", sql`${t.length} in ('quick', 'full')`),
    check("mock_sessions_focus", sql`${t.focus} in ('mix', 'gaps', 'technical', 'about')`),
  ],
);

/**
 * One answer in a mock interview, by the question's position (1 to 8). The text is the person's own (typed, or spoken
 * and turned to text on their device; audio is never sent or kept), 1 to 4,000 characters, kept 30 days and never
 * logged. `what_worked` and `add_next_time` are the model's words, null until feedback. A skipped question has no row.
 * `follow_up_id` is the bank follow-up asked after this answer (picked by code, migration 0044) and `follow_up_answer`
 * the person's reply, 1 to 4,000 characters, only with a follow-up id; both go with the row after 30 days.
 */
export const mockAnswers = pgTable(
  "mock_answers",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => mockSessions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    answer: text("answer").notNull(),
    whatWorked: text("what_worked"),
    addNextTime: text("add_next_time"),
    followUpId: text("follow_up_id"),
    followUpAnswer: text("follow_up_answer"),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.position] }),
    check("mock_answers_answer_length", sql`char_length(${t.answer}) between 1 and 4000`),
    check("mock_answers_position", sql`${t.position} between 1 and 8`),
    check("mock_answers_follow_up_length", sql`char_length(${t.followUpAnswer}) between 1 and 4000`),
    check("mock_answers_follow_up_needs_id", sql`${t.followUpAnswer} is null or ${t.followUpId} is not null`),
  ],
);

/* Live Departures (docs/plans/departures-live-plan.md, migration 0040) --------------------------------------- */

/**
 * Roles from the reviewed public job boards (src/content/job-boards.json; the Greenhouse, Lever, Ashby and
 * SmartRecruiters public APIs only), written once a day by scripts/departures/fetch-feeds.mjs. No post text: the
 * title, company, place, work type, the experience the post states, the live role read from the title and the skill
 * ids the taxonomy finds by code. Belongs to no one. A post the feed no longer sees gets `closed_at`; closed posts are
 * deleted with their saves 180 days later (clearOldDepartures, the daily cleanup).
 */
export const jobPosts = pgTable(
  "job_posts",
  {
    id: id(),
    ats: text("ats", { enum: ["greenhouse", "lever", "ashby", "smartrecruiters"] }).notNull(),
    boardToken: text("board_token").notNull(),
    externalId: text("external_id").notNull(),
    /** The post on the company's own board; https only. */
    url: text("url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    /** A city in India, "Remote" or "India". */
    city: text("city").notNull(),
    workType: jobWorkType("work_type").notNull().default("full_time"),
    /** "2 to 4 years", when the post states years. */
    experienceNote: text("experience_note"),
    /** The live role the title reads as; null when none matches. */
    roleSlug: text("role_slug"),
    requiredSkillIds: text("required_skill_ids").array().notNull().default(sql`'{}'::text[]`),
    niceSkillIds: text("nice_skill_ids").array().notNull().default(sql`'{}'::text[]`),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("job_posts_external").on(t.ats, t.boardToken, t.externalId),
    index("job_posts_closed_role").on(t.closedAt, t.roleSlug),
    index("job_posts_open_role_city").on(t.roleSlug, t.city).where(sql`${t.closedAt} is null`),
    // Departures and the Today board read the newest 300 open posts of up to 10,000 by this expression (0046): read
    // backwards, the index gives them in order without sorting every open post.
    index("job_posts_open_newest").on(sql`coalesce(${t.postedAt}, ${t.firstSeenAt})`).where(sql`${t.closedAt} is null`),
    check("job_posts_ats", sql`${t.ats} in ('greenhouse', 'lever', 'ashby', 'smartrecruiters')`),
    check("job_posts_url_https", sql`${t.url} like 'https://%'`),
    check("job_posts_title_length", sql`char_length(${t.title}) between 2 and 160`),
    check("job_posts_company_length", sql`char_length(${t.company}) between 1 and 80`),
    check("job_posts_city_length", sql`char_length(${t.city}) between 1 and 60`),
    check("job_posts_experience_length", sql`${t.experienceNote} is null or char_length(${t.experienceNote}) <= 40`),
  ],
);

/**
 * My jobs (docs/plans/application-tracker-plan.md): the person's own list of jobs, each either a feed post or a job they
 * added from any site (a job check), exactly one. `saved_at` is the bookmark; `stage` 1 to 6 (Applied, Heard back,
 * Interview, Offer, Not this time, Withdrawn) is where it stands, set only by the person. `closed_at` goes with Not
 * this time and Withdrawn; `interview_at` and the private `note` (never logged) are the person's. A row with neither a
 * bookmark nor a stage is deleted, not kept. Owner only; goes with the account, its post or its check (on delete
 * cascade); in Download your data.
 */
export const jobSaves = pgTable(
  "job_saves",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobPostId: uuid("job_post_id").references(() => jobPosts.id, { onDelete: "cascade" }),
    jobCheckId: uuid("job_check_id").references(() => jobChecks.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    stage: smallint("stage"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    interviewAt: timestamp("interview_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_saves_user_post").on(t.userId, t.jobPostId),
    uniqueIndex("job_saves_user_check").on(t.userId, t.jobCheckId),
    index("job_saves_job_post").on(t.jobPostId),
    index("job_saves_job_check").on(t.jobCheckId),
    index("job_saves_user_updated").on(t.userId, t.updatedAt),
    check("job_saves_one_job", sql`num_nonnulls(${t.jobPostId}, ${t.jobCheckId}) = 1`),
    check("job_saves_stage", sql`${t.stage} is null or ${t.stage} between 1 and 6`),
    check("job_saves_not_empty", sql`${t.savedAt} is not null or ${t.stage} is not null`),
    check("job_saves_closed", sql`${t.closedAt} is null or ${t.stage} in (5, 6)`),
    check("job_saves_note_length", sql`${t.note} is null or char_length(${t.note}) between 1 and 2000`),
  ],
);

/** Each run of the daily feed, counts only, for Departures' "Updated". Runs over 90 days old are deleted. */
export const jobFeedRuns = pgTable(
  "job_feed_runs",
  {
    id: id(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    boardsOk: integer("boards_ok").notNull().default(0),
    boardsFailed: integer("boards_failed").notNull().default(0),
    postsOpen: integer("posts_open").notNull().default(0),
    postsClosed: integer("posts_closed").notNull().default(0),
  },
  (t) => [index("job_feed_runs_finished").on(t.finishedAt)],
);

/**
 * Each listed board's health over the daily feed's runs, counts only: how many runs in a row it failed or kept no India
 * post (`bad_runs`, 0 after a good run), the last problem in one word, and when it last had posts. The feed writes it
 * in the run's transaction and deletes the rows of boards taken off the list; the run summary and /api/health name the
 * boards at FEED_BAD_RUNS or more, so a dead board doesn't quietly drop out. No post and no person.
 */
export const jobFeedBoards = pgTable(
  "job_feed_boards",
  {
    id: id(),
    ats: text("ats").notNull(),
    boardToken: text("board_token").notNull(),
    badRuns: integer("bad_runs").notNull().default(0),
    /** A failure code ("404", "timeout", "network", "invalid", ...) or "empty"; null after a good run. */
    lastProblem: text("last_problem"),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("job_feed_boards_board").on(t.ats, t.boardToken),
    check("job_feed_boards_bad_runs", sql`${t.badRuns} >= 0`),
    check("job_feed_boards_problem", sql`${t.lastProblem} is null or char_length(${t.lastProblem}) between 1 and 20`),
  ],
);

/* Market trends (docs/plans/market-trends-plan.md, migration 0048) ------------------------------------------- */

/**
 * Openings a month for /market: one row per month × role × state (or "IN" for all of India) × city (null for the
 * whole state) × experience band (null when the posts state no years). Written by the daily feed
 * (scripts/departures/fetch-feeds.mjs, writeRollup) from job_posts as an idempotent upsert of the current month (and
 * of the month before when its rollup missed its last run), so it outlives the 180-day purge of closed posts; the daily cleanup never deletes it. Counts only: no post, no
 * person. `boards_ok` is the month's lowest count of boards read over its runs that read at least one board (runs
 * where every board failed are left out). A post counts in its one stored city (the first it lists) and that state. No foreign keys (role slugs are content).
 * No policies and no grant yet: when the T89 feed-only role is made (dev/feed-db-role-steps.md, steps, not a migration)
 * it needs select, insert, update and delete here and a policy like the ones those steps add on job_posts and job_feed_runs.
 */
export const marketOpeningsMonthly = pgTable(
  "market_openings_monthly",
  {
    id: id(),
    /** The first day of the month, an India calendar month (Asia/Kolkata; monthOf in src/lib/market/rollup.mjs). */
    month: date("month").notNull(),
    roleSlug: text("role_slug").notNull(),
    /** A state's two-letter code, or "IN" for all of India. */
    state: text("state").notNull(),
    city: text("city"),
    band: text("band", { enum: ["0-2", "3-5", "6-10", "10+"] }),
    /** Posts first seen in the month. */
    newPosts: integer("new_posts").notNull().default(0),
    /** Posts open at the month's last run (for the current month, the latest run so far). */
    openAtEnd: integer("open_at_end").notNull().default(0),
    boardsOk: integer("boards_ok").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("market_openings_monthly_cell").on(t.month, t.roleSlug, t.state, t.city, t.band).nullsNotDistinct(),
    index("market_openings_monthly_role_month").on(t.roleSlug, t.month),
    check("market_openings_monthly_month", sql`extract(day from ${t.month}) = 1`),
    check("market_openings_monthly_state", sql`${t.state} ~ '^[A-Z]{2}$'`),
    check("market_openings_monthly_city", sql`${t.city} is null or (char_length(${t.city}) between 1 and 60 and ${t.state} <> 'IN')`),
    check("market_openings_monthly_band", sql`${t.band} is null or ${t.band} in ('0-2', '3-5', '6-10', '10+')`),
    check("market_openings_monthly_counts", sql`${t.newPosts} >= 0 and ${t.openAtEnd} >= 0 and ${t.boardsOk} >= 0`),
  ],
);

/* Library part 2 (docs/plans/library-part-2-plan.md) -------------------------------------------------------- */

/**
 * The person's own marks on a catalog resource: the bookmark (`saved_at`), "I finished this" (`finished_at`, the box
 * only; ride and Path ticks stay in their own tables) and Add to my rides (`on_ride_at`). Owner only; a row with none
 * of the three is deleted, not kept. Goes with the account and with the resource (on delete cascade).
 */
export const userResources = pgTable(
  "user_resources",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    onRideAt: timestamp("on_ride_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.resourceId] }),
    index("user_resources_resource").on(t.resourceId),
    check("user_resources_not_empty", sql`${t.savedAt} is not null or ${t.finishedAt} is not null or ${t.onRideAt} is not null`),
  ],
);

/**
 * "Report a broken link": a fixed reason and no note, so nothing typed is kept. One open report per person and
 * resource. An admin hides the link or dismisses the reports from /admin/library. Outlives the reporter's account
 * (user set to null): it holds no personal data. Decided reports go 180 days after the decision (the daily cleanup).
 */
export const resourceReports = pgTable(
  "resource_reports",
  {
    id: id(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason", { enum: RESOURCE_REPORT_REASONS }).notNull(),
    status: text("status", { enum: RESOURCE_REPORT_STATUSES }).notNull().default("open"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The admin who decided. Never queried by, so not indexed (as messages.hidden_by). */
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("resource_reports_open_once").on(t.resourceId, t.userId).where(sql`${t.status} = 'open'`),
    index("resource_reports_status_created").on(t.status, t.createdAt),
    index("resource_reports_resource").on(t.resourceId),
    index("resource_reports_user").on(t.userId),
    check("resource_reports_reason", sql`${t.reason} in ('broken', 'not_free', 'outdated', 'other')`),
    check("resource_reports_status", sql`${t.status} in ('open', 'hidden', 'dismissed')`),
    check("resource_reports_decided", sql`(${t.status} = 'open') = (${t.decidedAt} is null)`),
  ],
);

/**
 * "Suggest a free resource": an https link (tracking and affiliate parameters stripped, never fetched by the server),
 * its host and the goal's skill it is for (null is Other). A reviewer decides on /admin/library; an accepted link
 * reaches the catalog only by a pull request to src/content/resources.json. Outlives the account (user set to null).
 * Decided suggestions go 180 days after the decision (the daily cleanup).
 */
export const resourceSuggestions = pgTable(
  "resource_suggestions",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    host: text("host").notNull(),
    skillId: text("skill_id").references(() => skills.id, { onDelete: "set null" }),
    status: text("status", { enum: SUGGESTION_STATUSES }).notNull().default("open"),
    declineReason: text("decline_reason", { enum: SUGGESTION_DECLINE_REASONS }),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The admin who decided. Never queried by, so not indexed. */
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("resource_suggestions_user_url").on(t.userId, t.url),
    index("resource_suggestions_status_created").on(t.status, t.createdAt),
    index("resource_suggestions_skill").on(t.skillId),
    check("resource_suggestions_url", sql`${t.url} like 'https://%' and char_length(${t.url}) <= 500`),
    check("resource_suggestions_host_length", sql`char_length(${t.host}) between 1 and 253`),
    check("resource_suggestions_status", sql`${t.status} in ('open', 'accepted', 'duplicate', 'declined')`),
    check("resource_suggestions_decided", sql`(${t.status} = 'open') = (${t.decidedAt} is null)`),
    check(
      "resource_suggestions_decline_reason",
      sql`(${t.status} = 'declined') = (${t.declineReason} is not null) and (${t.declineReason} is null or ${t.declineReason} in ('not_free', 'paywall', 'affiliate', 'off_topic', 'other'))`,
    ),
  ],
);

/* Me editing (docs/plans/me-editing-plan.md, migration 0042) -------------------------------------------------
 * What a person adds on Me by hand: roles, education, stories and interests. All owner only, kept until the person
 * deletes them or the account goes (on delete cascade). The matcher, gaps and company Match never read these: they read
 * the confirmed resume profile only (plan choice 2). */

/** "+ Add role": a job the person added by hand. At most one current row each (the partial unique index). */
export const meRoles = pgTable(
  "me_roles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    employer: text("employer").notNull(),
    /** "2024-06". */
    startMonth: text("start_month").notNull(),
    /** "2025-03", or null while current. */
    endMonth: text("end_month"),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("me_roles_user_start").on(t.userId, t.startMonth),
    uniqueIndex("me_roles_one_current").on(t.userId).where(sql`${t.isCurrent}`),
    check("me_roles_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("me_roles_employer_length", sql`char_length(${t.employer}) between 1 and 120`),
    check("me_roles_start_month", sql`${t.startMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("me_roles_end_month", sql`${t.endMonth} is null or ${t.endMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("me_roles_end_after_start", sql`${t.endMonth} is null or ${t.endMonth} >= ${t.startMonth}`),
    check("me_roles_current_open", sql`${t.isCurrent} = (${t.endMonth} is null)`),
  ],
);

/** "+ Add" under Education: a qualification the person added by hand. */
export const meEducation = pgTable(
  "me_education",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    qualification: text("qualification").notNull(),
    institution: text("institution").notNull(),
    /** Free text, such as "2024" or "2021 to 2024". */
    year: text("year"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("me_education_user").on(t.userId),
    check("me_education_qualification_length", sql`char_length(${t.qualification}) between 1 and 160`),
    check("me_education_institution_length", sql`char_length(${t.institution}) between 1 and 160`),
    check("me_education_year_length", sql`${t.year} is null or char_length(${t.year}) between 1 and 40`),
  ],
);

/**
 * "Your stories": a Situation, Task, Action, Result story, hand-written in v1 (plan choice 1). The linked goal is set
 * to null when that goal goes. Its SMART check is worked out when shown and never stored.
 */
export const stories = pgTable(
  "stories",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    whereText: text("where_text").notNull().default(""),
    situation: text("situation").notNull().default(""),
    task: text("task").notNull().default(""),
    action: text("action").notNull().default(""),
    result: text("result").notNull().default(""),
    goalId: uuid("goal_id").references(() => userGoals.id, { onDelete: "set null" }),
    /** "user" only in v1; "resume", "goal" and "college" are kept for drafting later. */
    source: text("source").notNull().default("user"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stories_user_updated").on(t.userId, t.updatedAt),
    index("stories_goal").on(t.goalId),
    check("stories_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("stories_where_length", sql`char_length(${t.whereText}) <= 120`),
    check(
      "stories_parts_length",
      sql`char_length(${t.situation}) <= 400 and char_length(${t.task}) <= 400 and char_length(${t.action}) <= 400 and char_length(${t.result}) <= 400`,
    ),
    check("stories_source", sql`${t.source} in ('user', 'resume', 'goal', 'college')`),
  ],
);

/** The boxes a story answers (STORY_BOXES), at least one per story (checked in the store). */
export const storyBoxes = pgTable(
  "story_boxes",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    box: text("box").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.storyId, t.box] }),
    check("story_boxes_box", sql`${t.box} in ('Ownership', 'Problem solving', 'Delivering results', 'Learning', 'Working with others', 'Speaking up')`),
  ],
);

/** Interests, free text per person (plan choice 5), one per normalised key. */
export const userInterests = pgTable(
  "user_interests",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Lowercase, trimmed, single spaces (src/lib/me/text.ts interestKey). */
    nameKey: text("name_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.nameKey] }),
    check("user_interests_name_length", sql`char_length(${t.name}) between 1 and 40`),
    check("user_interests_key_length", sql`char_length(${t.nameKey}) between 1 and 40`),
  ],
);

/* Notifications, in-app (docs/plans/notifications-plan.md, migration 0043) ---------------------------------------------- */

/**
 * One row per event the bell shows: a connection request to the person, their request accepted, a company moving or
 * closing their application, and an interview set or cancelled. Ids only, never text: the sentence is built from the
 * live rows when the panel opens, so a hidden, suspended, deleted or blocked source drops out on its own. Written in the
 * event's own transaction (src/lib/notifications/store.ts notify). One unread row per kind and source (the partial
 * unique index), so a card dragged through lanes makes one. `emailed_at` is kept for the email part (waiting on
 * RESEND_API_KEY). The daily cleanup deletes read rows 60 days after reading and any row after 90 days.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull(),
    /** Who did it. Their account going sets it null, and the row is then not shown. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    connectionRequestId: uuid("connection_request_id").references(() => connectionRequests.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
    interviewId: uuid("interview_id").references(() => interviews.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Unused until the email part. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_user_created").on(t.userId, t.createdAt.desc()),
    index("notifications_user_unread").on(t.userId).where(sql`${t.readAt} is null`),
    index("notifications_actor").on(t.actorId),
    index("notifications_connection_request").on(t.connectionRequestId),
    index("notifications_application").on(t.applicationId),
    index("notifications_interview").on(t.interviewId),
    uniqueIndex("notifications_one_unread")
      .on(t.userId, t.kind, sql`coalesce(${t.applicationId}, ${t.connectionRequestId}, ${t.interviewId})`)
      .where(sql`${t.readAt} is null`),
    check(
      "notifications_kind",
      sql`${t.kind} in ('connection_request', 'connection_accepted', 'application_moved', 'application_closed', 'interview_scheduled', 'interview_cancelled')`,
    ),
    check(
      "notifications_refs",
      sql`(${t.kind} in ('connection_request', 'connection_accepted') and ${t.connectionRequestId} is not null and ${t.applicationId} is null and ${t.interviewId} is null) or (${t.kind} in ('application_moved', 'application_closed') and ${t.applicationId} is not null and ${t.connectionRequestId} is null and ${t.interviewId} is null) or (${t.kind} in ('interview_scheduled', 'interview_cancelled') and ${t.interviewId} is not null and ${t.connectionRequestId} is null and ${t.applicationId} is null)`,
    ),
  ],
);

/* Audit ------------------------------------------------------------------- */

/**
 * Any admin access to user data (SEC-8), and every action a company member takes on its team, jobs and applications
 * (corporate build step 7). Ids and fixed action names only (companyAuditLine in lib/schemas): never words someone typed.
 * `org_id` is the company a line belongs to, so its Recruiter admins can read their own; no foreign key, because the
 * record outlives what it is about.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    orgId: uuid("org_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_created").on(t.orgId, t.createdAt)],
);

/**
 * Abuse limits shared by every server (H11): one row per limit, keyed hash and fixed window, counting hits. The key is
 * an HMAC of the email or IP, never the value itself. Windows that started over two days ago are deleted by the daily
 * cleanup (clearOldRateLimits, api/cron/cleanup).
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    bucket: text("bucket").notNull(),
    keyHash: text("key_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.keyHash, t.windowStart] }), index("rate_limits_window_start").on(t.windowStart)],
);
