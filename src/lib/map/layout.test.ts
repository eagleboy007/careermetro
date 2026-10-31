import { describe, expect, it } from "vitest";
import { mapLine, type MapGoal } from "@/lib/schemas";
import { exampleMapLine } from "./fixtures";
import { layoutLine, pitstopLabel, pitstopsFor } from "./layout";

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
});
