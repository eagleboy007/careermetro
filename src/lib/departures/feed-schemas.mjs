// Zod schemas for live Departures (docs/plans/departures-live-plan.md): the reviewed board list
// (src/content/job-boards.json), the public job-board API answers the daily feed reads, and the job_posts row it
// writes. Plain JavaScript, so scripts/departures/fetch-feeds.mjs runs with plain Node; the app's own inputs (save,
// stage) are in src/lib/schemas/departures.ts. Only the four public job-board APIs the Project manager approved:
// Greenhouse, Lever, Ashby and SmartRecruiters. Nothing here is scraped from a web page.
import { z } from "zod";
import { FEED_LIMITS } from "./feed-rules.mjs";

/** The job-board APIs Departures reads. Changing this list is a PR and a plan change, never a setting. */
export const ATS = /** @type {const} */ (["greenhouse", "lever", "ashby", "smartrecruiters"]);

/** As the jobs table stores work type (JOB_WORK_TYPES in src/lib/schemas/constants.ts). */
export const FEED_WORK_TYPES = /** @type {const} */ (["full_time", "part_time", "freelance"]);

/**
 * A board token, kept in its own case (SmartRecruiters ids are case-sensitive: "SWIGGY", "NielsenIQ"). Letters, digits,
 * "_" and "-", and a single "." between letters or digits for Ashby boards named by domain ("flagright.com"). It starts
 * with a letter or digit, so it is never "." or "..", and it has no "/", "%", "?", "#" or space, so it is safe in a URL
 * path. TOKEN_PATTERN is the same rule for the feed's `ats:token` keys.
 */
export const TOKEN_PATTERN = "[A-Za-z0-9](?:[A-Za-z0-9_-]|\\.(?=[A-Za-z0-9])){0,79}";
const token = z.string().max(80).regex(new RegExp(`^${TOKEN_PATTERN}$`));
const https = z.url({ protocol: /^https$/ }).max(500);
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);

/** One reviewed company board. Added by PR only: Milin or a domain expert adds boards; there is no discovery. */
export const jobBoard = z
  .object({
    company: z.string().trim().min(1).max(80),
    ats: z.enum(ATS),
    token,
    /** Greenhouse only: "eu" for a board on Greenhouse's EU host (boards-api.eu.greenhouse.io). Left out otherwise. */
    host: z.literal("eu").optional(),
    /** The company's own careers page on its job board, for a reviewer to check the board is the company's. */
    careersUrl: https,
    addedBy: z.string().trim().min(1).max(60),
    addedOn: z.iso.date(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.host && b.ats !== "greenhouse") ctx.addIssue({ code: "custom", path: ["host"], message: "Only a Greenhouse board has an EU host" });
    if (b.token.includes(".") && b.ats !== "ashby") ctx.addIssue({ code: "custom", path: ["token"], message: "Only an Ashby token may have a dot" });
  });

/** The whole board file: at most 300 boards (the feed's cap, FEED_LIMITS.boards), each ATS and token once. */
export const jobBoardsFile = z
  .array(jobBoard)
  .max(300)
  .superRefine((boards, ctx) => {
    const seen = new Set();
    boards.forEach((b, i) => {
      const key = `${b.ats}:${b.token.toLowerCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: [i, "token"], message: `${key} is listed twice` });
      seen.add(key);
    });
  });

/*
 * The public API answers. Each envelope is checked first; then each posting on its own, so one odd posting skips
 * that posting, not the board. Unknown fields are dropped. Text fields are read for skills and never stored.
 */
const text = z.string().max(200_000).nullish();
const id = z.union([z.string().min(1).max(120), z.number().int().nonnegative()]).transform(String);

export const greenhouseBoard = z.object({ jobs: z.array(z.unknown()) });
export const greenhouseJob = z.object({
  id,
  title: z.string().max(500),
  absolute_url: z.string().max(500),
  location: z.object({ name: z.string().max(500).nullish() }).nullish(),
  content: text,
  first_published: z.string().max(40).nullish(),
  updated_at: z.string().max(40).nullish(),
});

export const leverBoard = z.array(z.unknown());
export const leverJob = z.object({
  id,
  text: z.string().max(500),
  hostedUrl: z.string().max(500),
  createdAt: z.number().int().nonnegative().nullish(),
  workplaceType: z.string().max(40).nullish(),
  categories: z
    .object({
      location: z.string().max(500).nullish(),
      allLocations: z.array(z.string().max(500)).max(50).nullish(),
      commitment: z.string().max(80).nullish(),
    })
    .nullish(),
  descriptionPlain: text,
  lists: z.array(z.object({ text: z.string().max(500), content: z.string().max(200_000) })).max(30).nullish(),
  additionalPlain: text,
});

export const ashbyBoard = z.object({ jobs: z.array(z.unknown()) });
export const ashbyJob = z.object({
  id,
  title: z.string().max(500),
  jobUrl: z.string().max(500),
  location: z.string().max(500).nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().max(500).nullish() })).max(50).nullish(),
  employmentType: z.string().max(40).nullish(),
  isRemote: z.boolean().nullish(),
  isListed: z.boolean().nullish(),
  descriptionPlain: text,
  descriptionHtml: text,
  publishedAt: z.string().max(40).nullish(),
});

export const smartRecruitersBoard = z.object({ content: z.array(z.unknown()), totalFound: z.number().int().nonnegative().nullish() });
export const smartRecruitersJob = z.object({
  id,
  name: z.string().max(500),
  releasedDate: z.string().max(40).nullish(),
  company: z.object({ identifier: z.string().max(120).nullish() }).nullish(),
  location: z
    .object({
      city: z.string().max(120).nullish(),
      region: z.string().max(120).nullish(),
      country: z.string().max(10).nullish(),
      remote: z.boolean().nullish(),
      fullLocation: z.string().max(500).nullish(),
    })
    .nullish(),
  typeOfEmployment: z.object({ label: z.string().max(80).nullish() }).nullish(),
});

/** @type {(d: unknown) => boolean} */
const whole = () => false;

/**
 * The envelope and the posting schema of each ATS, and whether the answer may be only part of the board. Greenhouse,
 * Lever and Ashby answer with every posting. SmartRecruiters answers a page of `limit=100`; the feed reads up to five
 * pages and joins them, so a totalFound above what came back (or, with no totalFound, a full page) counts as cut short,
 * and that board closes nothing.
 */
export const FEED_SCHEMAS = {
  greenhouse: { board: greenhouseBoard, job: greenhouseJob, jobs: (/** @type {any} */ d) => d.jobs, truncated: whole },
  lever: { board: leverBoard, job: leverJob, jobs: (/** @type {any} */ d) => d, truncated: whole },
  ashby: { board: ashbyBoard, job: ashbyJob, jobs: (/** @type {any} */ d) => d.jobs, truncated: whole },
  smartrecruiters: {
    board: smartRecruitersBoard,
    job: smartRecruitersJob,
    jobs: (/** @type {any} */ d) => d.content,
    truncated: (/** @type {any} */ d) =>
      d.totalFound == null ? d.content.length >= FEED_LIMITS.smartRecruitersPage : d.totalFound > d.content.length,
  },
};

/**
 * One job_posts row as the feed writes it. No post text: only the title, company, place, work type, the stated
 * experience, the live role read from the title, and the skill ids found by code.
 */
export const jobPostRow = z.object({
  ats: z.enum(ATS),
  boardToken: token,
  externalId: z.string().min(1).max(120),
  url: https,
  title: z.string().min(2).max(160),
  company: z.string().min(1).max(80),
  /** A city in India, "Remote", or "India" when the post names no city. */
  city: z.string().min(1).max(60),
  workType: z.enum(FEED_WORK_TYPES),
  experienceNote: z.string().min(1).max(40).nullable(),
  /** The live role the title reads as; null when no live role matches. */
  roleSlug: slug.nullable(),
  requiredSkillIds: z.array(slug).max(40),
  niceSkillIds: z.array(slug).max(40),
  postedAt: z.date().nullable(),
});
