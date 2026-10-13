import { z } from "zod";
import { JOB_COMPANY_MAX, JOB_TEXT_MAX, JOB_TEXT_MIN, JOB_TITLE_MAX, ROLE_REQUEST_TITLE_MAX } from "./constants";
export { JOB_COMPANY_MAX, JOB_TEXT_MAX, JOB_TEXT_MIN, JOB_TITLE_MAX, ROLE_REQUEST_TITLE_MAX } from "./constants";

/** One line of plain text: spaces collapsed, no control characters. */
const line = (max: number, what: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, `Add the ${what}.`).max(max, `Keep the ${what} under ${max} characters.`));

/**
 * "Check against a job" (role-suggest-plan.md part B): a posting the person pasted, checked against the resume and
 * the target role. The text is read once and never stored. A null role means the check stands in as the target for a
 * role our library doesn't have yet (part 3).
 */
export const jobCheckRequest = z
  .object({
    resumeId: z.uuid(),
    roleSlug: z.string().regex(/^[a-z0-9-]{1,80}$/).nullable(),
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

/** "Add as my goal" on a saved job check: one skill from its "Only for this job" group. */
export const jobCheckGoalRequest = z.object({ skillId: z.string().regex(/^[a-z0-9-]{1,80}$/) }).strict();
export type JobCheckGoalRequest = z.infer<typeof jobCheckGoalRequest>;

/** Names with a dot that are skills or degrees, not addresses: "ASP.NET", "VB.NET", "B.Com". */
const DOTTED_NAMES = /(?<![\p{L}\p{N}])(?:asp|ado|vb)\.net(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])[bm]\.com(?![\p{L}\p{N}])/giu;

/**
 * A bare link such as "linkedin.com/in/priya" or "example.co.in": a dotted word followed by "/", or a word ending in a
 * common domain ending. ".NET" on its own and "Node.js" or "Vue.js" are not links.
 */
function looksLikeLink(raw: string): boolean {
  const text = raw.replace(DOTTED_NAMES, " ");
  return /[\p{L}\p{N}-]\.[\p{L}\p{N}.-]*\//u.test(text) || /[\p{L}\p{N}-]\.(?:com|in|io|org|co|net)(?![\p{L}\p{N}])/iu.test(text);
}

/** The most a typed title may be before it is read at all; longer input is refused, not cut. */
const ROLE_REQUEST_RAW_MAX = 200;

/**
 * A typed role title as role_requests keeps it: one lowercased line of letters, digits and the marks titles use
 * ("c++", ".net", "ui/ux"), cut at a word boundary to ROLE_REQUEST_TITLE_MAX. Nothing that looks like an email, a phone
 * number or a link is kept, since the table holds nothing about the person.
 */
export const roleRequestTitle = z
  .string()
  .max(ROLE_REQUEST_RAW_MAX)
  .refine((raw) => !/@|https?:|www\./i.test(raw) && !/\d{5,}/.test(raw.replace(/[\s().-]/g, "")) && !looksLikeLink(raw))
  .transform((raw) => {
    const line = raw
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N} +#./&()-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (line.length <= ROLE_REQUEST_TITLE_MAX) return line;
    const cut = line.slice(0, ROLE_REQUEST_TITLE_MAX + 1);
    const space = cut.lastIndexOf(" ");
    return (space > 0 ? cut.slice(0, space) : cut.slice(0, ROLE_REQUEST_TITLE_MAX)).trim();
  })
  .pipe(z.string().min(2).regex(/\p{L}.*\p{L}/u));

/** POST /api/role-requests: a search of the role list that found nothing. */
export const roleRequestBody = z.object({ title: roleRequestTitle }).strict();
