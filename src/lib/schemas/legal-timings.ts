/*
 * Every deadline and retention period CareerMetro keeps as an intermediary under India's IT Rules 2021 (as amended),
 * in one file, so a correction is a one-line change (docs/plans/junction-plan.md section 2). Each value is
 * Development's reading of the Rules and is for the legal adviser to confirm before Junction reaches real users: the
 * Rules have been amended several times, and some windows may have been shortened since. The Grievances page, the terms
 * and the privacy notice read the same values. No Zod and no server code here, so client components can import it.
 */

/** The report reasons, as the database's report_reason enum holds them. Kept here so this file needs nothing else. */
export type TimedReportReason =
  | "money_or_otp"
  | "harassment"
  | "intimate_or_impersonation"
  | "fake_or_spam"
  | "other"
  | "child_safety"
  | "hate"
  | "privacy"
  | "misleading"
  | "copyright";

/** Acknowledge any complaint within this many hours. Rule 3(2)(a)(i). */
export const ACKNOWLEDGE_WITHIN_HOURS = 24;

/**
 * Act on a report within this many hours, by its reason. Nudity, sexual content of a person or impersonation, and
 * anything harmful to a child: 24 hours (rule 3(2)(b)). The other rule 3(1)(b) categories: 72 hours (rule 3(2)(a)(i)
 * proviso, 2022). Anything else: a decision within 15 days (rule 3(2)(a)(i)).
 */
export const DECIDE_WITHIN_HOURS: Record<TimedReportReason, number> = {
  intimate_or_impersonation: 24,
  child_safety: 24,
  money_or_otp: 72,
  harassment: 72,
  fake_or_spam: 72,
  hate: 72,
  privacy: 72,
  misleading: 72,
  copyright: 72,
  other: 15 * 24,
};

/** A court order or a government notice under rule 3(1)(d): 36 hours in the 2021 text, reported shortened since. */
export const ORDER_DEADLINE_HOURS = 36;
/** Information asked for by an authorised government agency, rule 3(1)(j): 72 hours in the 2021 text. */
export const AGENCY_REQUEST_HOURS = 72;

/** A member may appeal a removal within this many days of the notice. */
export const APPEAL_WITHIN_DAYS = 30;
/** An appeal is decided within this many days, as a grievance. */
export const APPEAL_DECIDE_DAYS = 15;
/** After our decision, the Grievance Appellate Committee (gac.gov.in, rule 3A) takes an appeal within this many days. */
export const GAC_APPEAL_DAYS = 30;

/**
 * Removed content and its records are kept this many days for investigation, rule 3(1)(g), unless an admin sets a
 * legal hold because a court or an authorised agency asks for longer. The daily cleanup deletes them after.
 */
export const REMOVAL_KEEP_DAYS = 180;
/** A post or comment its author deleted is kept, unseen, this many days, then deleted for good by the daily cleanup. */
export const JUNCTION_DELETED_KEEP_DAYS = 30;
/** The daily cleanup checks the counts on posts from this many days back. */
export const JUNCTION_RECOUNT_DAYS = 8;

/** Top this week: posts from the last this many days. */
export const TOP_WINDOW_DAYS = 7;
/** An author may edit a post this many minutes after posting; after that, only delete. */
export const EDIT_WINDOW_MINUTES = 30;
/** The same title and body from one person within this many hours is refused. */
export const DUPLICATE_WINDOW_HOURS = 24;
/** An account posts and comments once it is this many hours old (a name is needed too). */
export const NEW_ACCOUNT_POST_WAIT_HOURS = 24;
/** An account adds a link to a post once it is this many days old. */
export const NEW_ACCOUNT_LINK_WAIT_DAYS = 7;
/** Votes, comments and reshares from accounts younger than this many hours don't count in Top. */
export const COUNTS_MIN_ACCOUNT_HOURS = 24;

/**
 * Auto-hold, until an admin decides (a hold, not a removal): at the first child_safety report, or at this many open
 * reports from different accounts, each at least AUTO_HOLD_REPORTER_DAYS old.
 */
export const AUTO_HOLD_REPORTS = 3;
export const AUTO_HOLD_REPORTER_DAYS = 7;

const HOUR = 3_600_000;
export const DAY_MS = 24 * HOUR;
export const HOUR_MS = HOUR;

/** When a report must be acknowledged and decided, from when it was filed. */
export function deadlinesFor(reason: TimedReportReason, reportedAt: Date): { acknowledgeBy: Date; decideBy: Date } {
  const at = reportedAt.getTime();
  return { acknowledgeBy: new Date(at + ACKNOWLEDGE_WITHIN_HOURS * HOUR), decideBy: new Date(at + DECIDE_WITHIN_HOURS[reason] * HOUR) };
}

/** When a logged court order or government notice must be acted on, from when it was received. */
export const orderDecideBy = (receivedAt: Date): Date => new Date(receivedAt.getTime() + ORDER_DEADLINE_HOURS * HOUR);
