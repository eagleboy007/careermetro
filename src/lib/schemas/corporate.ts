import { z } from "zod";
import { checkWorkEmail, normalWebsite, workEmailProblemText } from "@/lib/corporate/domains";
import { SLOT_KEY } from "@/lib/corporate/slots";
import {
  APPLICATION_STAGES,
  CAN_JOIN,
  COMPANY_AUDIT_ACTIONS,
  FEEDBACK_MAX,
  FEEDBACK_MIN,
  INTERVIEW_MINUTES,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_ROUNDS,
  INTERVIEWERS_MAX,
  SLOTS_MAX,
  NOT_THIS_TIME_NOTE_MAX,
  NOT_THIS_TIME_NOTE_MIN,
  JOB_CITY_MAX,
  JOB_NICE_MAX,
  JOB_ONE_OF_GROUPS_MAX,
  JOB_ONE_OF_SIZE_MAX,
  JOB_ONE_OF_SIZE_MIN,
  JOB_REQUIRED_MAX,
  JOB_STATUSES,
  JOB_TEAM_MAX,
  JOB_TEAM_ROLES,
  JOB_TITLE_MAX,
  JOB_WORK_TYPES,
  ORG_ABOUT_MAX_CHARS,
  ORG_INDUSTRIES,
  ORG_REVIEW_STATUSES,
  ORG_ROLES,
  ORG_SIZES,
  ORG_TYPES,
  WORK_EMAIL_PURPOSES,
} from "./constants";
import { messageBody, REPORT_NOTE_MAX_CHARS, REPORT_REASONS } from "./inbox";

/*
 * Corporate, build steps 1 and 2 (dev/corporate-plan.md; handoff 12e and 12f): company sign-up, the work-email code,
 * team and access. A work email is personal data: it is checked here, used once, and never logged.
 */

export { COMPANY_AUDIT_ACTIONS, COMPANY_AUDIT_LABELS } from "./constants";
export type { CompanyAuditAction } from "./constants";
export { APPLICATION_STAGES, CAN_JOIN, JOB_STATUSES, JOB_TEAM_ROLES, JOB_WORK_TYPES, ORG_ABOUT_MAX_CHARS, ORG_INDUSTRIES, ORG_REVIEW_STATUSES, ORG_ROLES, ORG_SIZES, ORG_TYPES, WORK_EMAIL_PURPOSES };

const text = (min: number, max: number, what: string) =>
  z
    .string()
    .trim()
    .min(min, { error: `Add the ${what}.` })
    .max(max, { error: `Keep the ${what} under ${max} characters.` });

/** A work email: valid, not personal mail. Lowercased, so the same address always hashes the same. */
export const workEmail = z
  .string()
  .trim()
  .max(254, { error: workEmailProblemText("invalid") })
  .transform((v) => v.toLowerCase())
  .superRefine((v, ctx) => {
    const check = checkWorkEmail(v);
    if (!check.ok) ctx.addIssue({ code: "custom", message: workEmailProblemText(check.problem) });
  });

/** The 6-digit code, with any spaces people type between groups taken out. */
export const workEmailCode = z
  .string()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, { error: "Type the 6 digits from the email." }));

export const website = z
  .string()
  .trim()
  .max(200, { error: "Keep the website under 200 characters." })
  .transform((v, ctx) => {
    const url = normalWebsite(v);
    if (!url) {
      ctx.addIssue({ code: "custom", message: "Add the company's website, starting with https://" });
      return z.NEVER;
    }
    return url;
  });

/** Step 1 of company sign-up (handoff 12f). */
export const signupDetails = z.object({
  type: z.enum(ORG_TYPES),
  legalName: text(2, 160, "registered name"),
  name: text(2, 80, "name candidates see"),
  website,
  workEmail,
  size: z.enum(ORG_SIZES, { error: "Pick the company size." }),
  city: text(2, 60, "head office city"),
});
export type SignupDetailsInput = z.input<typeof signupDetails>;
export type SignupDetailsData = z.output<typeof signupDetails>;

export const signupFinish = z.object({ details: signupDetails, code: workEmailCode });

/** GSTIN (15 characters) or CIN (21), uppercase. Optional; used only for the hand check and never shown. */
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

/** Step 3, the company page. Empty strings mean "not given". */
export const companyPage = z.object({
  about: z
    .string()
    .trim()
    .max(ORG_ABOUT_MAX_CHARS, { error: `Keep it under ${ORG_ABOUT_MAX_CHARS} characters.` }),
  industry: z.union([z.enum(ORG_INDUSTRIES), z.literal("")]),
  offices: z.string().trim().max(120, { error: "Keep offices under 120 characters." }),
  gstinOrCin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/\s+/g, ""))
    .refine((v) => v === "" || GSTIN.test(v) || CIN.test(v), { error: "Check the GSTIN (15 characters) or CIN (21 characters)." }),
});
export type CompanyPageData = z.output<typeof companyPage>;

export const inviteInput = z.object({ workEmail, role: z.enum(ORG_ROLES) });
export const memberIdInput = z.object({ memberId: z.uuid() });
export const inviteIdInput = z.object({ inviteId: z.uuid() });
export const answerRequestInput = z.object({ requestId: z.uuid(), answer: z.union([z.enum(ORG_ROLES), z.literal("decline")]) });
export const joinStart = z.object({ workEmail });
export const joinFinish = z.object({ workEmail, code: workEmailCode });

/* Jobs (build step 3; handoff 12g) --------------------------------------------------------------------------------- */

/** A skill id from our taxonomy. The store checks it is one of ours; the shape is checked here. */
const skillId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, { error: "Pick skills from the list." });

/**
 * What a job asks for, as skill ids only (no free-text skills): Required (all of them), One of these (any one skill
 * of each group counts) and Nice to have (never blocks). A skill sits in one place only. A draft may have no required
 * skill yet; opening needs one (src/lib/corporate/rules.ts).
 */
export const jobRequirements = z
  .object({
    required: z.array(skillId).max(JOB_REQUIRED_MAX, { error: `Keep required skills to ${JOB_REQUIRED_MAX} at most.` }),
    oneOf: z
      .array(
        z
          .array(skillId)
          .min(JOB_ONE_OF_SIZE_MIN, { error: "A \"one of these\" group needs at least two skills." })
          .max(JOB_ONE_OF_SIZE_MAX, { error: `Keep a "one of these" group to ${JOB_ONE_OF_SIZE_MAX} skills.` }),
      )
      .max(JOB_ONE_OF_GROUPS_MAX, { error: `Keep to ${JOB_ONE_OF_GROUPS_MAX} "one of these" groups.` }),
    nice: z.array(skillId).max(JOB_NICE_MAX, { error: `Keep nice-to-have skills to ${JOB_NICE_MAX} at most.` }),
  })
  .refine(
    (r) => {
      const all = [...r.required, ...r.oneOf.flat(), ...r.nice];
      return new Set(all).size === all.length;
    },
    { error: "Each skill goes in one group only." },
  );
export type JobRequirements = z.output<typeof jobRequirements>;

/** The three ticks before a job opens. All must be ticked. */
export const jobHonesty = z.object(
  {
    real: z.literal(true, { error: "Tick the three boxes to open the job." }),
    noFee: z.literal(true, { error: "Tick the three boxes to open the job." }),
    fair: z.literal(true, { error: "Tick the three boxes to open the job." }),
  },
  { error: "Tick the three boxes to open the job." },
);

/**
 * The Post a job form (C9): a new job (no jobId) or an edit. The role profile is named by slug; the store turns it
 * into the role_profiles row. Team members are org_members ids, checked against the live team. `open` carries the
 * three ticks when the person also opens the job.
 */
export const jobInput = z.object({
  jobId: z.uuid().optional(),
  roleSlug: z.string().regex(/^[a-z0-9-]{1,80}$/, { error: "Pick a role profile." }),
  title: text(2, JOB_TITLE_MAX, "job title"),
  workType: z.enum(JOB_WORK_TYPES, { error: "Pick a work type." }),
  city: text(2, JOB_CITY_MAX, "city"),
  requirements: jobRequirements,
  hiring: z.array(z.uuid()).max(JOB_TEAM_MAX).default([]),
  interviewers: z.array(z.uuid()).max(JOB_TEAM_MAX).default([]),
  open: jobHonesty.optional(),
});
export type JobInput = z.input<typeof jobInput>;

/** Pause, close, or open again a job that was open before (a draft opens from the form, with the three ticks). */
export const jobStatusInput = z.object({ jobId: z.uuid(), to: z.enum(["open", "paused", "closed"]) });

/* Applications and the board (build step 4) ------------------------------------------------------------------------ */

/**
 * Applying to a job posted on CareerMetro: the consent tick naming the company, and when the person can join. Nothing
 * else: never a notice period, pay or phone (unknown keys are dropped).
 */
export const applyInput = z.object({
  jobId: z.uuid(),
  canJoin: z.enum(CAN_JOIN, { error: "Pick when you can join." }),
  consent: z.literal(true, { error: "Tick the box to share these with the company." }),
});

/** A move on the board. "Not this time" needs a note the candidate reads on Arrivals. */
export const moveInput = z
  .object({
    applicationId: z.uuid(),
    to: z.enum(APPLICATION_STAGES),
    note: z.string().trim().max(NOT_THIS_TIME_NOTE_MAX, { error: `Keep the note under ${NOT_THIS_TIME_NOTE_MAX} characters.` }).default(""),
  })
  .refine((m) => m.to !== "not_this_time" || m.note.length >= NOT_THIS_TIME_NOTE_MIN, {
    error: "Add a short note the candidate will see, with what would help next time.",
    path: ["note"],
  });

export const applicationIdInput = z.object({ applicationId: z.uuid() });

/** "Report this job" (plan, Abuse and compliance), into the same reports queue as the Inbox. */
export const jobReportInput = z.object({
  jobId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(REPORT_NOTE_MAX_CHARS).optional(),
});

/* Company chats (build step 5) ------------------------------------------------------------------------------------- */

/**
 * A message from the job team in an application's chat. `question` sends it as "Ask a question": the same text, shown
 * to the candidate under a Question label. Never anything else: no attachments, no contact details asked for here.
 */
export const companyMessageInput = z.object({
  applicationId: z.uuid(),
  body: messageBody,
  question: z.boolean().default(false),
});
export type CompanyMessageInput = z.input<typeof companyMessageInput>;

/* Interviews (build step 6) ---------------------------------------------------------------------------------------- */

/** "Ask for times" in an application's chat. The store writes the question and the days; the caller names only the application. */
export const askTimesInput = z.object({ applicationId: z.uuid() });

/** A slot on the picker, "2026-10-14T11:00" (India date and start time). The store checks it is one the ask offered. */
export const slotKey = z.string().regex(SLOT_KEY, { error: "Pick times from the grid." });

/** The candidate's answer to "Ask for times": one or more slots, each once. Times only, never a calendar. */
export const offerTimesInput = z.object({
  messageId: z.uuid(),
  slots: z
    .array(slotKey)
    .min(1, { error: "Pick at least one time." })
    .max(SLOTS_MAX, { error: `Pick up to ${SLOTS_MAX} times.` })
    .refine((s) => new Set(s).size === s.length, { error: "Pick each time once." }),
});

/** Booking one of the times the candidate offered, with the round, its length and who interviews (org_members ids). */
export const scheduleInput = z.object({
  applicationId: z.uuid(),
  slotId: z.uuid({ error: "Pick one of the times the candidate offered." }),
  round: z.enum(INTERVIEW_ROUNDS).default("team"),
  minutes: z.literal(INTERVIEW_MINUTES, { error: "Pick how long it runs." }),
  interviewers: z
    .array(z.uuid())
    .min(1, { error: "Pick at least one interviewer." })
    .max(INTERVIEWERS_MAX, { error: `Pick up to ${INTERVIEWERS_MAX} interviewers.` })
    .refine((s) => new Set(s).size === s.length, { error: "Pick each interviewer once." }),
});
export type ScheduleInput = z.input<typeof scheduleInput>;

export const interviewIdInput = z.object({ interviewId: z.uuid() });

/**
 * An Indian mobile number, as people type it (spaces, dashes, +91 or a leading 0), kept as "+91 98765 43210". Only ever
 * typed by the candidate when they choose to share it for an interview.
 */
export const indianMobile = z
  .string()
  .trim()
  .max(20, { error: "Type a 10-digit Indian mobile number." })
  .transform((v) => v.replace(/[\s().-]/g, ""))
  .transform((v) => v.replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, { error: "Type a 10-digit Indian mobile number." }))
  .transform((v) => `+91 ${v.slice(0, 5)} ${v.slice(5)}`);

/** The candidate's answer to an interview: decline, or accept and choose whether to share a phone with its team. */
export const respondInput = z.union([
  z.object({ interviewId: z.uuid(), answer: z.literal("decline") }),
  z.object({ interviewId: z.uuid(), answer: z.literal("accept"), sharePhone: z.literal(false) }),
  z.object({ interviewId: z.uuid(), answer: z.literal("accept"), sharePhone: z.literal(true), phone: indianMobile }),
]);
export type RespondInput = z.input<typeof respondInput>;

/** Feedback from an interviewer, in their own words. Never written by the model. */
export const feedbackInput = z.object({
  interviewId: z.uuid(),
  recommendation: z.enum(INTERVIEW_RECOMMENDATIONS, { error: "Pick what you recommend." }),
  text: z
    .string()
    .trim()
    .min(FEEDBACK_MIN, { error: `Write at least ${FEEDBACK_MIN} characters about the interview.` })
    .max(FEEDBACK_MAX, { error: `Keep feedback under ${FEEDBACK_MAX.toLocaleString("en-IN")} characters.` }),
});
export type FeedbackInput = z.input<typeof feedbackInput>;

/* Overview, audit and clean-up (build step 7) ---------------------------------------------------------------------- */

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Who did it: a company member (their org_members id), the candidate, or the daily clean-up. Never a name or email. */
export const auditActor = z.string().regex(new RegExp(`^(member:${UUID_PART}|candidate|system)$`));
/** What it was done to, by id: the company, a member, a role waiting for its code, a job or an application. */
export const auditTarget = z.string().regex(new RegExp(`^(company|member|invite|job|application):${UUID_PART}$`));

/**
 * One line of a company's audit (plan, "Audit"): who, which action, on what, when. Ids and fixed action names only, so
 * no line can carry a message, a note, feedback or contact details.
 */
export const companyAuditLine = z.strictObject({
  orgId: z.uuid(),
  actor: auditActor,
  action: z.enum(COMPANY_AUDIT_ACTIONS),
  target: auditTarget,
});
export type CompanyAuditLine = z.infer<typeof companyAuditLine>;

/** Where a page of the audit view starts: just before this line (its time and id), or the newest. */
export const auditCursor = z.string().regex(new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z_${UUID_PART}$`));
export const auditPageInput = z.object({ before: auditCursor.optional().catch(undefined) });
