import { z } from "zod";
import { ORG_REVIEW_STATUSES, ORG_TYPES, REVIEW_DECISIONS } from "./constants";

/*
 * The company review page, /admin/companies (dev/corporate-plan.md, call B). What a review action takes from the
 * browser, and the shape of a row read for the list. A row has company fields and counts only: never anyone's email
 * address or phone.
 */

export { REVIEW_DECISIONS };

/** One review: which company (by id, never a domain typed in the browser) and what to do. */
export const companyReviewInput = z.object({ orgId: z.uuid(), decision: z.enum(REVIEW_DECISIONS) }).strict();
export type CompanyReviewInput = z.infer<typeof companyReviewInput>;

/** A row of the review list as src/lib/corporate/review-queue.mjs reads it. */
export const reviewQueueRow = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(ORG_TYPES),
    domain: z.string().min(1),
    website: z.string().nullable(),
    city: z.string().nullable(),
    size: z.string().nullable(),
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(ORG_REVIEW_STATUSES),
    members: z.number().int().nonnegative(),
    admins: z.number().int().nonnegative(),
  })
  .strip();

/*
 * The held-proof review page, /admin/proofs (FR-44; dev/held-proof-review-plan.md). Certificates held for review: a
 * credential id another account already used, or a Credly badge already verified on another account. What a review
 * takes from the browser, the row read for the list, and the row the page shows. Never an email, phone, resume text,
 * credential id or credential hash.
 */

const BADGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The held reasons that wait for a person's review (gap_proofs.held_reason). Only these reach the review page; a row
 * held as "credly_check" (HELD_REASONS in ./proof) waits for the Credly check, not for a person.
 */
export const REVIEW_HELD_REASONS = ["credential_reused", "badge_reused"] as const;
export type ReviewHeldReason = (typeof REVIEW_HELD_REASONS)[number];

/**
 * Set on a proof another account's claim won (gap_proofs.held_reason, with status rejected). With status rejected, any
 * held reason means the proof was rejected after review.
 */
export const CLAIMED_ELSEWHERE = "claimed_elsewhere";

/** Plain words for each held reason, for the review page. */
export const HELD_REASON_TEXT: Record<ReviewHeldReason, string> = {
  credential_reused: "Its credential id was already used on another account",
  badge_reused: "Its Credly badge is already verified on another account",
};

export const PROOF_REVIEW_DECISIONS = ["accept", "reject"] as const;
export type ProofReviewDecision = (typeof PROOF_REVIEW_DECISIONS)[number];

/** One review: which held proof (by id) and what to do. The admin comes from the session, never the browser. */
export const proofReviewInput = z.object({ proofId: z.uuid(), decision: z.enum(PROOF_REVIEW_DECISIONS) }).strict();
export type ProofReviewInput = z.infer<typeof proofReviewInput>;

/** A held claim as src/lib/admin/proofs.ts reads it: names for the short form only, never an email. */
export const heldProofRow = z
  .object({
    id: z.uuid(),
    certId: z.string().min(1).max(80),
    issuer: z.string().max(120).nullable(),
    heldReason: z.enum(REVIEW_HELD_REASONS),
    submitted: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    badgeId: z.string().regex(BADGE_ID).nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    name: z.string().nullable(),
    others: z.coerce.number().int().nonnegative(),
  })
  .strip();
export type HeldProofRow = z.infer<typeof heldProofRow>;

/** One held claim on the review page. `person` is first name and last initial only. */
export const heldProofView = z
  .object({
    id: z.uuid(),
    certificate: z.string().min(1).max(200),
    issuer: z.string().max(120),
    reason: z.enum(REVIEW_HELD_REASONS),
    reasonText: z.string().min(1),
    submittedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    person: z.string().min(1).max(80),
    /** Other accounts that hold the same credential or badge, accepted or waiting. */
    others: z.number().int().nonnegative(),
    /** The badge's public Credly page, rebuilt from the badge id; null when it isn't a Credly badge. */
    badgeUrl: z
      .string()
      .regex(/^https:\/\/www\.credly\.com\/badges\/[0-9a-f-]{36}$/)
      .nullable(),
  })
  .strict();
export type HeldProofView = z.infer<typeof heldProofView>;

/** What a review says back: words to announce on the page. */
export type ProofReviewResult = { ok: boolean; message: string };
export type ProofReviewAction = (proofId: string, decision: ProofReviewDecision) => Promise<ProofReviewResult>;

/*
 * The report review page, /admin/reports (FR-45; docs/plans/reports-review-plan.md). Open reports from the Inbox and
 * from job pages, with the IT Rules 2021 deadlines the Grievances page promises. What a review takes from the browser
 * and the row the page shows. Never an email or phone; names are first name and last initial.
 */

export const REPORT_DECISIONS = ["acknowledge", "actioned", "dismissed"] as const;
export type ReportDecision = (typeof REPORT_DECISIONS)[number];

/** One review: which report (by id) and what to do. The admin comes from the session, never the browser. */
export const reportReviewInput = z.object({ reportId: z.uuid(), decision: z.enum(REPORT_DECISIONS) }).strict();
export type ReportReviewInput = z.infer<typeof reportReviewInput>;

const ISO_INSTANT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);

/** One open report on the review page. */
export const reportReviewView = z
  .object({
    id: z.uuid(),
    reason: z.string().min(1).max(80),
    /** What was reported, in words: "A message", "A person", "A chat" or "A job". */
    what: z.string().min(1).max(20),
    reportedAt: ISO_INSTANT,
    acknowledgedAt: ISO_INSTANT.nullable(),
    acknowledgeBy: ISO_INSTANT,
    decideBy: ISO_INSTANT,
    reporter: z.string().min(1).max(80),
    note: z.string().max(500).nullable(),
    /** The reported thing as the admin needs it to decide, or null when it is gone. */
    context: z
      .object({
        /** "Message from Priya S.", "Person", "Chat with Example Labs", "Job at Example Labs". */
        label: z.string().min(1).max(200),
        /** The message text or the job title; null for a person or a chat. */
        text: z.string().max(4000).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ReportReviewView = z.infer<typeof reportReviewView>;

export type ReportReviewResult = { ok: boolean; message: string };
export type ReportReviewAction = (reportId: string, decision: ReportDecision) => Promise<ReportReviewResult>;
