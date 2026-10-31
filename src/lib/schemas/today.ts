import { z } from "zod";
import { EVENT_TITLE_MAX, EVENT_URL_MAX, GOAL_CERTIFICATES_MAX, MAX_CHOICE_GOALS, USER_STATES } from "./constants";
import { trackPicker } from "./role-track";
import { goalChoice, notForMeOffer } from "./goals";
export { USER_STATES } from "./constants";

/**
 * What the signed-in Today screen shows (post-login handoff, sections 4 and 5). The server fills these; until then
 * the design page and the preview use synthetic fixtures. A goal's status is missing, weak or met: the three lamps.
 */
export const userState = z.enum(USER_STATES);

export const goalStatus = z.enum(["missing", "weak", "met"]);
export const pitstopKind = z.enum(["learn", "prove"]);

export const rideTask = z.object({
  /** Stable across days so a tick is remembered: "<goal id>:r:<resource id>" or "<goal id>:practice". */
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(120),
  detail: z.string().max(120),
  minutes: z.number().int().min(1).max(240),
  done: z.boolean(),
  /** Can't be ticked by hand: the signal check task, a task that links to where it is done, or one done on an earlier day. */
  locked: z.boolean().default(false),
  /** The signal check task: locked, and done when the question is answered. */
  signal: z.boolean().default(false),
  /** A page in the app where the task is done, for a task that can't be ticked by hand. */
  href: z
    .string()
    .max(200)
    .regex(/^\/(?![\/\\])/, "a path inside the app")
    .nullable()
    .default(null),
  /**
   * Set only on an event prep task (Timetable, docs/plans/timetable-plan.md section 4): the organiser's https page. The
   * task shows on the event's India day only and is optional: ticking it makes a ride day, but it never moves the
   * train, the week's ring or a gap. Id "event:<event id>".
   */
  eventUrl: z.string().max(EVENT_URL_MAX).pipe(z.url({ protocol: /^https$/ })).optional(),
});

/** The prove pitstop after this week's learn pitstop: any one option fills the gap. Only proof moves the train. */
export const provePitstop = z.object({
  pitstop: z.number().int().min(1),
  /** The person's goal this pitstop proves. Null on example data, where nothing can be saved. */
  goalId: z.string().min(1).max(60).nullable().default(null),
  /** Certificates on our list that fill this goal (dev/proof-plan.md). Empty when none does. */
  certificates: z
    .array(z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120), issuer: z.string().min(1).max(80), lifetime: z.literal(true).optional() }))
    .max(GOAL_CERTIFICATES_MAX)
    .default([]),
  /** The goal's certificate expired, so it needs a current one to fill the gap again. */
  renew: z.boolean().default(false),
  /** A certificate for this goal was rejected after review (FR-44): say it couldn't be confirmed, and point to Grievances. */
  notConfirmed: z.boolean().default(false),
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
  // One past the last pitstop means every goal is proved and the train is heading to Practice and Match.
  .refine((r) => r.pitstop <= r.pitstopCount + 1, {
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
  .refine((r) => r.tasks.every((t, i) => (!t.signal || (t.locked && i === r.tasks.length - 1))), {
    message: "the signal check task is locked and comes last",
    path: ["tasks"],
  })
  .refine((r) => r.tasks.filter((t) => t.eventUrl).length <= 1 && r.tasks.every((t) => !t.eventUrl || (!t.signal && !t.locked && t.href === null && t.id.startsWith("event:"))), {
    message: "at most one event task, which can be ticked by hand and links only to its source",
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

const signalKey = z.enum(["A", "B", "C", "D"]);

/** What the card shows of a question before it is answered. */
const signalShown = z.object({
  skillName: z.string().min(1).max(80),
  status: goalStatus.exclude(["met"]),
  question: z.string().min(10).max(400),
  options: z
    .array(
      z.object({
        key: signalKey,
        label: z.string().min(1).max(120),
        detail: z.string().max(60).optional(),
      }),
    )
    .min(2)
    .max(4),
  from: z.string().min(1).max(120),
});

const keyedInOrder = (c: { options: { key: string }[] }) => c.options.every((o, i) => o.key === "ABCD"[i]);

/** The right answer and why, sent to a live card only once the person has answered (checked on the server). */
export const signalAnswer = z.object({
  correctKey: signalKey,
  explanation: z.string().min(1).max(400),
});

/** One question a day from the Practice bank, for the current or next goal's skill. No score is shown. Example data. */
export const signalCheck = signalShown
  .extend(signalAnswer.shape)
  .refine((c) => c.options.some((o) => o.key === c.correctKey), {
    message: "the right answer must be one of the options",
    path: ["correctKey"],
  })
  .refine(keyedInOrder, {
    message: "options are keyed A, B, C, D in order",
    path: ["options"],
  });

/**
 * A live signal check for a signed-in person (docs/plans/departures-live-plan.md): the bank question's id and what the
 * card shows, without the answer, which stays on the server until the person answers. `answer` is set when it was
 * answered earlier today.
 */
export const signalLive = z.object({
  /** The bank question's id (mock-bank.json). */
  id: z.string().min(1).max(80),
  shown: signalShown.refine(keyedInOrder, { message: "options are keyed A, B, C, D in order", path: ["options"] }),
  answer: signalAnswer.nullable(),
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
  /** A "Your choice" goal the person added, with the company of the job check it came from. Null for gap goals. */
  choice: goalChoice.nullable().optional(),
  /** What "Not for me" offers on this goal from a gap (FR-48); absent in example data and on "Your choice" goals. */
  notForMe: notForMeOffer.nullable().optional(),
});

export const goalsSummary = z
  .object({
    track: z.string().min(1).max(60),
    goals: z.array(goal).max(20),
    /**
     * "Your choice" goals, shown apart from the line's goals: they have their own learn and prove pitstops (numbered
     * on their own spur) and never move the train, the ride or arrival.
     */
    choiceGoals: z
      .array(goal)
      .max(MAX_CHOICE_GOALS)
      .refine((goals) => goals.every((g) => g.choice && g.pitstops.every((p) => p.state !== "now")), { message: "Your choice goals are tagged and never where the train is" })
      .optional(),
    moreCount: z.number().int().min(0),
    /** Names of the goals after these, when there are only a few. */
    moreNames: z.array(z.string().max(80)).max(5).default([]),
    /** A goal the role's job posts ask for that is not on the line yet. Added with one tap. */
    suggestedGoal: z.object({ name: z.string().min(1).max(80), reason: z.string().min(1).max(200) }).nullable().default(null),
    metThisMonth: z.array(z.string().max(80)).max(10),
    /**
     * The Track picker behind the Track chip (docs/plans/tracks-plan.md). Absent when the role offers no tracks on this
     * deployment (production, until the tracks are reviewed): the chip is then plain text.
     */
    picker: trackPicker.nullable().optional(),
  })
  .refine((g) => g.moreNames.length <= g.moreCount, {
    message: "more names than goals left",
    path: ["moreNames"],
  });

/**
 * Timetable teaser on Today: the next two live events that match the person's goals or interests (teaserRows in
 * src/lib/timetable/view.ts). The title is the card's, clipped like job titles.
 */
export const eventTeaser = z.object({
  id: z.string().min(1).max(60),
  day: z.string().min(2).max(3),
  date: z.number().int().min(1).max(31),
  title: z.string().min(1).max(EVENT_TITLE_MAX),
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
export type SignalShown = z.infer<typeof signalShown>;
export type SignalAnswer = z.infer<typeof signalAnswer>;
export type SignalLive = z.infer<typeof signalLive>;
/**
 * What answering a live signal check gives back: the right answer and why, or why not. "stale": the day's question
 * changed since the page loaded (a new day, or a goal proved or skipped); "limit": too many tries today.
 */
export type SignalAnswerResult = { ok: true; answer: SignalAnswer } | { ok: false; reason: "stale" | "limit" | "invalid" };
export type GoalsSummary = z.infer<typeof goalsSummary>;
export type ProvePitstop = z.infer<typeof provePitstop>;
export type EventTeaser = z.infer<typeof eventTeaser>;
export type OnYourLine = z.infer<typeof onYourLine>;

/** What the first sign-up hero counts from the person's own gap analysis. */
export type FirstTally = { skillsFound: number; gaps: number; goals: number; boardable: number };
