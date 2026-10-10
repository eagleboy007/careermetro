import { goalsSummary, ride as rideSchema, type Gap, type Goal, type GoalsSummary, type Ride, type RideTask } from "@/lib/schemas";
import { clip } from "@/lib/text";

/** One goal on the person's line, in order, with what its learn pitstop is made of. */
export type RideGoal = {
  goalId: string;
  skillId: string;
  name: string;
  status: "missing" | "weak" | "outdated";
  proved: boolean;
  /** Free courses from the path, at most two are used. */
  resources: { id: string; title: string; provider: string; kind: string; minutes: number }[];
  practice: string | null;
  /** The step was marked done on the Path page, which counts as every task ticked. */
  learnDone: boolean;
};

/** The person's Path page for their current analysis, and whether a path has been built there yet. */
export type RidePath = { href: string; built: boolean };

const MAX_COURSES = 2;
/** One sitting of a course: a ride is about 50 minutes an evening, so a long course is worked through over days. */
const SITTING_MINUTES = 25;

const hoursLabel = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 30) / 2} h`);

/**
 * The tasks of a goal's learn pitstop. Ids stay the same from day to day, so a tick is remembered. Before the person
 * has a path, a goal's one task is to build it: it links to the Path page and can't be ticked by hand, because the
 * courses arrive with the path. A goal the path left out gets one self-study task.
 */
function tasksOf(g: RideGoal, path: RidePath): Omit<RideTask, "done">[] {
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
  if (tasks.length) return tasks;
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

export type RideInput = {
  goals: RideGoal[];
  path: RidePath;
  /** Task ids ticked on an earlier day. */
  doneBefore: ReadonlySet<string>;
  /** Task ids ticked today. */
  doneToday: ReadonlySet<string>;
  doneThisWeek: ReadonlySet<string>;
};

/** The goal today's ride is on, and how to read each goal's tasks. Null once every goal is proved. */
function position(input: RideInput) {
  const open = input.goals.filter((g) => !g.proved);
  if (!open.length) return null;
  const doneEarlier = (g: RideGoal, id: string) => g.learnDone || input.doneBefore.has(id);
  const tasksFor = (g: RideGoal) => tasksOf(g, input.path);
  const left = (g: RideGoal) => tasksFor(g).filter((t) => !doneEarlier(g, t.id));
  // Today's ticks keep a goal current until tomorrow, so they can still be taken back.
  const unfinished = open.find((g) => left(g).length > 0);
  return { current: unfinished ?? open[0], unfinished, tasksFor, left };
}

/**
 * Today's ride (handoff section 5): the first goal not proved with tasks left, or, when every task is done, the first
 * goal still waiting for proof. Tasks done on an earlier day leave the list (they are done for good); today's ticks
 * stay so they can be taken back until the day ends. A goal waiting for proof shows its tasks done and locked. Each
 * goal is two pitstops, learn then prove; the train has passed the pitstops of proved goals. Ticking tasks never
 * proves a goal. Null once every goal is proved.
 */
export function buildRide(input: RideInput): Ride | null {
  const at = position(input);
  if (!at) return null;
  const { current, unfinished, tasksFor, left } = at;
  const index = input.goals.indexOf(current);
  const pitstop = index * 2 + 1;
  const name = clip(current.name, 60);

  const today = left(current);
  // Every task done: show them done and fixed, waiting for proof. An earlier day's tick can't be taken back.
  const tasks: RideTask[] = today.length
    ? today.map((t) => ({ ...t, done: input.doneToday.has(t.id) }))
    : tasksFor(current).map((t) => ({ ...t, done: true, locked: true }));
  // This week's share of the pitstop: tasks of this goal ticked this week, out of those plus the ones still open.
  const weekDone = tasksFor(current).filter((t) => input.doneThisWeek.has(t.id)).length;
  const emphasis = `your ${name} goal.`;
  const ready = !unfinished && tasks.every((t) => t.done);
  return rideSchema.parse({
    pitstop,
    pitstopCount: input.goals.length * 2,
    goalName: name,
    title: `This week is about ${emphasis}`,
    titleEmphasis: emphasis,
    summary: ready
      ? `Your tasks for ${name} are done. Prove it (Pitstop ${pitstop + 1}) to fill the gap and move the train.`
      : `Two pitstops: learn it with free courses and practice (Pitstop ${pitstop}, these tasks), then prove it (Pitstop ${pitstop + 1}) to fill the gap.`,
    prove: {
      pitstop: pitstop + 1,
      why: `Pitstop ${pitstop} gets you ready. Only this pitstop fills the gap. You can prove it any time.`,
      options: [
        { kind: "check", title: "Skill check", detail: "A short check on camera, free, from the same areas as your tasks.", action: "Take it" },
        {
          kind: "cert",
          title: "Certification",
          detail: "Add the certificate link or ID from a known issuer; we check it with the issuer.",
          action: "Add certificate",
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

/**
 * Your goals on Today, from the person's own line: the next goals not proved, each with its learn and prove pitstops
 * numbered as on the ride, the gap's explanation and the resume line it quotes. The goal the ride is on shows where
 * the person is. Tracks and suggested goals come later, so the track is the role.
 */
export function buildGoalsSummary(input: RideInput & { role: string; gaps: Gap[] }): GoalsSummary {
  const at = position(input);
  const gapBySkill = new Map(input.gaps.map((g) => [g.skillId, g]));
  const open = input.goals.filter((g) => !g.proved);
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
    };
  });
  return goalsSummary.parse({
    track: clip(input.role, 60),
    goals,
    moreCount: more.length,
    moreNames: more.length <= 5 ? more.map((g) => clip(g.name, 80)) : [],
    suggestedGoal: null,
    metThisMonth: [],
  });
}
