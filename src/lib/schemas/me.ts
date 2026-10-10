import { z } from "zod";

/**
 * Your profile (post-login handoff, section 11). The server fills it from the person's confirmed profile and current
 * gaps; stories, interests, status and the visibility switches wait on their tables (dev/profile-plan.md), so the
 * design page and the preview use a synthetic example.
 */
export const STORY_BOXES = ["Ownership", "Problem solving", "Delivering results", "Learning", "Working with others", "Speaking up"] as const;
export const storyBox = z.enum(STORY_BOXES);
export const SMART = ["S", "M", "A", "R", "T"] as const;

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
});

export const meProfile = z.object({
  name: z.string().min(1).max(120),
  /** Destination role, null before there is one. */
  aim: z.string().max(120).nullable(),
  stats: z.array(z.object({ value: z.string().max(20), label: z.string().max(60) })).max(6),
  journey: z.array(journeyStop).max(12),
  journeyLabel: z.string().max(120),
  experience: z.array(meExperience).max(20),
  /** "2 years 4 months", or null when no role has dates. */
  experienceTotal: z.string().max(40).nullable(),
  education: z.array(z.object({ qualification: z.string().max(160), institution: z.string().max(160), year: z.string().max(40) })).max(12),
  skills: z.object({
    have: z.array(z.string().max(80)).max(30),
    weak: z.array(z.string().max(80)).max(12),
    missing: z.array(z.string().max(80)).max(12),
  }),
  interests: z.array(z.string().max(60)).max(30),
  stories: z.array(story).max(40),
  proofs: z.array(z.object({ title: z.string().max(160), detail: z.string().max(120) })).max(20),
  certifications: z.array(z.object({ name: z.string().max(160), verified: z.boolean() })).max(30),
  /** When the resume was read, or null with no resume. */
  resumeReadOn: z.string().max(40).nullable(),
});

export type StoryBox = z.infer<typeof storyBox>;
export type Story = z.infer<typeof story>;
export type JourneyStop = z.infer<typeof journeyStop>;
export type MeExperience = z.infer<typeof meExperience>;
export type MeProfile = z.infer<typeof meProfile>;
