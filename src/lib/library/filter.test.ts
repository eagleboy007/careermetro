import { describe, expect, it } from "vitest";
import { libraryView } from "@/lib/schemas";
import { exampleLibrary, exampleLibraryNoResume } from "./fixtures";
import { filtersOn, goalCards, goalOf, lengthLabel, matches, moreResults, NO_FILTERS, pick, readyToProve } from "./filter";

const item = (id: string) => exampleLibrary.items.find((i) => i.id === id)!;

describe("library schema", () => {
  it("accepts the examples", () => {
    expect(libraryView.safeParse(exampleLibrary).success).toBe(true);
    expect(libraryView.safeParse(exampleLibraryNoResume).success).toBe(true);
  });

  it("refuses an id that points at nothing, an item listed twice, and a link that isn't https", () => {
    expect(libraryView.safeParse({ ...exampleLibrary, finished: ["nope"] }).success).toBe(false);
    expect(libraryView.safeParse({ ...exampleLibrary, onRide: ["nope"] }).success).toBe(false);
    expect(libraryView.safeParse({ ...exampleLibrary, items: [...exampleLibrary.items, exampleLibrary.items[0]] }).success).toBe(false);
    expect(libraryView.safeParse({ ...exampleLibrary, items: [{ ...item("r1"), url: "http://learn.microsoft.com/" }, ...exampleLibrary.items.slice(1)] }).success).toBe(false);
    expect(libraryView.safeParse({ ...exampleLibrary, pathHref: "//evil.example" }).success).toBe(false);
  });
});

describe("library filters", () => {
  it("matches every word of the search in the title, source, type or skills, ignoring case", () => {
    expect(matches(item("r1"), { ...NO_FILTERS, query: "power bi" })).toBe(true);
    expect(matches(item("r1"), { ...NO_FILTERS, query: "microsoft DOCS" })).toBe(true);
    expect(matches(item("r1"), { ...NO_FILTERS, query: "power tableau" })).toBe(false);
    expect(matches(item("r4"), { ...NO_FILTERS, query: "tableau" })).toBe(true);
  });

  it("filters by type, length and Hindi", () => {
    expect(matches(item("r1"), { ...NO_FILTERS, kind: "docs" })).toBe(true);
    expect(matches(item("r1"), { ...NO_FILTERS, kind: "video" })).toBe(false);
    expect(matches(item("r11"), { ...NO_FILTERS, under: 60 })).toBe(true);
    expect(matches(item("r1"), { ...NO_FILTERS, under: 60 })).toBe(false);
    expect(matches(item("r7"), { ...NO_FILTERS, under: 300 })).toBe(false);
    expect(matches(item("r8"), { ...NO_FILTERS, hindi: true })).toBe(true);
    expect(matches(item("r7"), { ...NO_FILTERS, hindi: true })).toBe(false);
    expect(filtersOn(NO_FILTERS)).toBe(false);
    expect(filtersOn({ ...NO_FILTERS, query: "  " })).toBe(false);
    expect(filtersOn({ ...NO_FILTERS, hindi: true })).toBe(true);
  });

  it("keeps every goal card with no filter, and drops a card with nothing left once a filter is on", () => {
    expect(goalCards(exampleLibrary, NO_FILTERS).map((c) => [c.goal.skillId, c.items.map((i) => i.id)])).toEqual([
      ["power-bi", ["r1", "r2", "r4", "r3"]],
      ["statistics", ["r5", "r6"]],
      ["python", ["r7", "r8", "r9", "r4"]],
    ]);
    const hindi = goalCards(exampleLibrary, { ...NO_FILTERS, hindi: true });
    expect(hindi.map((c) => [c.goal.skillId, c.items.map((i) => i.id)])).toEqual([["python", ["r8"]]]);
    // A goal whose name matches keeps all its resources that pass the other filters.
    expect(goalCards(exampleLibrary, { ...NO_FILTERS, query: "statistics basics" }).map((c) => c.items.length)).toEqual([2]);
  });

  it("searches the rest of the catalog only while something is typed, without repeating the cards", () => {
    expect(moreResults(exampleLibrary.items, NO_FILTERS, new Set())).toEqual([]);
    const shown = new Set(goalCards(exampleLibrary, { ...NO_FILTERS, query: "kaggle" }).flatMap((c) => c.items.map((i) => i.id)));
    expect([...shown]).toEqual(["r7"]);
    expect(moreResults(exampleLibrary.items, { ...NO_FILTERS, query: "kaggle" }, shown).map((i) => i.id)).toEqual(["r10"]);
    expect(moreResults(exampleLibrary.items, { ...NO_FILTERS, query: "microsoft" }, new Set(), 2)).toHaveLength(2);
  });

  it("picks Saved or Finished items by id in catalog order, with the filters", () => {
    expect(pick(exampleLibrary.items, new Set(["r6", "r5"]), NO_FILTERS).map((i) => i.id)).toEqual(["r5", "r6"]);
    expect(pick(exampleLibrary.items, new Set(["r6", "r5"]), { ...NO_FILTERS, kind: "docs" }).map((i) => i.id)).toEqual(["r6"]);
  });

  it("asks for proof once learning is done, never otherwise", () => {
    expect(readyToProve(exampleLibrary).map((g) => g.skillId)).toEqual(["statistics"]);
    // Every resource on a card finished counts too.
    expect(readyToProve({ ...exampleLibrary, goals: exampleLibrary.goals.map((g) => ({ ...g, learnDone: false })), finished: ["r1", "r2", "r3", "r4"] }).map((g) => g.skillId)).toEqual([
      "power-bi",
    ]);
    expect(readyToProve({ ...exampleLibrary, goals: exampleLibrary.goals.map((g) => ({ ...g, learnDone: false })), finished: [] })).toEqual([]);
  });

  it("says lengths like the prototype and finds a resource's goal", () => {
    expect([lengthLabel(20), lengthLabel(60), lengthLabel(240), lengthLabel(1140)]).toEqual(["20 min", "1 h", "4 h", "19 h"]);
    expect(lengthLabel(90)).toBe("about 2 h");
    expect(goalOf(exampleLibrary.goals, "r4")?.skillId).toBe("power-bi");
    expect(goalOf(exampleLibrary.goals, "r10")).toBeNull();
  });
});
