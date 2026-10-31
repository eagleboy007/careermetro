import { describe, expect, it } from "vitest";
import { FOLD_SHOWN, FOLD_SKILL_CHIPS, foldItems, latestYear, newestFirstByYear } from "./fold";

describe("foldItems (C23)", () => {
  const items = ["a", "b", "c", "d", "e"];

  it("shows the first three and counts the rest while folded", () => {
    expect(FOLD_SHOWN).toBe(3);
    expect(foldItems(items, false)).toEqual({ shown: ["a", "b", "c"], hidden: 2 });
  });

  it("folds a skills column only past 12 chips", () => {
    const chips = Array.from({ length: 14 }, (_, i) => `skill-${i}`);
    expect(FOLD_SKILL_CHIPS).toBe(12);
    expect(foldItems(chips.slice(0, 12), false, FOLD_SKILL_CHIPS)).toEqual({ shown: chips.slice(0, 12), hidden: 0 });
    expect(foldItems(chips, false, FOLD_SKILL_CHIPS)).toEqual({ shown: chips.slice(0, 12), hidden: 2 });
  });

  it("shows everything once opened, still counting what folds away", () => {
    expect(foldItems(items, true)).toEqual({ shown: items, hidden: 2 });
  });

  it("folds nothing at three items or fewer, so no control shows", () => {
    expect(foldItems(["a", "b", "c"], false)).toEqual({ shown: ["a", "b", "c"], hidden: 0 });
    expect(foldItems([], false)).toEqual({ shown: [], hidden: 0 });
  });

  it("never hands back the caller's array", () => {
    const short = ["a"];
    expect(foldItems(short, false).shown).not.toBe(short);
  });
});

describe("newestFirstByYear (C23)", () => {
  it("reads the latest year in free text", () => {
    expect(latestYear("2017 to 2021")).toBe(2021);
    expect(latestYear("Class of 2020")).toBe(2020);
    expect(latestYear("12345")).toBeNull();
    expect(latestYear("")).toBeNull();
    expect(latestYear(null)).toBeNull();
  });

  it("puts the latest course first, undated rows last, ties in their order", () => {
    const rows = [
      { q: "B.Com", year: "2018" },
      { q: "NPTEL course", year: null },
      { q: "MBA", year: "2020 to 2022" },
      { q: "Diploma", year: "2018" },
      { q: "Workshop", year: "ongoing" },
    ];
    expect(newestFirstByYear(rows).map((r) => r.q)).toEqual(["MBA", "B.Com", "Diploma", "NPTEL course", "Workshop"]);
  });
});
