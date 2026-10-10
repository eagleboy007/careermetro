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

/** The tasks of a goal's learn pitstop. Ids stay the same from day to day, so a tick is remembered. Before the
 * person opens a path, a goal's one task is to open it. */
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
  if (!tasks.length) {
    tasks.push({
      id: `${g.goalId}:open-path`,
      title: clip(`Open your path for ${g.name}`, 120),
      detail: "Free courses picked for your gaps",
      minutes: 5,
      locked: false,
    });
  }
  return tasks;
}

/** Every task id the person could tick on a line, for checking a tick. */
export function taskIdsOf(goals: RideGoal[]): Set<string> {
  return new Set(goals.filter((g) => !g.proved).flatMap((g) => tasksOf(g).map((t) => t.id)));
}

/**
 * Today's ride (handoff section 5): the first goal not proved with tasks left, or, when every task is done, the first
 * goal still waiting for proof. Tasks done on an earlier day leave the list (they are done for good); today's ticks
 * stay so they can be taken back. Each goal is two pitstops, learn then prove; the train has passed the pitstops of
 * proved goals. Ticking tasks never proves a goal. Null once every goal is proved.
 */
export function buildRide(input: {
  goals: RideGoal[];
  /** Task ids ticked on an earlier day. */
  doneBefore: ReadonlySet<string>;
  /** Task ids ticked today. */
  doneToday: ReadonlySet<string>;
  doneThisWeek: ReadonlySet<string>;
}): Ride | null {
  const open = input.goals.filter((g) => !g.proved);
  if (!open.length) return null;
  const doneEarlier = (g: RideGoal, id: string) => g.learnDone || input.doneBefore.has(id);
  const left = (g: RideGoal) => tasksOf(g).filter((t) => !doneEarlier(g, t.id));
  // Today's ticks keep a goal current until tomorrow, so they can still be taken back.
  const unfinished = open.find((g) => left(g).length > 0);
  const current = unfinished ?? open[0];
  const index = input.goals.indexOf(current);
  const pitstop = index * 2 + 1;
  const name = clip(current.name, 60);

  const today = left(current);
  // Every task done: show them done, waiting for proof.
  const tasks: RideTask[] = today.length
    ? today.map((t) => ({ ...t, done: input.doneToday.has(t.id) }))
    : tasksOf(current).map((t) => ({ ...t, done: true }));
  // This week's share of the pitstop: tasks of this goal ticked this week, out of those plus the ones still open.
  const weekDone = tasksOf(current).filter((t) => input.doneThisWeek.has(t.id)).length;
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
