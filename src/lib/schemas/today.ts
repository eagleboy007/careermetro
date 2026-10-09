import { z } from "zod";

/**
 * The signed-in home (`/today`), as one view model. PR 1 and 2 fill it from a fixture;
 * later PRs fill it from the database. See docs/post-login-handoff.md, sections 4 to 6.
 */

/** Which version of Today a user sees. Picked on the server, never on the client (handoff section 4). */
export const userState = z.enum(["no_resume", "first_signup", "returning"]);
export type UserState = z.infer<typeof userState>;

/** Gap status as shown on a goal lamp. Red, amber and green only; "outdated" counts as weak here. */
export const lampStatus = z.enum(["missing", "weak", "met"]);
export type LampStatus = z.infer<typeof lampStatus>;

/** A pitstop is learn (free course plus tasks) or prove. Only prove fills a gap. */
export const pitstopKind = z.enum(["learn", "prove"]);
export type PitstopKind = z.infer<typeof pitstopKind>;

export const pitstop = z.object({
  /** Position on the whole line, counting from 1. */
  number: z.number().int().positive(),
  kind: pitstopKind,
  label: z.string().min(1),
  state: z.enum(["done", "now", "ahead"]),
  /** Short note on the right, for example "2 of 5 tasks" or "about 4 h". */
  note: z.string().min(1).optional(),
});
export type Pitstop = z.infer<typeof pitstop>;

/** One goal = one gap (Milin's rule). */
export const goal = z.object({
  id: z.string().min(1),
  skillName: z.string().min(1),
  status: lampStatus,
  /** Why it is a gap. `resumeQuote` is the line from the resume it came from, or null when nothing covers it. */
  evidence: z.string().min(1),
  resumeQuote: z.string().min(1).nullable(),
  pitstops: z.array(pitstop).min(1),
  /** An extra pitstop the app suggests, added with one tap. */
  suggestedPitstop: z.object({ title: z.string().min(1), why: z.string().min(1) }).nullable(),
  /** Goals the user adds never count in the match. */
  source: z.enum(["gap", "user"]),
});
export type Goal = z.infer<typeof goal>;

export const rideTask = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Where it comes from, for example "Free Splunk courses · video". */
  source: z.string().min(1),
  minutes: z.number().int().positive(),
  done: z.boolean(),
  /** The signal check task is ticked by answering the question, not by the checkbox. */
  kind: z.enum(["prep", "signal_check"]),
});
export type RideTask = z.infer<typeof rideTask>;

export const ride = z.object({
  goalName: z.string().min(1),
  pitstop: z.object({ number: z.number().int().positive(), total: z.number().int().positive(), kind: pitstopKind }),
  /** Today's 2 or 3 prep tasks for the current pitstop. */
  tasks: z.array(rideTask).min(1).max(3),
  /** Tasks this pitstop needs this week, and how many were done before today. */
  weekTotal: z.number().int().positive(),
  doneBeforeToday: z.number().int().nonnegative(),
  /** Labels along the mini line: pitstop numbers, then Practice and Match. Index of the pitstop being prepared. */
  lineStops: z.array(z.string().min(1)).min(2),
  currentStopIndex: z.number().int().nonnegative(),
});
export type Ride = z.infer<typeof ride>;

/** One row per day the user ticked at least one task (`ride_days`). Dates are `YYYY-MM-DD` in India time. */
export const rideDay = z.iso.date();

export const signalCheck = z.object({
  skillName: z.string().min(1),
  status: lampStatus,
  question: z.string().min(1),
  options: z
    .array(z.object({ key: z.string().length(1), label: z.string().min(1), detail: z.string().min(1).optional() }))
    .min(2)
    .max(4),
  correctKey: z.string().length(1),
  explanation: z.string().min(1),
  from: z.string().min(1),
});
export type SignalCheck = z.infer<typeof signalCheck>;

export const departure = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  city: z.string().min(1),
  posts: z.number().int().positive(),
  /** Required gaps left, each with its status. Empty means "Boarding now". */
  gaps: z.array(z.object({ skillName: z.string().min(1), status: lampStatus.exclude(["met"]) })),
  isDestination: z.boolean().default(false),
});
export type Departure = z.infer<typeof departure>;

export const firstSignup = z.object({
  skillsFound: z.number().int().nonnegative(),
  gaps: z.number().int().nonnegative(),
  goals: z.number().int().nonnegative(),
  rolesBoardingNow: z.number().int().nonnegative(),
  /** Total hours of the whole line, for "At 5 hours a week your line takes about N weeks". */
  lineHours: z.number().int().positive(),
});
export type FirstSignup = z.infer<typeof firstSignup>;

export const todayView = z.object({
  state: userState,
  firstName: z.string().min(1),
  initials: z.string().min(1).max(3),
  destination: z.string().min(1),
  track: z.string().min(1).nullable(),
  jobSearch: z.boolean(),
  /** Today in India time, `YYYY-MM-DD`. */
  today: rideDay,
  rideDays: z.array(rideDay),
  ride: ride.nullable(),
  firstSignup: firstSignup.nullable(),
  signalCheck: signalCheck.nullable(),
  goals: z.array(goal),
  moreGoals: z.array(z.string().min(1)),
  goalsMetThisMonth: z.array(z.string().min(1)),
  suggestedGoal: z.object({ skillName: z.string().min(1), why: z.string().min(1) }).nullable(),
  departures: z.array(departure),
  /** Opted-in people on the same goal. */
  ridersOnGoal: z.number().int().nonnegative(),
});
export type TodayView = z.infer<typeof todayView>;
