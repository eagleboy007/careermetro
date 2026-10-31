import { describe, expect, it } from "vitest";
import { mapLine, type MapGoal } from "@/lib/schemas";
import { exampleMapLine, exampleSwitchedMapLine } from "./fixtures";
import { EARLIER_STOPS_MAX, layoutLine, MAP_HEIGHT, pitstopLabel, pitstopsFor } from "./layout";

const goal = (skillId: string, status: MapGoal["status"], extra: Partial<MapGoal> = {}): MapGoal => ({
  skillId,
  name: skillId,
  goalId: null,
  certificates: [],
  renew: false,
  notConfirmed: false,
  status,
  learnDone: false,
  proved: false,
  resources: [],
  practice: null,
  ...extra,
});

describe("pitstopsFor", () => {
  it("gives a missing skill learn then prove, and a weak or outdated one prove only", () => {
    const kinds = pitstopsFor([goal("a", "missing"), goal("b", "weak"), goal("c", "outdated")]).map((p) => `${p.goal.skillId}:${p.kind}`);
    expect(kinds).toEqual(["a:learn", "a:prove", "b:prove", "c:prove"]);
  });

  it("never marks a prove pitstop done without proof, however much learning is done", () => {
    const [learn, prove] = pitstopsFor([goal("a", "missing", { learnDone: true })]);
    expect(learn.state).toBe("done");
    expect(prove.state).toBe("future");
  });
});

describe("layoutLine", () => {
  it("accepts the example line", () => {
    expect(mapLine.safeParse(exampleMapLine).success).toBe(true);
  });

  it("runs Resume, Gaps, the pitstops in order, Practice, Match, left to right", () => {
    const l = layoutLine(exampleMapLine);
    expect(l.stations.map((s) => s.id)).toEqual([
      "resume",
      "gaps",
      "excel-prove",
      "sql-prove",
      "statistics-prove",
      "sql-window-functions-learn",
      "sql-window-functions-prove",
      "power-bi-learn",
      "power-bi-prove",
      "python-prove",
      "data-storytelling-prove",
      "practice",
      "match",
    ]);
    const xs = l.stations.map((s) => s.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(l.goalCount).toBe(7);
    expect(l.pitstopCount).toBe(9);
    expect(l.width).toBeGreaterThan(l.stations.at(-1)!.x);
  });

  it("puts the person at the first pitstop that isn't done, with the train on the stretch before it", () => {
    const l = layoutLine(exampleMapLine);
    const now = l.stations.filter((s) => s.state === "now");
    expect(now.map((s) => s.id)).toEqual(["sql-window-functions-learn"]);
    const before = l.stations[l.stations.indexOf(now[0]) - 1];
    expect(l.train.x).toBeGreaterThan(before.x);
    expect(l.train.x).toBeLessThan(now[0].x);
    expect(l.done.endsWith(`${before.x} ${before.y}`)).toBe(true);
  });

  it("only climbs, never drops, and stays inside the map", () => {
    const l = layoutLine(exampleMapLine);
    const ys = l.stations.map((s) => s.y);
    ys.slice(1).forEach((y, i) => expect(y).toBeLessThanOrEqual(ys[i]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...ys)).toBeLessThanOrEqual(l.height - 80);
  });

  it("puts labels above right after a climb, where below they would sit on the climb, and alternates otherwise", () => {
    const l = layoutLine(exampleMapLine);
    l.stations.forEach((s, i) => {
      if (i === 0) return expect(s.above).toBe(false);
      const prev = l.stations[i - 1];
      expect(s.above).toBe(s.y < prev.y ? true : !prev.above);
    });
  });

  it("starts each climb far enough on that a label above the station before it clears the climb", () => {
    const l = layoutLine(exampleMapLine);
    l.stations.forEach((s, i) => {
      const next = l.stations[i + 1];
      if (!next || next.y >= s.y || !s.above) return;
      // Where the climb reaches the label's baseline (28 above the line), it is past the label's half width (90).
      const climbStart = next.x - 20 - (s.y - next.y);
      expect(climbStart + 28 - s.x).toBeGreaterThanOrEqual(90);
    });
  });

  it("moves on to Practice when every pitstop is proved", () => {
    const l = layoutLine({ goals: [goal("a", "weak", { proved: true })], otherLines: [] });
    expect(l.stations.find((s) => s.state === "now")?.id).toBe("practice");
  });

  it("keeps a skipped goal on the line as a gap, and the train passes it (FR-48)", () => {
    const l = layoutLine({ goals: [goal("a", "missing", { skipped: true }), goal("b", "weak")], otherLines: [] });
    expect(l.stations.find((s) => s.state === "now")?.id).toBe("b-prove");
    expect(l.stations.some((s) => s.id === "a-prove")).toBe(true);
    const all = layoutLine({ goals: [goal("a", "weak", { skipped: true })], otherLines: [] });
    expect(all.stations.find((s) => s.state === "now")?.id).toBe("practice");
  });

  it("draws a line with no gaps straight to Practice", () => {
    const l = layoutLine({ goals: [], otherLines: [] });
    expect(l.stations.map((s) => s.id)).toEqual(["resume", "gaps", "practice", "match"]);
  });

  it("crosses other role lines at the pitstop that fills the shared gap, and alternates their labels", () => {
    const l = layoutLine(exampleMapLine);
    expect(l.crossings.map((c) => [c.slug, c.station.id, c.labelAtTop, c.nearby])).toEqual([
      ["data-scientist", "python-prove", false, true],
      ["supply-chain-analyst", "power-bi-prove", true, false],
    ]);
  });

  it("marks a Nearby line's crossing as an interchange, and an interchange never moves the train or adds a pitstop", () => {
    const base = { goals: [goal("a", "missing"), goal("b", "weak"), goal("c", "missing")], otherLines: [] };
    const plain = layoutLine(base);
    const withNearby = layoutLine({ ...base, otherLines: [{ slug: "x", title: "X", skillId: "b", nearby: true }, { slug: "y", title: "Y", skillId: "c" }] });
    expect(withNearby.crossings.map((c) => [c.slug, c.nearby])).toEqual([
      ["x", true],
      ["y", false],
    ]);
    expect(withNearby.train).toEqual(plain.train);
    expect(withNearby.stations).toEqual(plain.stations);
    expect([withNearby.pitstopCount, withNearby.goalCount, withNearby.done]).toEqual([plain.pitstopCount, plain.goalCount, plain.done]);
  });

  it("drops an other line that shares no pitstop", () => {
    const l = layoutLine({ goals: [goal("a", "weak")], otherLines: [{ slug: "x", title: "X", skillId: "zzz" }] });
    expect(l.crossings).toEqual([]);
  });

  it("labels pitstops by number and kind, with a tick once done", () => {
    const l = layoutLine(exampleMapLine);
    const labels = l.stations.flatMap((s) => (s.kind === "end" ? [] : [pitstopLabel(s)]));
    expect(labels.slice(0, 5)).toEqual(["1 · PROVE ✓", "2 · PROVE ✓", "3 · PROVE ✓", "4 · LEARN", "5 · PROVE"]);
    // A skipped goal's stops read as skipped, not as stops ahead (T67).
    const first = exampleMapLine.goals.findIndex((g) => !g.proved);
    const skipped = layoutLine({ ...exampleMapLine, goals: exampleMapLine.goals.map((g, i) => ({ ...g, skipped: i === first })) });
    expect(skipped.stations.flatMap((s) => (s.kind === "end" ? [] : [pitstopLabel(s)])).slice(3, 5)).toEqual(["4 · SKIPPED", "5 · SKIPPED"]);
  });

  it("draws a goal's own pitstops (FR-58) as one spur off its first pitstop, away from its label, never moving the train or the numbers", () => {
    const own = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, title: `Mine ${i}`, course: null }));
    const base = { goals: [goal("a", "missing"), goal("b", "weak"), goal("c", "missing")], otherLines: [] };
    const plain = layoutLine(base);
    const withOwn = layoutLine({ ...base, goals: [goal("a", "missing", { ownPitstops: own(2) }), goal("b", "weak", { ownPitstops: own(1) }), goal("c", "missing")] });
    expect(withOwn.spurs.map((sp) => [sp.id, sp.count])).toEqual([
      ["own-a", 2],
      ["own-b", 1],
    ]);
    expect(withOwn.ownCount).toBe(3);
    expect(plain.spurs).toEqual([]);
    expect(plain.ownCount).toBe(0);
    // The line, its numbers, the train and the counts stay as they were.
    expect(withOwn.stations.map((s) => [s.id, s.x, s.y, s.state])).toEqual(plain.stations.map((s) => [s.id, s.x, s.y, s.state]));
    expect([withOwn.train, withOwn.done, withOwn.pitstopCount, withOwn.goalCount]).toEqual([plain.train, plain.done, plain.pitstopCount, plain.goalCount]);
    // Off the goal's first pitstop (the learn one for a missing skill), on the side away from its label, inside the map.
    for (const sp of withOwn.spurs) {
      const at = withOwn.stations.find((s) => s.kind !== "end" && s.goal.skillId === sp.goal.skillId)!;
      expect(at.id).toBe(sp.goal.status === "missing" ? `${sp.goal.skillId}-learn` : `${sp.goal.skillId}-prove`);
      expect(sp.x).toBe(at.x);
      expect(sp.y > at.y).toBe(at.above);
      expect(sp.y).toBeGreaterThan(40);
      expect(sp.y + 30).toBeLessThan(540);
    }
  });
});

// Change of destination (handoff section 14, open decision 5; docs/plans/change-destination-plan.md).
describe("layoutLine with an earlier line", () => {
  it("draws none without a change of destination, and keeps the map's usual height", () => {
    const l = layoutLine(exampleMapLine);
    expect(l.earlier).toBeNull();
    expect(l.height).toBe(MAP_HEIGHT);
    expect(layoutLine({ ...exampleMapLine, previous: null }).earlier).toBeNull();
  });

  it("leaves the line at Gaps and runs level below every station, label and crossing line, inside the map", () => {
    const l = layoutLine(exampleSwitchedMapLine);
    const e = l.earlier!;
    const gaps = l.stations.find((s) => s.id === "gaps")!;
    expect(e.d.startsWith(`M${gaps.x} ${gaps.y}`)).toBe(true);
    // Labels sit at most 56 units below a station; crossing lines and their labels end at 540.
    for (const s of l.stations) expect(e.start.y).toBeGreaterThan(s.y + 56);
    expect(e.start.y).toBeGreaterThan(540);
    expect(e.label.y).toBeLessThan(l.height);
    expect(e.end.x + 30).toBeLessThan(l.width);
    expect(e.end.x - e.start.x).toBeGreaterThanOrEqual(420);
    expect(l.height).toBeGreaterThan(MAP_HEIGHT);
  });

  it("puts one small stop per goal left there, at most eight, between its ends", () => {
    const l = layoutLine(exampleSwitchedMapLine);
    expect(l.earlier!.stops).toHaveLength(exampleSwitchedMapLine.previous!.left.length);
    for (const st of l.earlier!.stops) expect(st.x > l.earlier!.start.x && st.x < l.earlier!.end.x).toBe(true);
    const left = Array.from({ length: 12 }, (_, i) => ({ skillId: `s${i}`, name: `S${i}`, proved: false, ownPitstops: 0 }));
    const many = layoutLine({ ...exampleMapLine, previous: { role: { slug: "x", title: "X" }, left, shared: 0 } });
    expect(many.earlier!.stops).toHaveLength(EARLIER_STOPS_MAX);
  });

  it("never moves the new line: the same stations, train, counts and crossings", () => {
    const plain = layoutLine(exampleMapLine);
    const switched = layoutLine(exampleSwitchedMapLine);
    expect(switched.stations).toEqual(plain.stations);
    expect(switched.train).toEqual(plain.train);
    expect(switched.track).toBe(plain.track);
    expect([switched.goalCount, switched.pitstopCount]).toEqual([plain.goalCount, plain.pitstopCount]);
    expect(switched.crossings).toEqual(plain.crossings);
  });

  it("widens a short line so the earlier line and its label fit", () => {
    const l = layoutLine({ goals: [], otherLines: [], previous: { role: { slug: "x", title: "X" }, left: [], shared: 0 } });
    expect(l.earlier!.end.x + 30).toBeLessThan(l.width);
  });
});
