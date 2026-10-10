import { ride as rideSchema, type Ride, type RideTask } from "@/lib/schemas";
import { clip } from "@/lib/text";

/** One goal on the person's line, in order, with what its learn pitstop is made of. */
export type RideGoal = {
  goalId: string;
  name: string;
  status: "missing" | "weak" | "outdated";
  proved: boolean;
  /** Free courses from the path, at most two are used. */
  resources: { id: string; title: string; provider: string; kind: string; minutes: number }[];
  practice: string | null;
  /** The step was marked done on the Path page, which counts as every task ticked. */
  learnDone: boolean;
};

const MAX_COURSES = 2;
/** One sitting of a course: a ride is about 50 minutes an evening, so a long course is worked through over days. */
const SITTING_MINUTES = 25;

const hoursLabel = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 30) / 2} h`);
const OPEN_PATH = "open-path";

/** The tasks of a goal's learn pitstop. Ids stay the same from day to day, so a tick is remembered. */
function tasksOf(g: RideGoal): Omit<RideTask, "done">[] {
  const tasks: Omit<RideTask, "done">[] = g.resources.slice(0, MAX_COURSES).map((r) => ({
    id: `${g.goalId}:r:${r.id}`,
    title: clip(r.title, 120),
    detail: clip(`${r.provider} · ${r.kind}${r.minutes > SITTING_MINUTES ? ` · ${SITTING_MINUTES} min of ${hoursLabel(r.minutes)}` : ""}`, 120),
    minutes: Math.min(SITTING_MINUTES, Math.max(1, r.minutes)),
    locked: false,
  }));
  if (g.practice?.trim()) {
    tasks.push({ id: `${g.goalId}:practice`, title: clip(g.practice, 120), detail: clip(`Practice · ${g.name}`, 120), minutes: 20, locked: false });
  }
  return tasks;
}

/** Every task id the person could tick on a line, for checking a tick. */
export function taskIdsOf(goals: RideGoal[]): Set<string> {
  return new Set([OPEN_PATH, ...goals.flatMap((g) => tasksOf(g).map((t) => t.id))]);
}

/**
 * Today's ride (handoff section 5): the first goal not proved whose tasks are not all done, or, when every task is
 * done, the first goal still waiting for proof. Each goal is two pitstops, learn then prove; the train has passed the
 * pitstops of proved goals. Ticking tasks never proves a goal. Null once every goal is proved.
 */
export function buildRide(input: { goals: RideGoal[]; everDone: ReadonlySet<string>; doneThisWeek: ReadonlySet<string> }): Ride | null {
  const open = input.goals.filter((g) => !g.proved);
  if (!open.length) return null;
  const isDone = (g: RideGoal, id: string) => g.learnDone || input.everDone.has(id);
  const unfinished = open.find((g) => tasksOf(g).some((t) => !isDone(g, t.id)));
  const current = unfinished ?? open[0];
  const index = input.goals.indexOf(current);
  const pitstop = index * 2 + 1;
  const name = clip(current.name, 60);

  let tasks: RideTask[] = tasksOf(current).map((t) => ({ ...t, done: isDone(current, t.id) }));
  if (!tasks.length) {
    tasks = [
      {
        id: OPEN_PATH,
        title: clip(`Open your path for ${name}`, 120),
        detail: "Free courses picked for your gaps",
        minutes: 5,
        done: input.everDone.has(OPEN_PATH),
        locked: false,
      },
    ];
  }
  const emphasis = `your ${name} goal.`;
  const ready = !unfinished;
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
    weekTasksDone: tasks.filter((t) => input.doneThisWeek.has(t.id)).length,
    weekTasksTotal: tasks.length,
  });
}
