import { z } from "zod";
import { boardLinkOf } from "@/lib/my-jobs/rules";
import { gapStatus } from "./gap";
import {
  JOB_COMPANY_MAX,
  JOB_TEXT_MAX,
  JOB_TEXT_MIN,
  JOB_TITLE_MAX,
  MY_JOB_CITY_MAX,
  MY_JOB_NOTE_MAX,
  MY_JOB_STATUSES,
  MY_JOB_URL_MAX,
} from "./constants";
export { MY_JOB_STATUSES, MY_JOB_STATUS_LABELS, MY_JOB_FILTERS, MY_JOB_FILTER_LABELS, MY_JOBS_MAX, MY_JOB_NOTE_MAX, MY_JOB_DESCRIPTION_MAX, MY_JOB_URL_MAX } from "./constants";

/*
 * My jobs (handoff 12m, docs/plans/application-tracker-plan.md): every input is checked here and scoped to the session
 * user by the store (src/lib/my-jobs/store.ts). Job text, notes and links are the person's own and never logged.
 */

export const myJobStatus = z.enum(MY_JOB_STATUSES);

/** One line of plain text: spaces collapsed, no control characters. */
const line = (max: number, what: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, `Add the ${what}.`).max(max, `Keep the ${what} under ${max} characters.`));

/** An empty field is no value. */
const blankIsNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** The job's own page: https only, at most 2,000 characters. */
export const jobLink = z.preprocess(
  blankIsNull,
  z
    .string()
    .trim()
    .max(MY_JOB_URL_MAX, "Keep the link under 2,000 characters.")
    .pipe(z.url({ protocol: /^https$/, error: "Use the job's https link, as it shows in your browser." }))
    .nullable(),
);

const city = z.preprocess(blankIsNull, line(MY_JOB_CITY_MAX, "city").nullable());

/** Which job a change is for: a feed post or a job the person added (its job check). */
export const myJobRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("post"), postId: z.uuid() }).strict(),
  z.object({ kind: z.literal("check"), checkId: z.uuid() }).strict(),
]);
export type MyJobRef = z.infer<typeof myJobRef>;

/**
 * POST /api/my-jobs, "Add a job you found": the description, a link, or both. A link alone only works when it is a
 * company job board's posting, which is read from the board's public API; any other link is only kept and shown.
 */
export const addJobRequest = z
  .object({
    resumeId: z.uuid(),
    text: z
      .string()
      .trim()
      .max(JOB_TEXT_MAX, `Paste up to ${JOB_TEXT_MAX.toLocaleString("en-IN")} characters of the description.`)
      .default(""),
    url: jobLink.default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.text && v.text.length < JOB_TEXT_MIN)
      ctx.addIssue({ code: "custom", path: ["text"], message: `Paste the full job description: at least ${JOB_TEXT_MIN} characters.` });
    else if (!v.text && !(v.url && boardLinkOf(v.url)))
      ctx.addIssue({ code: "custom", path: ["text"], message: "Paste the job description. We only read links from company job boards." });
  });
export type AddJobRequest = z.infer<typeof addJobRequest>;

/** "Save to My jobs" after "Check these, then save": the company, title and city the person checked. */
export const saveJobRequest = z
  .object({ checkId: z.uuid(), company: line(JOB_COMPANY_MAX, "company name"), title: line(JOB_TITLE_MAX, "job title"), city: city.default(null) })
  .strict();
export type SaveJobRequest = z.infer<typeof saveJobRequest>;

/** The status chip's menu. */
export const jobStatusRequest = z.object({ ref: myJobRef, status: myJobStatus }).strict();
export type JobStatusRequest = z.infer<typeof jobStatusRequest>;

/** A day in IST as the date field sends it. */
const day = z.preprocess(blankIsNull, z.iso.date().nullable());

/** A date and time in IST as the datetime field sends it ("2026-10-30T10:30"): the interview. */
export const istMinute = z.preprocess(
  blankIsNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick the interview's date and time.")
    // A real day and time (not 30 Feb or 25:00) in a sensible range: read as IST, it writes back the same.
    .refine((v) => {
      const at = Date.parse(`${v}:00+05:30`);
      return Number.isFinite(at) && new Date(at + 5.5 * 3600_000).toISOString().slice(0, 16) === v && v >= "2000" && v < "2101";
    }, "Pick the interview's date and time.")
    .nullable(),
);

const note = z.preprocess(
  blankIsNull,
  z.string().trim().max(MY_JOB_NOTE_MAX, `Keep the note under ${MY_JOB_NOTE_MAX.toLocaleString("en-IN")} characters.`).nullable(),
);

/**
 * The edit sheet. Company, title, link and city change only on a job the person added: a feed job keeps the
 * posting's. The note and the dates are the person's on either. `closedOn` counts only for a closed status.
 */
export const updateJobRequest = z
  .object({
    ref: myJobRef,
    company: line(JOB_COMPANY_MAX, "company name").optional(),
    title: line(JOB_TITLE_MAX, "job title").optional(),
    url: jobLink.optional(),
    city: city.optional(),
    status: myJobStatus,
    appliedOn: day.default(null),
    closedOn: day.default(null),
    /** The interview, IST. Setting it moves an earlier status to Interview; empty clears it. */
    interviewAt: istMinute.default(null),
    note: note.default(null),
  })
  .strict();
export type UpdateJobRequest = z.infer<typeof updateJobRequest>;

export const deleteJobRequest = z.object({ ref: myJobRef }).strict();

/** One row of My jobs as the screen shows it. Plain data; never holds the description, which loads on its own. */
export const myJobView = z.object({
  /** "post:<id>" or "check:<id>", unique in the list. */
  key: z.string(),
  ref: myJobRef,
  company: z.string(),
  title: z.string(),
  city: z.string().nullable(),
  /** "You added" or "Company job board". */
  source: z.enum(["you", "board"]),
  url: z.string().nullable(),
  status: myJobStatus,
  savedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  /** The interview's date and time (ISO), when the person set one. */
  interviewAt: z.string().nullable(),
  note: z.string().nullable(),
  updatedAt: z.string(),
  /** The feed post left its board. */
  postClosed: z.boolean(),
  /** Whether a description is kept to read again. */
  hasDescription: z.boolean(),
  /** Fit from code: null when it can't be shown (no confirmed resume, or a post naming too few skills we know). */
  fit: z
    .object({
      have: z.number().int().min(0),
      open: z.array(z.object({ status: gapStatus, name: z.string() })),
      only: z.array(z.string()),
    })
    .nullable(),
});
export type MyJobView = z.infer<typeof myJobView>;

/**
 * "Prepare for this job" on /mock and Practice: the job's company and title, and in the order a round asks them, the
 * names of its still-open goals and of the skills only this job asks for; `skipped` are those of them the question bank
 * has no questions for yet.
 */
export const jobPrepView = z.strictObject({
  ref: myJobRef,
  company: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  open: z.array(z.string().min(1).max(120)).max(40),
  only: z.array(z.string().min(1).max(120)).max(40),
  skipped: z.array(z.string().min(1).max(120)).max(40),
});
export type JobPrepView = z.infer<typeof jobPrepView>;

/**
 * Today's "Next interview" card (handoff 12m: "Today counts down to it"): the soonest interview the person set in My
 * jobs that hasn't started more than two hours ago, on a job still at Interview or Offer.
 */
export const nextInterviewView = z.strictObject({
  ref: myJobRef,
  company: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  interviewAt: z.iso.datetime(),
});
export type NextInterviewView = z.infer<typeof nextInterviewView>;

/** One row of `my_jobs` in Download your data (added in export version 33). */
export const myJobExport = z.object({
  source: z.enum(["you_added", "company_job_board"]),
  company: z.string(),
  title: z.string(),
  city: z.string().nullable(),
  url: z.string().nullable(),
  status: z.string(),
  saved_at: z.string().nullable(),
  applied_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  /** From export version 34. */
  interview_at: z.string().nullable(),
  note: z.string().nullable(),
  description: z.string().nullable(),
});
export type MyJobExport = z.infer<typeof myJobExport>;
