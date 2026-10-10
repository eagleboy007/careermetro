import type { MapGoal, MapLine } from "@/lib/schemas";

/*
 * Draws the Map from the line, in plain code (handoff section 7). Coordinates are in the SVG's own units: the line runs
 * level within a group of goals and climbs 45 degrees between groups, from bottom left to top right, like the
 * prototype. Nothing here reads the database, so the design page and the server share it.
 */

export type StationState = "done" | "now" | "future";
export type PitstopKind = "learn" | "prove";

export type Station =
  | { id: "resume" | "gaps" | "practice" | "match"; kind: "end"; name: string; state: StationState; x: number; y: number; above: boolean }
  | {
      id: string;
      kind: PitstopKind;
      /** Pitstop number along the line, from 1. */
      n: number;
      goal: MapGoal;
      name: string;
      state: StationState;
      x: number;
      y: number;
      above: boolean;
    };

export type Crossing = { slug: string; title: string; station: Extract<Station, { kind: PitstopKind }>; labelAtTop: boolean };

export type Layout = {
  width: number;
  height: number;
  stations: Station[];
  /** The whole line, then the part already ridden and the dotted prep stretch toward the current pitstop. */
  track: string;
  done: string;
  prep: string;
  train: { x: number; y: number };
  crossings: Crossing[];
  gridXs: number[];
  goalCount: number;
  pitstopCount: number;
};

export const MAP_HEIGHT = 560;
const START_X = 70;
const STEP = 90;
const FIRST_STEP = 100;
const CLIMB = 80;
/** Level run before a climb: half a clipped name (about 90 units) less the height of a label above the line. */
const CLIMB_LEAD = 64;
const TOP_Y = 150;
const MAX_CLIMBS = 3;
/** Keeps the line in the same band of the map whatever the number of climbs. */
const BAND = 4;
/** How far along the stretch to the current pitstop the train has got. Ride tasks will move it (build step 6). */
const PREP_SHARE = 0.5;
/** Extra room before the current pitstop, so the train clears the labels on both sides. */
const NOW_GAP = 160;

type Pitstop = { kind: PitstopKind; goal: MapGoal; state: Exclude<StationState, "now"> };

/** Missing skills: learn then prove. Weak or outdated: prove only. Only proof is "done" for a prove pitstop. */
export function pitstopsFor(goals: MapGoal[]): Pitstop[] {
  return goals.flatMap((goal) => {
    const prove: Pitstop = { kind: "prove", goal, state: goal.proved ? "done" : "future" };
    if (goal.status !== "missing") return [prove];
    return [{ kind: "learn", goal, state: goal.learnDone || goal.proved ? "done" : "future" }, prove];
  });
}

type Point = { x: number; y: number };
type Unplaced = Station extends infer S ? (S extends Station ? Omit<S, "x" | "y" | "above"> : never) : never;

export function layoutLine(line: Pick<MapLine, "goals" | "otherLines">): Layout {
  const pitstops = pitstopsFor(line.goals);
  const goalCount = line.goals.length;
  const climbs = Math.min(MAX_CLIMBS, Math.max(0, goalCount - 1));
  // Goals where a climb starts: spread evenly, never before the first goal.
  const climbAt = new Set(Array.from({ length: climbs }, (_, i) => Math.round(((i + 1) * goalCount) / (climbs + 1))));
  const startY = TOP_Y + (CLIMB * (climbs + BAND)) / 2;

  // The first pitstop that isn't done is where the person is. With every pitstop done, it is Practice.
  const nowIndex = pitstops.findIndex((p) => p.state !== "done");

  const route: Point[] = [];
  const stationAt: number[] = [];
  const stations: Station[] = [];
  let x = START_X;
  let y = startY;
  let climbed = false;
  const place = (station: Unplaced) => {
    route.push({ x, y });
    stationAt.push(route.length - 1);
    // Labels alternate above and below. Right after a climb they go above: below, they would sit on the climb.
    const previous = stations.at(-1);
    const above = climbed || (previous ? !previous.above : false);
    stations.push({ ...station, x, y, above } as Station);
    climbed = false;
  };

  place({ id: "resume", kind: "end", name: "Resume", state: "done" });
  x += FIRST_STEP;
  place({ id: "gaps", kind: "end", name: "Gaps", state: "done" });

  let goalIndex = -1;
  pitstops.forEach((p, i) => {
    const firstOfGoal = i === 0 || pitstops[i - 1].goal !== p.goal;
    if (firstOfGoal) goalIndex += 1;
    if (firstOfGoal && climbAt.has(goalIndex)) {
      // Level, a 45 degree climb, then level again into the station. The level run before the climb is long enough
      // that a label above the station before it ends before the climb reaches it.
      route.push({ x: x + CLIMB_LEAD, y });
      route.push({ x: x + CLIMB_LEAD + CLIMB, y: y - CLIMB });
      x += CLIMB_LEAD + 20 + CLIMB;
      y -= CLIMB;
      climbed = true;
    } else {
      x += (i === 0 ? FIRST_STEP : STEP) + (i === nowIndex ? NOW_GAP : 0);
    }
    place({
      id: `${p.goal.skillId}-${p.kind}`,
      kind: p.kind,
      n: i + 1,
      goal: p.goal,
      name: p.goal.name,
      state: i === nowIndex ? "now" : p.state,
    });
  });

  x += (pitstops.length ? STEP : FIRST_STEP) + (nowIndex === -1 ? NOW_GAP : 0);
  place({ id: "practice", kind: "end", name: "Practice", state: nowIndex === -1 ? "now" : "future" });
  x += STEP - 10;
  place({ id: "match", kind: "end", name: "Match", state: "future" });

  const width = x + 50;
  const nowStation = stations.findIndex((s) => s.state === "now");
  const lastDone = nowStation - 1;
  const doneRoute = route.slice(0, stationAt[lastDone] + 1);
  const toNow = route.slice(stationAt[lastDone], stationAt[nowStation] + 1);
  const prepRoute = cut(toNow, PREP_SHARE);

  const pitstopStations = stations.filter((s): s is Extract<Station, { kind: PitstopKind }> => s.kind !== "end");
  const used = new Set<string>();
  const crossings: Crossing[] = [];
  for (const other of line.otherLines) {
    // Cross at the pitstop that fills the shared gap, one line per pitstop.
    const at = pitstopStations.filter((s) => s.goal.skillId === other.skillId && !used.has(s.id)).at(-1);
    if (!at) continue;
    used.add(at.id);
    crossings.push({ slug: other.slug, title: other.title, station: at, labelAtTop: crossings.length % 2 === 1 });
  }

  const gridXs: number[] = [];
  for (let gx = 40; gx < width - 120; gx += 80) gridXs.push(gx);

  return {
    width,
    height: MAP_HEIGHT,
    stations,
    track: d(route),
    done: d(doneRoute),
    prep: d(prepRoute),
    train: prepRoute.at(-1)!,
    crossings,
    gridXs,
    goalCount,
    pitstopCount: pitstops.length,
  };
}

const d = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${round(p.x)} ${round(p.y)}`).join(" ");
const round = (n: number) => Math.round(n * 10) / 10;

/** The first `share` of a polyline, by length. */
function cut(points: Point[], share: number): Point[] {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((a, b) => a + b, 0) * share;
  const out = [points[0]];
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (left <= lengths[i]) {
      const t = lengths[i] ? left / lengths[i] : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return out;
    }
    out.push(b);
    left -= lengths[i];
  }
  return out;
}

/** "4 · LEARN" or "5 · PROVE", with a check once done (handoff section 7). */
export function pitstopLabel(s: Extract<Station, { kind: PitstopKind }>): string {
  return `${s.n} · ${s.kind === "learn" ? "LEARN" : "PROVE"}${s.state === "done" ? " ✓" : ""}`;
}
