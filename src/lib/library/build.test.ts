import { describe, expect, it } from "vitest";
import { buildRide, type RideGoal } from "@/lib/ride/build";
import { libraryView } from "@/lib/schemas";
import { buildLibrary, GOAL_RESOURCES, type CatalogRow, type LibraryInput } from "./build";

// Made-up goals and catalog rows; the ride comes from the real ride builder so "On your ride" matches Today.
const row = (id: string, skillIds: string[], extra: Partial<CatalogRow> = {}): CatalogRow => ({
  id,
  title: `Course ${id}`,
  url: `https://learn.example.test/${id}`,
  provider: "Example Learn",
  kind: "course",
  minutes: 60,
  free: true,
  skillIds,
  ...extra,
});
const res = (id: string) => ({ id, title: `Course ${id}`, provider: "Example Learn", kind: "course", minutes: 60 });
const goal = (g: Partial<RideGoal> & Pick<RideGoal, "goalId" | "skillId" | "status">): RideGoal => ({
  name: g.skillId,
  proved: false,
  resources: [],
  practice: null,
  learnDone: false,
  ...g,
});

const goals: RideGoal[] = [
  goal({ goalId: "g1", skillId: "power-bi", name: "Power BI", status: "missing", resources: [res("c1"), res("c2"), res("c3")] }),
  goal({ goalId: "g2", skillId: "sql", status: "weak", proved: true, resources: [res("c7")] }),
  goal({ goalId: "g3", skillId: "statistics", status: "missing", skipped: true }),
  goal({ goalId: "g4", skillId: "python", name: "Python", status: "weak", resources: [res("c5")], learnDone: true }),
];
const catalog: CatalogRow[] = [
  row("c1", ["power-bi"]),
  row("c2", ["power-bi"]),
  row("c3", ["power-bi"]),
  row("c4", ["power-bi"], { minutes: 30 }),
  row("c5", ["python"]),
  row("c6", ["pandas", "no-such-skill"], { kind: "video" }),
  row("c7", ["sql"]),
  row("bad-kind", ["power-bi"], { kind: "book" }),
  row("bad-url", ["power-bi"], { url: "http://learn.example.test/x" }),
];
const ticked = new Set(["g1:r:c1"]);
const ride = buildRide({ goals, path: { href: "/resume/x/path/data-analyst", built: true }, doneBefore: ticked, doneToday: new Set(), doneThisWeek: new Set() });
const input: LibraryInput = {
  role: "Data Analyst",
  pathHref: "/resume/x/path/data-analyst",
  goals,
  learnSkill: new Map([["g4", "pandas"]]),
  catalog,
  languageByUrl: new Map([["https://learn.example.test/c6", "Hindi" as const]]),
  skillNames: new Map([
    ["power-bi", "Power BI"],
    ["pandas", "pandas"],
  ]),
  ticked,
  ride,
};

describe("buildLibrary", () => {
  const view = buildLibrary(input);

  it("makes one card per open goal in line order, numbered like the Map", () => {
    expect(libraryView.safeParse(view).success).toBe(true);
    expect(view.goals.map((g) => [g.goalId, g.learnPitstop, g.provePitstop])).toEqual([
      ["g1", 1, 2],
      // A weak goal starts at proof: no learn pitstop ("Brush up"). Proved and skipped goals keep their numbers.
      ["g4", null, 6],
    ]);
    expect(view.role).toBe("Data Analyst");
  });

  it("lists the path's courses first, then the catalog's for the skill the goal learns", () => {
    expect(view.goals[0].resourceIds).toEqual(["c1", "c2", "c3", "c4"]);
    // g4 was swapped to pandas, so its extras come from pandas.
    expect(view.goals[1].resourceIds).toEqual(["c5", "c6"]);
    expect(view.goals.every((g) => g.resourceIds.length <= GOAL_RESOURCES)).toBe(true);
  });

  it("keeps out rows the catalog can't show, and names skills, with the language from the catalog file", () => {
    const ids = view.items.map((i) => i.id);
    expect(ids).not.toContain("bad-kind");
    expect(ids).not.toContain("bad-url");
    const c6 = view.items.find((i) => i.id === "c6")!;
    expect(c6).toMatchObject({ language: "Hindi", kind: "video", skills: ["pandas", "no-such-skill"] });
    expect(view.items.find((i) => i.id === "c1")).toMatchObject({ language: "English", skills: ["Power BI"] });
  });

  it("marks today's ride courses and the goal the ride is on", () => {
    expect(view.onRide).toEqual(["c2"]);
    expect(view.goals.map((g) => g.now)).toEqual([true, false]);
  });

  it("counts only the person's own ticks as finished: ride tasks, and a learn pitstop marked done", () => {
    expect(new Set(view.finished)).toEqual(new Set(["c1", "c5"]));
    expect(view.goals.map((g) => g.learnDone)).toEqual([false, true]);
    // Both ride courses without the practice task leave the pitstop open, as on Today.
    expect(buildLibrary({ ...input, ticked: new Set(["g1:r:c1", "g1:r:c2"]) }).goals[0].learnDone).toBe(false);
    // With the practice ticked too the learn pitstop is done, which is still not proof.
    const all = buildLibrary({ ...input, ticked: new Set(["g1:r:c1", "g1:r:c2", "g1:practice"]) });
    expect(all.goals[0].learnDone).toBe(true);
  });

  it("lists the certificates that fill a goal, from our list", () => {
    expect(view.goals[0].certificates.some((c) => c.issuer === "Microsoft")).toBe(true);
  });

  it("is the catalog alone with no resume", () => {
    const none = buildLibrary({ ...input, role: null, pathHref: null, goals: [], ride: null, ticked: new Set() });
    expect(none).toMatchObject({ role: null, pathHref: null, goals: [], onRide: [], finished: [] });
    expect(none.items).toHaveLength(7);
  });

  it("adds the person's own marks, and counts an added course finished once its last ride part is ticked", () => {
    const long = row("c4", ["power-bi"], { minutes: 90 });
    const marked = buildLibrary({
      ...input,
      catalog: catalog.map((r) => (r.id === "c4" ? long : r)),
      ticked: new Set([...ticked, "res:c4:4"]),
      marks: { saved: ["c6", "gone", "c1"], ticked: ["c7"], added: ["c4", "c5", "gone"] },
    });
    expect(libraryView.safeParse(marked).success).toBe(true);
    // Saved keeps its order (newest first); a link no longer in the catalog drops out.
    expect(marked.saved).toEqual(["c6", "c1"]);
    expect(marked.ticked).toEqual(["c7"]);
    expect(marked.finished).toContain("c4");
    // Finished items aren't "on your rides" any more (c4 by its last part, c5 by the Path's tick).
    expect(marked.added).toEqual([]);
    expect(buildLibrary({ ...input, marks: { saved: [], ticked: [], added: ["c6"] } }).added).toEqual(["c6"]);
  });

  it("lists each open goal's own ride courses, which are on the rides already and can't be added", () => {
    // g1's first two (not its third), g4's one; g2 is proved and g3 skipped.
    expect(buildLibrary(input).rideCourses).toEqual(["c1", "c2", "c5"]);
  });

  it("marks an added course on today's ride as on your ride", () => {
    const withAdded = goals.map((g) => (g.goalId === "g1" ? { ...g, added: [{ ...res("c4"), minutes: 30 }] } : g));
    const today = buildRide({ goals: withAdded, path: { href: "/resume/x/path/data-analyst", built: true }, doneBefore: ticked, doneToday: new Set(), doneThisWeek: new Set() });
    const view2 = buildLibrary({ ...input, goals: withAdded, ride: today });
    expect(view2.onRide).toEqual(["c4", "c2"]);
  });
});
