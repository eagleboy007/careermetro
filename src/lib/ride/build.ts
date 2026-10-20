import { goalsSummary, ride as rideSchema, type Gap, type Goal, type GoalsSummary, type NotForMeOffer, type Ride, type RideTask } from "@/lib/schemas";
import { certificatesFor } from "@/lib/proofs/eligible";
import { RIDE_PART_MINUTES, RIDE_SPLIT_OVER_MINUTES } from "@/lib/schemas/constants";
import { clip } from "@/lib/text";

/** A catalog resource as a ride task is made from it. */
export type RideResource = { id: string; title: string; provider: string; kind: string; minutes: number };

/** One goal on the person's line, in order, with what its learn pitstop is made of. */
export type RideGoal = {
  goalId: string;
  skillId: string;
  name: string;
  status: "missing" | "weak" | "outdated";
  proved: boolean;
  /** The skill it learns: its own, or the one "Not for me" swapped it to (FR-48). Its own when left out. */
  learnSkillId?: string;
  /** Free courses from the path, at most two are used. */
  resources: RideResource[];
  /**
   * What the person added with Add to my rides in the Library (docs/plans/library-part-2-plan.md), oldest first: these
   * come first among the goal's tasks, one daily part at a time. Only on an open goal whose skill they teach.
   */
  added?: RideResource[];
  practice: string | null;
  /** The step was marked done on the Path page, which counts as every task ticked. */
  learnDone: boolean;
  /** Skills whose proof fills this goal: its own, or each of its "one of these" group. */
  proofSkills?: string[];
  /** Its certificate expired, so it waits for a current one. */
  renew?: boolean;
  /** A certificate for it was rejected after review (FR-44). */
  notConfirmed?: boolean;
  /** "Not for me": the person skipped it (FR-48). It stays a gap but gets no tasks, and the train passes it. */
  skipped?: boolean;
  /** What "Not for me" offers on it (FR-48), shown on Today's goal; null on "Your choice" goals. */
  notForMe?: NotForMeOffer | null;
  /**
   * Set on a "Your choice" goal, with the company of the job check it came from. Such goals are never on the ride:
   * they sit on their own spur and never move the train or arrival.
   */
  choice?: { company: string | null } | null;
};

/** The person's Path page for their current analysis, and whether a path has been built there yet. */
export type RidePath = { href: string; built: boolean };

/** Courses a learn pitstop takes from the path; the Library marks the same ones "On your ride" (FR-51). */
export const MAX_COURSES = 2;
/** One sitting of a course: a ride is about 50 minutes an evening, so a long course is worked through over days. */
const SITTING_MINUTES = 25;

/** Tasks a ride shows at once (the ride schema's limit). */
const MAX_TASKS = 3;

const hoursLabel = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 30) / 2} h`);

/** How many daily parts an added resource takes: one up to an hour, else about 25 minutes each. */
export const rideParts = (minutes: number) => (minutes > RIDE_SPLIT_OVER_MINUTES ? Math.ceil(minutes / RIDE_PART_MINUTES) : 1);

/** The ride task id of part `part` (1-based) of an added resource. Not tied to a goal, so it survives a new resume. */
export const addedTaskId = (resourceId: string, part: number) => `res:${resourceId}:${part}`;

/** The resource and part of an added task's id, or null for any other task. */
export function parseAddedTask(taskId: string): { resourceId: string; part: number } | null {
  const m = /^res:([0-9a-zA-Z-]{1,60}):(\d{1,3})$/.exec(taskId);
  return m ? { resourceId: m[1], part: Number(m[2]) } : null;
}

/**
 * The task for an added resource: its first part not ticked on an earlier day, so a long course moves on one part a
 * day and today's tick can still be taken back. None once every part was ticked.
 */
function addedTask(r: RideResource, doneBefore: ReadonlySet<string>): Omit<RideTask, "done"> | null {
  const parts = rideParts(r.minutes);
  let part = 1;
  while (part <= parts && doneBefore.has(addedTaskId(r.id, part))) part++;
  if (part > parts) return null;
  const minutes = parts > 1 ? Math.min(RIDE_PART_MINUTES, r.minutes - RIDE_PART_MINUTES * (part - 1)) : r.minutes;
  return {
    id: addedTaskId(r.id, part),
    title: clip(r.title, 120),
    detail: clip(`${r.provider} · ${r.kind}${parts > 1 ? ` · Part ${part} of ${parts}` : ""}`, 120),
    minutes: Math.min(240, Math.max(1, minutes)),
    locked: false,
    signal: false,
    href: null,
  };
}

/**
 * The tasks of a goal's learn pitstop. Ids stay the same from day to day, so a tick is remembered. Before the person
 * has a path, a goal's one task is to build it: it links to the Path page and can't be ticked by hand, because the
 * courses arrive with the path. A goal the path left out gets one self-study task.
 */
function tasksOf(g: RideGoal, path: RidePath, doneBefore: ReadonlySet<string> = new Set()): Omit<RideTask, "done">[] {
  const added = (g.added ?? []).flatMap((r) => addedTask(r, doneBefore) ?? []);
  const tasks: Omit<RideTask, "done">[] = g.resources.slice(0, MAX_COURSES).map((r) => ({
    id: `${g.goalId}:r:${r.id}`,
    title: clip(r.title, 120),
    detail: clip(`${r.provider} · ${r.kind}${r.minutes > SITTING_MINUTES ? ` · ${SITTING_MINUTES} min of ${hoursLabel(r.minutes)}` : ""}`, 120),
    minutes: Math.min(SITTING_MINUTES, Math.max(1, r.minutes)),
    locked: false,
    signal: false,
    href: null,
  }));
  if (g.practice?.trim()) {
    tasks.push({
      id: `${g.goalId}:practice`,
      title: clip(g.practice, 120),
      detail: clip(`Practice · ${g.name}`, 120),
      minutes: 20,
      locked: false,
      signal: false,
      href: null,
    });
  }
  if (tasks.length || added.length) return [...added, ...tasks];
  if (!path.built) {
    return [
      {
        id: `${g.goalId}:open-path`,
        title: "Build your path",
        detail: "Free courses for each gap arrive with it",
        minutes: 5,
        locked: true,
        signal: false,
        href: path.href,
      },
    ];
  }
  return [
    {
      id: `${g.goalId}:self-study`,
      title: clip(`Study ${g.name} on your own`, 120),
      detail: "Notes, docs or a short tutorial",
      minutes: SITTING_MINUTES,
      locked: false,
      signal: false,
      href: null,
    },
  ];
}

/** The first open goal of the line whose learn skill a resource teaches, or null. */
export const goalForAdded = (goals: RideGoal[], skillIds: readonly string[]) =>
  goals.find((g) => !g.choice && !g.proved && !g.skipped && skillIds.includes(g.learnSkillId ?? g.skillId)) ?? null;

/**
 * Puts each added resource on the first open goal of the line whose skill it teaches (the goal's own skill, or the one
 * "Not for me" swapped it to). One the goal's path already lists among its ride courses stays where it is, so it never
 * shows twice. One that teaches no open goal waits: it joins a ride once a goal for its skill is on the line.
 */
export function attachAdded(goals: RideGoal[], added: (RideResource & { skillIds: string[] })[]): void {
  for (const r of added) {
    const goal = goalForAdded(goals, r.skillIds);
    if (!goal || goal.resources.slice(0, MAX_COURSES).some((c) => c.id === r.id)) continue;
    goal.added = [...(goal.added ?? []), { id: r.id, title: r.title, provider: r.provider, kind: r.kind, minutes: r.minutes }];
  }
}

export type RideInput = {
  goals: RideGoal[];
  path: RidePath;
  /** Task ids ticked on an earlier day. */
  doneBefore: ReadonlySet<string>;
  /** Task ids ticked today. */
  doneToday: ReadonlySet<string>;
  doneThisWeek: ReadonlySet<string>;
};

/** The task that sends someone to the departures board when there is nothing left to learn or prove. */
export function boardTask(title: string): RideTask {
  return { id: "all-proved", title, detail: "See the roles you can board now", minutes: 5, done: false, locked: true, signal: false, href: "/departures" };
}

export function arrivedRide(pitstops: number, skipped = 0): Ride {
  // Skipped goals stay gaps (FR-48), so the words never claim every goal is proved.
  const done = skipped ? "Every goal you kept is proved" : "Every goal on your line is proved";
  return rideSchema.parse({
    pitstop: pitstops + 1,
    pitstopCount: pitstops,
    goalName: "Practice",
    title: `${done}.`,
    titleEmphasis: "",
    summary: skipped
      ? `Next on your line: Practice, then Match. ${skipped === 1 ? "The goal you skipped is still a gap" : `The ${skipped} goals you skipped are still gaps`}, so some roles stay amber.`
      : "Next on your line: Practice, then Match. You can pick roles to board now.",
    tasks: [boardTask(done)],
    weekTasksDone: 1,
    weekTasksTotal: 1,
  });
}

/** The goal today's ride is on, and how to read each goal's tasks. Null once every goal is proved. */
function position(input: RideInput) {
  const open = input.goals.filter((g) => !g.proved && !g.skipped);
  if (!open.length) return null;
  // The Path's done tick covers the path's tasks, not what the person added since (Add to my rides).
  const doneEarlier = (g: RideGoal, id: string) => (g.learnDone && !parseAddedTask(id)) || input.doneBefore.has(id);
  const tasksFor = (g: RideGoal) => tasksOf(g, input.path, input.doneBefore);
  const left = (g: RideGoal) => tasksFor(g).filter((t) => !doneEarlier(g, t.id));
  // Today's ticks keep a goal current until tomorrow, so they can still be taken back.
  const unfinished = open.find((g) => left(g).length > 0);
  return { current: unfinished ?? open[0], unfinished, tasksFor, left };
}

/** A goal the signal check may ask about, with the prove pitstop its question warms the person up for. */
export type SignalGoal = {
  goalId: string;
  /** The goal's own skill (the gap), as user_goals stores it. */
  skillId: string;
  /** The skill it learns: its own, or the one "Not for me" swapped it to. Questions are picked for this one. */
  learnSkillId: string;
  name: string;
  status: "missing" | "weak";
  provePitstop: number;
};

/**
 * The goals the signal check may ask about (handoff section 5): today's ride goal, then the open goal after it, in line
 * order. Empty once every goal is proved or skipped.
 */
export function signalGoals(input: RideInput): SignalGoal[] {
  const at = position(input);
  if (!at) return [];
  const open = input.goals.filter((g) => !g.proved && !g.skipped);
  const from = open.indexOf(at.current);
  return open.slice(from, from + 2).map((g) => ({
    goalId: g.goalId,
    skillId: g.skillId,
    learnSkillId: g.learnSkillId ?? g.skillId,
    name: clip(g.name, 80),
    status: g.status === "missing" ? "missing" : "weak",
    provePitstop: input.goals.indexOf(g) * 2 + 2,
  }));
}

/** The signal check task's id: one a day, so yesterday's answer never counts for today. */
export const signalTaskId = (day: string) => `signal:${day}`;

/**
 * The day's tasks with the signal check task last (locked: it ticks itself when the question is answered). A ride
 * shows three tasks, so the signal task takes the third place. Unchanged on a ride with nothing left to learn.
 */
export function withSignalTask(tasks: RideTask[], day: string, done: boolean): RideTask[] {
  if (tasks.some((t) => t.id === "all-proved")) return tasks;
  const task: RideTask = { id: signalTaskId(day), title: "Answer today's signal check", detail: "One question, just below", minutes: 2, done, locked: true, signal: true, href: null };
  return [...tasks.filter((t) => !t.signal).slice(0, MAX_TASKS - 1), task];
}

/**
 * Today's ride (handoff section 5): the first goal not proved with tasks left, or, when every task is done, the first
 * goal still waiting for proof. Tasks done on an earlier day leave the list (they are done for good); today's ticks
 * stay so they can be taken back until the day ends. A goal waiting for proof shows its tasks done and locked. Each
 * goal is two pitstops, learn then prove; the train has passed the pitstops of proved goals. Ticking tasks never
 * proves a goal. Once every goal is proved the train is at Match and the ride is one link to the roles to board; null
 * only for a line with no goals.
 */
export function buildRide(input: RideInput): Ride | null {
  const at = position(input);
  if (!at) return input.goals.length ? arrivedRide(input.goals.length * 2, input.goals.filter((g) => g.skipped && !g.proved).length) : null;
  const { current, unfinished, tasksFor, left } = at;
  const index = input.goals.indexOf(current);
  const pitstop = index * 2 + 1;
  const name = clip(current.name, 60);

  const today = left(current);
  // Every task done: show them done and fixed, waiting for proof. An earlier day's tick can't be taken back.
  // Added resources come first; a ride shows three tasks, and the rest follow once those are done.
  const tasks: RideTask[] = (
    today.length ? today.map((t) => ({ ...t, done: input.doneToday.has(t.id) })) : tasksFor(current).map((t) => ({ ...t, done: true, locked: true }))
  ).slice(0, MAX_TASKS);
  // This week's share of the pitstop: tasks of this goal ticked this week, out of those plus the ones still open.
  const weekDone = tasksFor(current).filter((t) => input.doneThisWeek.has(t.id)).length;
  const emphasis = `your ${name} goal.`;
  const ready = !unfinished && tasks.every((t) => t.done);
  const certificates = certificatesFor(current.proofSkills ?? [current.skillId]);
  return rideSchema.parse({
    pitstop,
    pitstopCount: input.goals.length * 2,
    goalName: name,
    title: `This week is about ${emphasis}`,
    titleEmphasis: emphasis,
    summary: current.renew
      ? `Your certificate for ${name} has expired. Add a current one (Pitstop ${pitstop + 1}) to fill the gap again.`
      : ready
      ? `Your tasks for ${name} are done. Prove it (Pitstop ${pitstop + 1}) to fill the gap and move the train.`
      : `Two pitstops: learn it with free courses and practice (Pitstop ${pitstop}, these tasks), then prove it (Pitstop ${pitstop + 1}) to fill the gap.`,
    prove: {
      pitstop: pitstop + 1,
      goalId: current.goalId,
      certificates,
      renew: Boolean(current.renew),
      notConfirmed: Boolean(current.notConfirmed) && !current.proved,
      why: `Pitstop ${pitstop} gets you ready. Only this pitstop fills the gap. You can prove it any time.`,
      options: [
        { kind: "check", title: "Skill check", detail: "A short check on camera, free, from the same areas as your tasks.", action: "Take it" },
        {
          kind: "cert",
          title: "Certification",
          detail: certificates.length
            ? "Add the certificate's verify link from Credly or the issuer. It must be in your name."
            : "No certificate on our list covers this skill yet. Use a skill check or work experience.",
          action: current.renew ? "Renew" : "Add certificate",
        },
        {
          kind: "work",
          title: "Work experience",
          detail: "Used it at work? Pick the role on your profile. A course or certificate on your resume has to back it, and a manager confirms it.",
          action: "Add experience",
        },
      ],
    },
    tasks,
    weekTasksDone: weekDone,
    weekTasksTotal: Math.max(1, weekDone + tasks.filter((t) => !t.done).length),
  });
}

const SHOWN_GOALS = 3;

/** Why a "Your choice" goal is on the person's goals: they added it. It is never a gap of the role. */
export const choiceEvidence = (company: string | null) =>
  `You added this goal${company ? ` for a job at ${company}` : ""}. It doesn't change your match or your gaps.`;

/**
 * Your goals on Today, from the person's own line: the next goals not proved, each with its learn and prove pitstops
 * numbered as on the ride, the gap's explanation and the resume line it quotes. The goal the ride is on shows where
 * the person is. Tracks and suggested goals come later, so the track is the role.
 */
export function buildGoalsSummary(input: RideInput & { role: string; gaps: Gap[]; chosen?: RideGoal[] }): GoalsSummary {
  const at = position(input);
  const gapBySkill = new Map(input.gaps.map((g) => [g.skillId, g]));
  const open = input.goals.filter((g) => !g.proved && !g.skipped);
  const shown = open.slice(0, SHOWN_GOALS);
  const more = open.slice(SHOWN_GOALS);
  const goals = shown.map((g): Goal => {
    const n = input.goals.indexOf(g) * 2 + 1;
    const gap = gapBySkill.get(g.skillId);
    const tasks = at?.tasksFor(g) ?? [];
    const left = at?.left(g) ?? [];
    const leftIds = new Set(left.map((t) => t.id));
    const learnDone = left.length === 0;
    const isCurrent = at?.current === g;
    const firstCourse = g.resources[0]?.title;
    return {
      id: clip(g.goalId, 60),
      name: clip(g.name, 80),
      status: g.status === "missing" ? "missing" : "weak",
      evidence: clip(gap?.explanation ?? "", 300),
      quote: gap?.resumeQuote ? clip(gap.resumeQuote, 200) : null,
      pitstops: [
        {
          number: n,
          kind: "learn",
          title: clip(firstCourse ? `Learn: ${firstCourse}` : `Learn: ${g.name}`, 120),
          note: learnDone
            ? "done"
            : `${tasks.filter((t) => !leftIds.has(t.id) || input.doneToday.has(t.id)).length} of ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`,
          state: learnDone ? "done" : isCurrent ? "now" : "ahead",
        },
        {
          number: n + 1,
          kind: "prove",
          title: "Prove: skill check, certificate or work",
          note: "fills the gap",
          state: isCurrent && learnDone ? "now" : "ahead",
        },
      ],
      suggestion: null,
      notForMe: g.notForMe ?? null,
    };
  });
  return goalsSummary.parse({
    track: clip(input.role, 60),
    goals,
    choiceGoals: (input.chosen ?? []).map((g) => choiceGoal(g, input)),
    moreCount: more.length,
    moreNames: more.length <= 5 ? more.map((g) => clip(g.name, 80)) : [],
    suggestedGoal: null,
    metThisMonth: [],
  });
}

/**
 * A "Your choice" goal on Today, apart from the line: its own two pitstops, numbered on its spur (1 learn, 2 prove).
 * The train is never on it, so no pitstop is "now". Learning is done when the path's step is marked done or every
 * task was ticked on an earlier day; proof meets it.
 */
function choiceGoal(g: RideGoal, input: RideInput): Goal {
  const tasks = tasksOf(g, input.path, input.doneBefore);
  const learnDone = g.learnDone || g.proved || tasks.every((t) => input.doneBefore.has(t.id));
  const firstCourse = g.resources[0]?.title;
  return {
    id: clip(g.goalId, 60),
    name: clip(g.name, 80),
    status: g.proved ? "met" : g.status === "missing" ? "missing" : "weak",
    evidence: clip(choiceEvidence(g.choice?.company ?? null), 300),
    quote: null,
    pitstops: [
      {
        number: 1,
        kind: "learn",
        title: clip(firstCourse ? `Learn: ${firstCourse}` : tasks[0]?.title ?? `Learn: ${g.name}`, 120),
        note: learnDone ? "done" : `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`,
        state: learnDone ? "done" : "ahead",
      },
      { number: 2, kind: "prove", title: "Prove: skill check, certificate or work", note: g.proved ? "done" : "meets this goal", state: g.proved ? "done" : "ahead" },
    ],
    suggestion: null,
    choice: { company: g.choice?.company ?? null },
  };
}
