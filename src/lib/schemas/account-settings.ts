import { z } from "zod";
import {
  cleanHeadline,
  HEADLINE_MESSAGES,
  headlineProblem,
  normalUsername,
  PAY_MESSAGE,
  parseLakh,
  USERNAME_MESSAGES,
  usernameProblem,
} from "@/lib/account/username";
import { PROFILE_VISIBILITIES, RIDE_REMINDERS } from "./constants";
export { PROFILE_VISIBILITIES, PROFILE_VISIBILITY_LABELS, RIDE_REMINDERS } from "./constants";

/**
 * Account settings, part 2 (dev/account-settings-plan.md, handoff 12c): username, headline, private pay, privacy and
 * notification preferences. The form sends what the person typed; these schemas clean and check it, and the server
 * saves only what passes.
 */

export const username = z
  .string()
  .max(60)
  .transform(normalUsername)
  .superRefine((name, ctx) => {
    const problem = usernameProblem(name);
    if (problem) ctx.addIssue({ code: "custom", message: USERNAME_MESSAGES[problem] });
  });

/** "" becomes null: no headline. */
export const headline = z
  .string()
  .max(400)
  .transform(cleanHeadline)
  .superRefine((text, ctx) => {
    const problem = headlineProblem(text);
    if (problem) ctx.addIssue({ code: "custom", message: HEADLINE_MESSAGES[problem] });
  })
  .transform((text) => text || null);

/** Pay as typed, in lakh a year. "" becomes null. */
export const payInput = z
  .string()
  .max(20)
  .transform((raw, ctx) => {
    const n = parseLakh(raw);
    if (n === undefined) {
      ctx.addIssue({ code: "custom", message: PAY_MESSAGE });
      return z.NEVER;
    }
    return n;
  });

export const profileVisibility = z.enum(PROFILE_VISIBILITIES);

/** What shows on the public profile, besides name and headline. Resume lines, pay, phone, email and notice period never do. */
export const publicParts = z.object({
  showTargetRole: z.boolean(),
  showExperience: z.boolean(),
  showEducation: z.boolean(),
  showSkills: z.boolean(),
  showGaps: z.boolean(),
  showCertifications: z.boolean(),
});

/** Stored only: nothing is sent until there is an email sender (pending item 21). */
export const notificationPrefs = z.object({
  rideReminder: z.enum(RIDE_REMINDERS),
  emailCompanyMessages: z.boolean(),
  emailWeeklySummary: z.boolean(),
});

/**
 * "Let companies find me" (pending item 19, dev/companies-find-me-plan.md): off until the person turns it on. While on,
 * verified companies can find them from one of their open jobs and see the profile parts above (never gaps) and the match.
 */
export const companiesCanFind = z.boolean();

export const userSettings = z.object({ visibility: profileVisibility, ...publicParts.shape, companiesCanFind, ...notificationPrefs.shape });

/** No row in user_settings means these (decided 2026-10-13): hidden until the person chooses; target role and gaps off. */
export const DEFAULT_SETTINGS: UserSettings = {
  visibility: "only_me",
  showTargetRole: false,
  showExperience: true,
  showEducation: true,
  showSkills: true,
  showGaps: false,
  showCertifications: true,
  companiesCanFind: false,
  rideReminder: "19:30",
  emailCompanyMessages: true,
  emailWeeklySummary: false,
};

/** One save of the settings form. A blank username means "keep what I have" (it can't be cleared once set). */
export const settingsInput = z.object({
  username: z.union([z.literal("").transform(() => null), username]),
  headline,
  currentPay: payInput,
  expectedPay: payInput,
  settings: userSettings,
});

export type ProfileVisibility = z.infer<typeof profileVisibility>;
export type PublicParts = z.infer<typeof publicParts>;
export type NotificationPrefs = z.infer<typeof notificationPrefs>;
export type UserSettings = z.infer<typeof userSettings>;
export type SettingsInput = z.infer<typeof settingsInput>;
/** The fields a save can fail on, for the message next to each. */
export type SettingsField = "username" | "headline" | "currentPay" | "expectedPay" | "settings";

/** The first message for each field that failed, keyed by its top-level name. */
export function settingsErrors(error: z.ZodError): Partial<Record<SettingsField, string>> {
  const out: Partial<Record<SettingsField, string>> = {};
  for (const issue of error.issues) {
    const field = (issue.path[0] ?? "settings") as SettingsField;
    out[field] ??= field === "settings" ? "Something in these settings isn't one of the choices. Reload the page and try again." : issue.message;
  }
  return out;
}
