import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { GOAL_SOURCES, GOAL_STATUSES, PROOF_STATUSES, PROOF_TYPES, PROOF_VERIFIERS, STEP_KINDS } from "../lib/schemas/goals";
import type { GapAnalysis, Profile, ProofEvidence, RoleProfile } from "@/lib/schemas";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* Accounts ---------------------------------------------------------------- */

/** Present from day one so B2B (Phase 3) needs no migration of user data. */
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    name: text("name"),
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
});

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
    createdAt: createdAt(),
    /** When the raw file must be removed (SEC-5). Null when no file was kept, the default: text is read in memory. */
    fileDeleteAfter: timestamp("file_delete_after", { withTimezone: true }),
  },
  (t) => [
    index("resumes_anonymous_session").on(t.anonymousSessionId),
    index("resumes_client_hash").on(t.clientHash, t.createdAt),
    index("resumes_user").on(t.userId),
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
});

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
});

export const goalStatus = pgEnum("goal_status", GOAL_STATUSES);
export const stepKind = pgEnum("step_kind", STEP_KINDS);
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
});

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
    source: text("source", { enum: ["app", "user"] })
      .notNull()
      .default("app"),
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
    source: text("source", { enum: GOAL_SOURCES }).notNull().default("gap"),
    status: goalStatus("status").notNull().default("active"),
    position: integer("position").notNull(),
    /** The analysis that first made this goal. */
    gapAnalysisId: uuid("gap_analysis_id").references(() => gapAnalyses.id, { onDelete: "set null" }),
    swappedTo: text("swapped_to").references(() => skills.id),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    metAt: timestamp("met_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_goals_skill").on(t.userId, t.skillId)],
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
    createdAt: createdAt(),
  },
  (t) => [index("gap_proofs_user_skill").on(t.userId, t.skillId)],
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
