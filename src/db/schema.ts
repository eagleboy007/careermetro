import {
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
  text,
  timestamp,
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
import { ORG_INVITE_KINDS, ORG_REVIEW_STATUSES, ORG_ROLES, ORG_TYPES, WORK_EMAIL_PURPOSES } from "../lib/schemas/constants";
import { GOAL_SOURCES, GOAL_STATUSES, PROOF_STATUSES, PROOF_TYPES, PROOF_VERIFIERS, STEP_KINDS, STEP_SOURCES } from "../lib/schemas/goals";
import type { GapAnalysis, Profile, ProofEvidence, RoleProfile } from "@/lib/schemas";

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
  },
  // Matching by email when the provider changes must ignore case.
  (t) => [uniqueIndex("users_email_lower").on(sql`lower(${t.email})`)],
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
    createdAt: createdAt(),
    /** When the raw file must be removed (SEC-5). Null when no file was kept, the default: text is read in memory. */
    fileDeleteAfter: timestamp("file_delete_after", { withTimezone: true }),
  },
  (t) => [
    index("resumes_anonymous_session").on(t.anonymousSessionId),
    index("resumes_client_hash").on(t.clientHash, t.createdAt),
    index("resumes_user").on(t.userId),
    index("resumes_consent").on(t.consentId),
  ],
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
 * and its target role. The posting text itself is never stored, only a keyed hash of it so the same text isn't read
 * twice. Goes with its resume: an anonymous one with the 24-hour cleanup, an account's with account deletion.
 */
export const jobChecks = pgTable(
  "job_checks",
  {
    id: id(),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    roleSlug: text("role_slug").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    requiredSkillIds: text("required_skill_ids").array().notNull().default(sql`'{}'::text[]`),
    niceSkillIds: text("nice_skill_ids").array().notNull().default(sql`'{}'::text[]`),
    /** Names the posting asks for that aren't in our skill list yet. Shown, never scored. */
    unknownSkills: text("unknown_skills").array().notNull().default(sql`'{}'::text[]`),
    /** HMAC of the posting text (src/lib/jobs/store.ts); the text itself is never kept. */
    textHash: text("text_hash").notNull(),
    aiCallId: uuid("ai_call_id").references(() => aiCalls.id),
    createdAt: createdAt(),
  },
  (t) => [index("job_checks_resume").on(t.resumeId, t.createdAt)],
);

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
    createdAt: createdAt(),
  },
  (t) => [
    index("gap_proofs_user_skill").on(t.userId, t.skillId),
    check("gap_proofs_evidence_type", sql`${t.evidence}->>'type' = ${t.type}::text`),
    index("gap_proofs_credential").on(t.certId, t.credentialKey),
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
 * until the other person accepts. `application_id` links an application chat once applications exist (employer side).
 */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    kind: conversationKind("kind").notNull(),
    status: conversationStatus("status").notNull(),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    applicationId: uuid("application_id"),
    createdAt: createdAt(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_started_by").on(t.startedBy)],
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
  },
  (t) => [
    index("messages_conversation_created").on(t.conversationId, t.createdAt),
    index("messages_sender").on(t.senderId),
    check("messages_body_length", sql`char_length(${t.body}) between 1 and 2000`),
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

/* Audit ------------------------------------------------------------------- */

/** Any admin access to user data (SEC-8). */
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  createdAt: createdAt(),
});

/**
 * Abuse limits shared by every server (H11): one row per limit, keyed hash and fixed window, counting hits. The key is
 * an HMAC of the email or IP, never the value itself. Rows older than two days are deleted by the code that writes them.
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
