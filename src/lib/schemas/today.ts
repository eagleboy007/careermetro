import { z } from "zod";

/**
 * What the signed-in Today screen shows (post-login handoff, sections 4 and 5). The server fills these; until then
 * the design page and the preview use synthetic fixtures. A goal's status is missing, weak or met: the three lamps.
 */
export const USER_STATES = ["no_resume", "first", "returning"] as const;
export const userState = z.enum(USER_STATES);

export const goalStatus = z.enum(["missing", "weak", "met"]);
export const pitstopKind = z.enum(["learn", "prove"]);

export const rideTask = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(120),
  detail: z.string().max(120),
  minutes: z.number().int().min(1).max(240),
  done: z.boolean(),
  /** A task that unlocks later in the day, such as the signal check. */
  locked: z.boolean().default(false),
});

export const ride = z.object({
  pitstop: z.number().int().min(1),
  pitstopCount: z.number().int().min(1),
  goalName: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  summary: z.string().max(300),
  tasks: z.array(rideTask).min(1).max(3),
  /** Prep tasks for this pitstop this week, including today's. */
  weekTasksDone: z.number().int().min(0),
  weekTasksTotal: z.number().int().min(1),
});

/** Monday to Sunday of this week: whether the day was a ride (one task ticked) and which day is today. */
export const rideWeek = z.array(z.object({ label: z.string().length(1), rode: z.boolean(), today: z.boolean() })).length(7);

export const streak = z.object({
  /** Days ridden in a row; a missed day pauses the count and never resets it. 0 before the first ride. */
  days: z.number().int().min(0),
  todayCounted: z.boolean(),
});

export const departure = z.object({
  id: z.string().min(1).max(60),
  role: z.string().min(1).max(60),
  where: z.string().max(60),
  /** Required gaps left; 0 is "Boarding now". */
  gapsLeft: z.number().int().min(0),
  gaps: z.array(z.object({ status: goalStatus.exclude(["met"]), name: z.string().min(1).max(60) })).max(10),
  note: z.string().max(200),
});

export const goalPitstop = z.object({
  number: z.number().int().min(1),
  kind: pitstopKind,
  title: z.string().min(1).max(120),
  note: z.string().max(60),
  state: z.enum(["done", "now", "ahead"]),
});

export const goal = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  status: goalStatus,
  /** Why: quotes the resume line when there is one. */
  evidence: z.string().max(300),
  quote: z.string().max(200).nullable(),
  pitstops: z.array(goalPitstop).max(6),
  suggestion: z.object({ title: z.string().max(80), detail: z.string().max(200) }).nullable(),
});

export const goalsSummary = z.object({
  track: z.string().min(1).max(60),
  goals: z.array(goal).max(20),
  moreCount: z.number().int().min(0),
  metThisMonth: z.array(z.string().max(80)).max(10),
});

export type UserState = z.infer<typeof userState>;
export type GoalStatus = z.infer<typeof goalStatus>;
export type RideTask = z.infer<typeof rideTask>;
export type Ride = z.infer<typeof ride>;
export type RideWeek = z.infer<typeof rideWeek>;
export type Streak = z.infer<typeof streak>;
export type Departure = z.infer<typeof departure>;
export type Goal = z.infer<typeof goal>;
export type GoalsSummary = z.infer<typeof goalsSummary>;
