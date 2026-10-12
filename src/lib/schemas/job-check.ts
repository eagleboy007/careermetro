import { z } from "zod";
import { JOB_COMPANY_MAX, JOB_TEXT_MAX, JOB_TEXT_MIN, JOB_TITLE_MAX } from "./constants";
export { JOB_COMPANY_MAX, JOB_TEXT_MAX, JOB_TEXT_MIN, JOB_TITLE_MAX } from "./constants";

/** One line of plain text: spaces collapsed, no control characters. */
const line = (max: number, what: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, `Add the ${what}.`).max(max, `Keep the ${what} under ${max} characters.`));

/**
 * "Check against a job" (role-suggest-plan.md part B): a posting the person pasted, checked against the resume and
 * the target role. The text is read once and never stored.
 */
export const jobCheckRequest = z
  .object({
    resumeId: z.uuid(),
    roleSlug: z.string().regex(/^[a-z0-9-]{1,80}$/),
    company: line(JOB_COMPANY_MAX, "company name"),
    title: line(JOB_TITLE_MAX, "job title"),
    text: z
      .string()
      .trim()
      .min(JOB_TEXT_MIN, `Paste the full job posting: at least ${JOB_TEXT_MIN} characters.`)
      .max(JOB_TEXT_MAX, `Paste up to ${JOB_TEXT_MAX.toLocaleString("en-IN")} characters of the posting.`),
  })
  .strict();
export type JobCheckRequest = z.infer<typeof jobCheckRequest>;

/** How strongly a posting asks for a skill: what it requires, or what it would like ("good to have"). */
export const postingSkillLevel = z.enum(["required", "nice"]);

/** What the parse-jd prompt returns: only the skills the posting names, each with its exact words from the posting. */
export const postingSkills = z.object({
  skills: z.array(z.object({ name: z.string(), quote: z.string(), level: postingSkillLevel })),
});
export type PostingSkills = z.infer<typeof postingSkills>;
