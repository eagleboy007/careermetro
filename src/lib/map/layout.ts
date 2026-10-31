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

/** Another role's line crossing at a pitstop. `nearby`: a Nearby line, drawn as an interchange station. */
export type Crossing = { slug: string; title: string; station: Extract<Station, { kind: PitstopKind }>; labelAtTop: boolean; nearby: boolean };

/**
 * A spur off the line (handoff section 7): the pitstops the person added on one goal (FR-58), drawn as one dashed
 * branch with a dot labelled ADDED BY YOU. It hangs off the goal's first pitstop, on the side away from its label. It
 * is never numbered, never holds the train and never counts in `pitstopCount`.
 */
export type Spur = {
  id: string;
  goal: MapGoal;
  /** The pitstop the spur leaves the line at. */
  from: { x: number; y: number };
  x: number;
  y: number;
  count: number;
};

/**
 * The earlier line after a change of destination (handoff section 14, open decision 5): greyed out, it leaves the
 * line at Gaps, drops below the whole map and runs level to a closed end, with one small stop for each goal left on
 * it (at most EARLIER_STOPS_MAX). The new line branches off at Gaps as it always did. Never numbered, never holds the
 * train, never counts.
 */
export type EarlierBranch = {
  /** The branch itself, from the Gaps station. */
  d: string;
  /** Where the level run starts and ends; a short end bar closes it (C25). */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** One stop per goal left behind, labelled "Left here" and the goal's name (clipped) under it. */
  stops: { x: number; y: number; name: string }[];
  /** "{role} · earlier line · closed end", under the stops' labels. */
  label: { x: number; y: number };
};

/**
 * "Hide earlier line" (C25): the earlier line is hidden for this visit, and a short dotted stub stays at Gaps, labelled
 * "Earlier line hidden". Tapping it shows the line again. The new line doesn't move.
 */
export type EarlierStub = { d: string; label: { x: number; y: number } };

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
  spurs: Spur[];
  /** Pitstops the person added on the line's goals, all spurs together. */
  ownCount: number;
  /** The earlier line, when the person changed destination; null otherwise. */
  earlier: EarlierBranch | null;
  /** The stub left at Gaps while the earlier line is hidden; null otherwise. */
  earlierStub: EarlierStub | null;
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
/** How far a spur of the person's own pitstops runs off the line. */
const SPUR = 80;
/** The earlier line runs level this far below the map's usual height, clear of every label and crossing line. */
const EARLIER_DROP = 40;
/** The 45 degree bend into the earlier line's level run. */
const EARLIER_BEND = 40;
/** The earlier line's level run: at least long enough for its label, stretched toward this length on a wide map. */
const EARLIER_MIN = 420;
const EARLIER_MAX = 640;
/** Room for each stop's "Left here" label and goal name, so neighbours never touch. */
const EARLIER_STOP_GAP = 120;
/** Characters of a goal name under its stop (about 100 units of 11px mono). */
export const EARLIER_NAME_MAX = 14;
/** Room under the earlier line for the stops' labels and the line's name. */
const EARLIER_BELOW = 84;
/** Room under the stub's label when the earlier line is hidden. */
const STUB_BELOW = 28;
/** Small stops drawn on the earlier line; the panel lists every goal left there. */
export const EARLIER_STOPS_MAX = 8;

/** What numbering a line's pitstops needs of a goal. The Map passes its goals; Network passes a person's line (FR-49). */
export type PitstopGoal = Pick<MapGoal, "status" | "learnDone" | "proved" | "skipped">;
type Pitstop<G extends PitstopGoal = MapGoal> = { kind: PitstopKind; goal: G; state: Exclude<StationState, "now"> };

/** Missing skills: learn then prove. Weak or outdated: prove only. Only proof is "done" for a prove pitstop. */
export function pitstopsFor<G extends PitstopGoal>(goals: readonly G[]): Pitstop<G>[] {
  return goals.flatMap((goal): Pitstop<G>[] => {
    const prove: Pitstop<G> = { kind: "prove", goal, state: goal.proved ? "done" : "future" };
    if (goal.status !== "missing") return [prove];
    const learn: Pitstop<G> = { kind: "learn", goal, state: goal.learnDone || goal.proved ? "done" : "future" };
    return [learn, prove];
  });
}

/**
 * Where the person is: the first pitstop that isn't done, -1 with every pitstop done. The train passes a skipped
 * goal's pitstops (FR-48): it stays a gap, but it is no longer where the person is heading. Pitstop numbers are this
 * index plus one.
 */
export function nowPitstop<G extends PitstopGoal>(pitstops: readonly Pitstop<G>[]): number {
  return pitstops.findIndex((p) => p.state !== "done" && !p.goal.skipped);
}

type Point = { x: number; y: number };
type Unplaced = Station extends infer S ? (S extends Station ? Omit<S, "x" | "y" | "above"> : never) : never;

export function layoutLine(
  line: Pick<MapLine, "goals" | "otherLines"> & Partial<Pick<MapLine, "previous">>,
  { hideEarlier = false }: { hideEarlier?: boolean } = {},
): Layout {
  const pitstops = pitstopsFor(line.goals);
  const goalCount = line.goals.length;
  const climbs = Math.min(MAX_CLIMBS, Math.max(0, goalCount - 1));
  // Goals where a climb starts: spread evenly, never before the first goal.
  const climbAt = new Set(Array.from({ length: climbs }, (_, i) => Math.round(((i + 1) * goalCount) / (climbs + 1))));
  const startY = TOP_Y + (CLIMB * (climbs + BAND)) / 2;

  // With every pitstop done, the person is at Practice.
  const nowIndex = nowPitstop(pitstops);

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

  let width = x + 50;
  let height = MAP_HEIGHT;
  // The earlier line (handoff section 14): down from Gaps, then level under the map. The map grows to hold it.
  let earlier: EarlierBranch | null = null;
  let earlierStub: EarlierStub | null = null;
  const gaps = stations[1];
  const levelY = MAP_HEIGHT + EARLIER_DROP;
  if (line.previous && hideEarlier) {
    // Hidden for this visit: a short dotted stub down from Gaps, with its label at the earlier line's depth.
    earlierStub = { d: d([{ x: gaps.x, y: gaps.y }, { x: gaps.x, y: levelY - 8 }]), label: { x: gaps.x + 14, y: levelY + 4 } };
    height = levelY + STUB_BELOW;
  } else if (line.previous) {
    const start = { x: gaps.x + EARLIER_BEND, y: levelY };
    const n = Math.min(EARLIER_STOPS_MAX, line.previous.left.length);
    const run = Math.max(EARLIER_MIN, (n + 1) * EARLIER_STOP_GAP, Math.min(EARLIER_MAX, width - 60 - start.x));
    const end = { x: start.x + run, y: levelY };
    const stops = line.previous.left.slice(0, n).map((g, k) => ({
      x: round(start.x + ((k + 1) * run) / (n + 1)),
      y: levelY,
      name: g.name.length > EARLIER_NAME_MAX ? `${g.name.slice(0, EARLIER_NAME_MAX - 1).trimEnd()}…` : g.name,
    }));
    earlier = {
      d: d([{ x: gaps.x, y: gaps.y }, { x: gaps.x, y: levelY - EARLIER_BEND }, start, end]),
      start,
      end,
      stops,
      label: { x: start.x + 16, y: levelY + 64 },
    };
    width = Math.max(width, end.x + 50);
    height = levelY + EARLIER_BELOW;
  }
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
    crossings.push({ slug: other.slug, title: other.title, station: at, labelAtTop: crossings.length % 2 === 1, nearby: other.nearby === true });
  }

  // One spur a goal with pitstops of the person's own, off its first pitstop: down when that pitstop's label is above,
  // up when it is below, so the spur never crosses a label.
  const spurs: Spur[] = [];
  for (const goal of line.goals) {
    const count = goal.ownPitstops?.length ?? 0;
    if (!count) continue;
    const at = pitstopStations.find((s) => s.goal === goal);
    if (!at) continue;
    spurs.push({ id: `own-${goal.skillId}`, goal, from: { x: at.x, y: at.y }, x: at.x, y: at.above ? at.y + SPUR : at.y - SPUR, count });
  }

  const gridXs: number[] = [];
  for (let gx = 40; gx < width - 120; gx += 80) gridXs.push(gx);

  return {
    width,
    height,
    stations,
    track: d(route),
    done: d(doneRoute),
    prep: d(prepRoute),
    train: prepRoute.at(-1)!,
    crossings,
    gridXs,
    goalCount,
    pitstopCount: pitstops.length,
    spurs,
    ownCount: spurs.reduce((n, sp) => n + sp.count, 0),
    earlier,
    earlierStub,
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

/** "4 · LEARN" or "5 · PROVE", with a check once done (handoff section 7). A skipped goal's stops say so (T67). */
export function pitstopLabel(s: Extract<Station, { kind: PitstopKind }>): string {
  if (s.goal.skipped && s.state !== "done") return `${s.n} · SKIPPED`;
  return `${s.n} · ${s.kind === "learn" ? "LEARN" : "PROVE"}${s.state === "done" ? " ✓" : ""}`;
}
