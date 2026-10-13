import { z } from "zod";
import { checkWorkEmail, normalWebsite, workEmailProblemText } from "@/lib/corporate/domains";
import {
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
import { REPORT_NOTE_MAX_CHARS, REPORT_REASONS } from "./inbox";

/*
 * Corporate, build steps 1 and 2 (dev/corporate-plan.md; handoff 12e and 12f): company sign-up, the work-email code,
 * team and access. A work email is personal data: it is checked here, used once, and never logged.
 */

export { JOB_STATUSES, JOB_TEAM_ROLES, JOB_WORK_TYPES, ORG_ABOUT_MAX_CHARS, ORG_INDUSTRIES, ORG_REVIEW_STATUSES, ORG_ROLES, ORG_SIZES, ORG_TYPES, WORK_EMAIL_PURPOSES };

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

/** "Report this job" (plan, Abuse and compliance), into the same reports queue as the Inbox. */
export const jobReportInput = z.object({
  jobId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(REPORT_NOTE_MAX_CHARS).optional(),
});
