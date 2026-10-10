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
  /** Ticked by the app, not by hand: the signal check task is done when the question is answered. */
  locked: z.boolean().default(false),
});

/** The prove pitstop after this week's learn pitstop: any one option fills the gap. Only proof moves the train. */
export const provePitstop = z.object({
  pitstop: z.number().int().min(1),
  why: z.string().min(1).max(200),
  options: z
    .array(
      z.object({
        kind: z.enum(["check", "cert", "work"]),
        title: z.string().min(1).max(60),
        detail: z.string().min(1).max(200),
        action: z.string().min(1).max(30),
      }),
    )
    .min(1)
    .max(3)
    .refine((o) => new Set(o.map((x) => x.kind)).size === o.length, { message: "each way to prove appears once" }),
});

export const ride = z
  .object({
    pitstop: z.number().int().min(1),
    pitstopCount: z.number().int().min(1),
    goalName: z.string().min(1).max(80),
    title: z.string().min(1).max(160),
    /** The end of the title shown in the progress colour, like "your SIEM goal." Empty for none. */
    titleEmphasis: z.string().max(80).default(""),
    summary: z.string().max(300),
    prove: provePitstop.nullable().default(null),
    tasks: z.array(rideTask).min(1).max(3),
    /** Prep tasks for this pitstop this week, including today's. */
    weekTasksDone: z.number().int().min(0),
    weekTasksTotal: z.number().int().min(1),
  })
  .refine((r) => r.pitstop <= r.pitstopCount, {
    message: "pitstop is past the last pitstop",
    path: ["pitstop"],
  })
  .refine((r) => r.title.endsWith(r.titleEmphasis), {
    message: "the emphasis must be the end of the title",
    path: ["titleEmphasis"],
  })
  .refine((r) => !r.prove || r.prove.pitstop > r.pitstop, {
    message: "the prove pitstop comes after this pitstop",
    path: ["prove"],
  })
  .refine((r) => r.weekTasksDone <= r.weekTasksTotal, {
    message: "more tasks done than planned",
    path: ["weekTasksDone"],
  })
  .refine((r) => r.tasks.every((t, i) => !t.locked || i === r.tasks.length - 1), {
    message: "only the last task can be locked",
    path: ["tasks"],
  });

/** Monday to Sunday of this week: whether the day was a ride (one task ticked) and which day is today. */
export const rideWeek = z
  .array(
    z.object({
      label: z.string().length(1),
      rode: z.boolean(),
      today: z.boolean(),
    }),
  )
  .length(7)
  .refine((days) => days.filter((d) => d.today).length === 1, {
    message: "exactly one day is today",
  });

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
  gaps: z
    .array(
      z.object({
        status: goalStatus.exclude(["met"]),
        name: z.string().min(1).max(60),
      }),
    )
    .max(10),
  note: z.string().max(200),
});

/** One question a day from the Practice bank, for the current or next goal's skill. No score is shown. */
export const signalCheck = z
  .object({
    skillName: z.string().min(1).max(80),
    status: goalStatus.exclude(["met"]),
    question: z.string().min(10).max(400),
    options: z
      .array(
        z.object({
          key: z.enum(["A", "B", "C", "D"]),
          label: z.string().min(1).max(120),
          detail: z.string().max(60).optional(),
        }),
      )
      .min(2)
      .max(4),
    correctKey: z.enum(["A", "B", "C", "D"]),
    explanation: z.string().min(1).max(400),
    from: z.string().min(1).max(120),
  })
  .refine((c) => c.options.some((o) => o.key === c.correctKey), {
    message: "the right answer must be one of the options",
    path: ["correctKey"],
  })
  .refine((c) => c.options.every((o, i) => o.key === "ABCD"[i]), {
    message: "options are keyed A, B, C, D in order",
    path: ["options"],
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
  pitstops: z
    .array(goalPitstop)
    .max(6)
    .refine((ps) => ps.filter((p) => p.state === "now").length <= 1, {
      message: "at most one pitstop is current",
    }),
  suggestion: z.object({ title: z.string().max(80), detail: z.string().max(200) }).nullable(),
});

export const goalsSummary = z
  .object({
    track: z.string().min(1).max(60),
    goals: z.array(goal).max(20),
    moreCount: z.number().int().min(0),
    /** Names of the goals after these, when there are only a few. */
    moreNames: z.array(z.string().max(80)).max(5).default([]),
    /** A goal the role's job posts ask for that is not on the line yet. Added with one tap. */
    suggestedGoal: z.object({ name: z.string().min(1).max(80), reason: z.string().min(1).max(200) }).nullable().default(null),
    metThisMonth: z.array(z.string().max(80)).max(10),
  })
  .refine((g) => g.moreNames.length <= g.moreCount, {
    message: "more names than goals left",
    path: ["moreNames"],
  });

/** Timetable teaser on Today: the next local or online events for the user's goals. */
export const eventTeaser = z.object({
  id: z.string().min(1).max(60),
  day: z.string().min(2).max(3),
  date: z.number().int().min(1).max(31),
  title: z.string().min(1).max(100),
  detail: z.string().max(120),
});

/** People on the same goal right now. Opted-in profiles only; initials, never contact details. */
export const onYourLine = z
  .object({
    goalName: z.string().min(1).max(80),
    count: z.number().int().min(0),
    initials: z.array(z.string().min(1).max(3)).max(4),
    tip: z.object({ initials: z.string().min(1).max(3), quote: z.string().min(1).max(200), who: z.string().min(1).max(120) }).nullable(),
  })
  .refine((l) => l.initials.length <= l.count, { message: "more faces than people", path: ["initials"] });

export type UserState = z.infer<typeof userState>;
export type GoalStatus = z.infer<typeof goalStatus>;
export type RideTask = z.infer<typeof rideTask>;
export type Ride = z.infer<typeof ride>;
export type RideWeek = z.infer<typeof rideWeek>;
export type Streak = z.infer<typeof streak>;
export type Departure = z.infer<typeof departure>;
export type Goal = z.infer<typeof goal>;
export type SignalCheck = z.infer<typeof signalCheck>;
export type GoalsSummary = z.infer<typeof goalsSummary>;
export type ProvePitstop = z.infer<typeof provePitstop>;
export type EventTeaser = z.infer<typeof eventTeaser>;
export type OnYourLine = z.infer<typeof onYourLine>;
