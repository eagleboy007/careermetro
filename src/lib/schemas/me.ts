import { z } from "zod";
import { STORY_BOXES, SMART } from "./constants";
import { nearbyLines } from "./nearby";
export { STORY_BOXES, SMART } from "./constants";

/**
 * Your profile (post-login handoff, section 11). The server fills it from the person's confirmed profile and current
 * gaps, plus the roles, education, stories and interests the person adds on Me (docs/plans/me-editing-plan.md). The
 * design page and the preview use a synthetic example.
 */
export const storyBox = z.enum(STORY_BOXES);

export const story = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(120),
  /** Where and when: "Konkan Co-operative Bank · 2025". */
  where: z.string().max(120),
  boxes: z.array(storyBox).min(1).max(6),
  situation: z.string().max(400),
  task: z.string().max(400),
  action: z.string().max(400),
  result: z.string().max(400),
  /** The SMART letters the story meets. Never a score. */
  smart: z.array(z.enum(SMART)).max(5),
  /** One hint for the first missing letter. */
  hint: z.string().max(200).nullable(),
  /** Backed by confirmed work proof. */
  confirmed: z.boolean(),
  /** Written from a goal the person proved or is working on. */
  fromGoal: z.boolean(),
  /** The linked goal, for the owner's Edit only; others never get it. */
  goalId: z.uuid().nullable().optional(),
});

export const journeyStop = z.object({
  state: z.enum(["done", "now", "future"]),
  name: z.string().min(1).max(80),
  detail: z.string().max(80),
});

export const meExperience = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  employer: z.string().min(1).max(120),
  /** "Jun 2024 to now · 2 years 4 months". */
  dates: z.string().max(80),
  current: z.boolean(),
  /** Lines from the person's own resume. Shown to them only, never to others. */
  highlights: z.array(z.string().max(300)).max(8),
  /**
   * The work-email check of the job (FR-47): only the current job and jobs whose check passed have one. "review" is
   * shown to the person only; others see it as "not_verified".
   */
  check: z
    .object({ state: z.enum(["verified", "verified_while_there", "review", "self_declared", "not_verified"]), month: z.string().max(20).nullable() })
    .nullable()
    .optional(),
  /**
   * Set on a role the person added on Me ("Added by you", with Edit and Delete), for the owner only: its row id and
   * months as saved. Null or absent for a resume role, which is never edited on Me (plan choice 3).
   */
  added: z
    .object({ id: z.uuid(), startMonth: z.string().max(7), endMonth: z.string().max(7).nullable() })
    .nullable()
    .optional(),
});

/** One qualification. `added` is the row id of one the person added on Me, for the owner only. */
export const meEducationItem = z.object({
  qualification: z.string().max(160),
  institution: z.string().max(160),
  year: z.string().max(40),
  added: z.object({ id: z.uuid() }).nullable().optional(),
});

/** The only link a profile shows for a certificate: a verified badge's public Credly page, rebuilt from its id. */
export const CREDLY_BADGE_PAGE = /^https:\/\/www\.credly\.com\/badges\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One certification on a profile (pending item 13, dev/profile-certs-plan.md): from an accepted certificate proof, or
 * listed on the resume. `proofId`, `note` and `canCheck` are for the owner only; the public profile always clears
 * them, and leaves out expired ones.
 */
export const meCertification = z.object({
  /** The proof behind it, for the owner's "Check with Credly". Null for resume certificates. */
  proofId: z.uuid().nullable(),
  name: z.string().min(1).max(160),
  /** From our certificate list; null for a resume certificate we can't place. */
  issuer: z.string().max(120).nullable(),
  /** When it was issued or passed, as "Mar 2025"; null when not known. */
  date: z.string().max(40).nullable(),
  /**
   * "verified": its Credly badge matched. "added": added by the person, from the form or their resume. "pending": a
   * Credly badge waiting for its check, owner only (it fills nothing and is never on the public profile).
   */
  status: z.enum(["verified", "added", "pending"]),
  fromResume: z.boolean(),
  /** "Mar 2026" once it has expired; null while current. */
  expired: z.string().max(40).nullable(),
  /** The public Credly badge page, only for a verified badge. */
  badgeUrl: z.string().regex(CREDLY_BADGE_PAGE).nullable(),
  /** Owner only: why the last Credly check didn't verify it, in plain words. */
  note: z.string().max(200).nullable(),
  /** Owner only: it has a Credly badge link we can check. */
  canCheck: z.boolean(),
});

export const meProfile = z.object({
  name: z.string().min(1).max(120),
  /** The person's own one line under their name, from Account settings. */
  headline: z.string().max(80).nullable().default(null),
  /** Destination role, null before there is one. */
  aim: z.string().max(120).nullable(),
  /** `private` stats (the gap count) are hidden from others. */
  stats: z.array(z.object({ value: z.string().max(20), label: z.string().max(60), private: z.boolean() })).max(6),
  journey: z.array(journeyStop).max(12),
  journeyLabel: z.string().max(120),
  /** Resume roles (up to 20) and roles added on Me (up to 20), newest start first. */
  experience: z.array(meExperience).max(40),
  /** "2 years 4 months", or null when no role has dates. */
  experienceTotal: z.string().max(40).nullable(),
  education: z.array(meEducationItem).max(24),
  skills: z.object({
    have: z.array(z.string().max(80)).max(30),
    weak: z.array(z.string().max(80)).max(12),
    missing: z.array(z.string().max(80)).max(12),
  }),
  interests: z.array(z.string().max(60)).max(30),
  stories: z.array(story).max(50),
  proofs: z.array(z.object({ title: z.string().max(160), detail: z.string().max(120) })).max(20),
  certifications: z.array(meCertification).max(30),
  /** When the resume was read, or null with no resume. */
  resumeReadOn: z.string().max(40).nullable(),
  /** Nearby lines from the target role (dev/nearby-lines-plan.md). Only the person sees them. Null before there are gaps. */
  nearby: nearbyLines.nullable().default(null),
  /** The existing role picker, for switching target role. Null without a resume. */
  changeRoleHref: z.string().max(120).nullable().default(null),
});

export type StoryBox = z.infer<typeof storyBox>;
export type Story = z.infer<typeof story>;
export type JourneyStop = z.infer<typeof journeyStop>;
export type MeExperience = z.infer<typeof meExperience>;
export type MeEducationItem = z.infer<typeof meEducationItem>;
export type MeProfile = z.infer<typeof meProfile>;
export type MeCertification = z.infer<typeof meCertification>;
