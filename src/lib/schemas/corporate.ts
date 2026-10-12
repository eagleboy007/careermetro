import { z } from "zod";
import { checkWorkEmail, normalWebsite, workEmailProblemText } from "@/lib/corporate/domains";
import { ORG_ABOUT_MAX_CHARS, ORG_INDUSTRIES, ORG_REVIEW_STATUSES, ORG_ROLES, ORG_SIZES, ORG_TYPES, WORK_EMAIL_PURPOSES } from "./constants";

/*
 * Corporate, build steps 1 and 2 (dev/corporate-plan.md; handoff 12e and 12f): company sign-up, the work-email code,
 * team and access. A work email is personal data: it is checked here, used once, and never logged.
 */

export { ORG_ABOUT_MAX_CHARS, ORG_INDUSTRIES, ORG_REVIEW_STATUSES, ORG_ROLES, ORG_SIZES, ORG_TYPES, WORK_EMAIL_PURPOSES };

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
