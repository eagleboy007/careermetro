import { z } from "zod";
import { hasContactOrLink, interestKey, MONTH, oneLine, storyText } from "@/lib/me/text";
import {
  INTEREST_MAX,
  ME_CONTACT_TEXT,
  ME_EDUCATION_TEXT_MAX,
  ME_EDUCATION_YEAR_MAX,
  ME_ROLE_TEXT_MAX,
  STORY_BOXES,
  STORY_PART_MAX,
  STORY_SOURCES,
  STORY_TITLE_MAX,
  STORY_WHERE_MAX,
} from "./constants";

/*
 * Me editing (docs/plans/me-editing-plan.md, v44 gap item 23): what a person adds by hand on /me. Every input is strict,
 * so an extra field (a user id, a source) is refused rather than ignored. Text others read refuses email addresses,
 * phone numbers and links (plan choice 8). The user id never comes from here: the server takes it from the session.
 */

const tooLong = (max: number) => `At most ${max} characters.`;

/**
 * One line of text others read: single-spaced and trimmed, `min` to `max` characters, with no contact details or links.
 * `domains: false` lets a name that is a domain through ("Booking.com" as a company); see hasLink.
 */
const line = (min: number, max: number, empty: string, linkRules?: { domains?: boolean }) =>
  z
    .string()
    .max(max * 4, { error: tooLong(max) })
    .transform(oneLine)
    .refine((v) => v.length >= min, { error: empty })
    .refine((v) => v.length <= max, { error: tooLong(max) })
    .refine((v) => !hasContactOrLink(v, linkRules), { error: ME_CONTACT_TEXT });

/** A story part: line breaks kept, at most STORY_PART_MAX characters, "" when empty. */
const part = z
  .string()
  .max(STORY_PART_MAX * 4, { error: tooLong(STORY_PART_MAX) })
  .transform(storyText)
  .refine((v) => v.length <= STORY_PART_MAX, { error: tooLong(STORY_PART_MAX) })
  .refine((v) => !hasContactOrLink(v), { error: ME_CONTACT_TEXT });

const month = z.string().regex(MONTH, { error: "Pick a month and year." });

/**
 * "+ Add role" (and its Edit). Ended in or after the month it started, no end while "I work here now" is ticked, and an
 * end month when it isn't.
 */
export const meRoleInput = z
  .strictObject({
    title: line(1, ME_ROLE_TEXT_MAX, "Add the job title."),
    employer: line(1, ME_ROLE_TEXT_MAX, "Add the company.", { domains: false }),
    startMonth: month,
    endMonth: month.nullable(),
    isCurrent: z.boolean(),
  })
  .superRefine((r, ctx) => {
    if (r.isCurrent && r.endMonth !== null) ctx.addIssue({ code: "custom", path: ["endMonth"], message: "Leave the end empty while you work here." });
    if (!r.isCurrent && r.endMonth === null) ctx.addIssue({ code: "custom", path: ["endMonth"], message: "Pick when it ended, or tick I work here now." });
    if (r.endMonth !== null && r.endMonth < r.startMonth) ctx.addIssue({ code: "custom", path: ["endMonth"], message: "It can't end before it started." });
  });

/** "+ Add" under Education (and its Edit). The year is free text, such as "2024" or "2021 to 2024", or empty. */
export const meEducationInput = z.strictObject({
  qualification: line(1, ME_EDUCATION_TEXT_MAX, "Add the qualification."),
  institution: line(1, ME_EDUCATION_TEXT_MAX, "Add the institution.", { domains: false }),
  year: line(0, ME_EDUCATION_YEAR_MAX, "").transform((v) => v || null),
});

export const storyBoxInput = z.enum(STORY_BOXES);

/**
 * "+ Add story" (and its Edit): hand-written only in v1 (plan choice 1). A title, "Where and when", the four parts, at
 * least one box, and an optional goal of the person's own (the store checks that it is theirs).
 */
export const storyInput = z.strictObject({
  title: line(1, STORY_TITLE_MAX, "Add a title."),
  where: line(0, STORY_WHERE_MAX, ""),
  situation: part,
  task: part,
  action: part,
  result: part,
  boxes: z
    .array(storyBoxInput)
    .min(1, { error: "Pick at least one box." })
    .max(STORY_BOXES.length)
    .transform((b) => STORY_BOXES.filter((x) => b.includes(x))),
  goalId: z.uuid().nullable(),
});

/** One interest as typed: up to 40 characters, kept as typed and compared by its key. */
export const interestInput = z.strictObject({
  name: line(1, INTEREST_MAX, "Type an interest first."),
});

/** Edit and delete name one row by its id; the store matches it to the session's user. */
export const meRowId = z.uuid();

/** Removing an interest names it as shown; it is matched by its key. */
export const interestRemoveInput = z.strictObject({ name: z.string().min(1).max(INTEREST_MAX * 4).transform(interestKey) });

/* Download your data, version 28 ----------------------------------------------------------------------------------- */

export const meRoleExport = z.object({
  title: z.string(),
  employer: z.string(),
  startMonth: z.string(),
  endMonth: z.string().nullable(),
  isCurrent: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const meEducationExport = z.object({
  qualification: z.string(),
  institution: z.string(),
  year: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const storyExport = z.object({
  title: z.string(),
  where: z.string(),
  situation: z.string(),
  task: z.string(),
  action: z.string(),
  result: z.string(),
  boxes: z.array(storyBoxInput),
  /** The skill of the goal the story is linked to, by name; null with no goal. */
  goalSkill: z.string().nullable(),
  source: z.enum(STORY_SOURCES),
  created_at: z.string(),
  updated_at: z.string(),
});
export const interestExport = z.object({ name: z.string(), created_at: z.string() });

export type MeRoleInput = z.infer<typeof meRoleInput>;
export type MeEducationInput = z.infer<typeof meEducationInput>;
export type StoryInput = z.infer<typeof storyInput>;
export type MeRoleExport = z.infer<typeof meRoleExport>;
export type MeEducationExport = z.infer<typeof meEducationExport>;
export type StoryExport = z.infer<typeof storyExport>;
export type InterestExport = z.infer<typeof interestExport>;
