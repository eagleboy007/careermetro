import { describe, expect, it } from "vitest";
import { exampleRiders } from "@/lib/map/fixtures";
import { ridersAt, ridersCount, ridersMore, shortName } from "@/lib/map/riders-text";
import { DEFAULT_SHOW_ON_MAP, pitstopRiders, pitstopRidersList, showOnMapInput } from ".";
import { PITSTOP_MIN_PEOPLE, PITSTOP_NAMES_SHOWN } from "./constants";

// On your line (C13, docs/plans/on-your-line-plan.md): "Show my pitstop on the map" and the pitstop's count.

describe("showOnMapInput", () => {
  it("is off by default and takes on or off only", () => {
    expect(DEFAULT_SHOW_ON_MAP).toBe(false);
    expect(showOnMapInput.parse(true)).toBe(true);
    expect(showOnMapInput.parse(false)).toBe(false);
    for (const bad of ["on", 1, null, undefined, {}]) expect(showOnMapInput.safeParse(bad).success).toBe(false);
  });
});

describe("pitstopRiders", () => {
  const ok = { skillId: "siem", count: 5, names: [{ name: "Ravi Example", handle: "ravi" }], more: 0 };

  it("takes a count with up to three connection names", () => {
    expect(pitstopRiders.parse(ok)).toEqual(ok);
    const three = { ...ok, count: 9, names: [ok.names[0], { name: "Asha Example", handle: null }, { name: "Neha Example", handle: "neha" }], more: 2 };
    expect(pitstopRiders.safeParse(three).success).toBe(true);
  });

  it(`refuses a count below ${PITSTOP_MIN_PEOPLE}, so a count can't point at one person`, () => {
    expect(pitstopRiders.safeParse({ ...ok, count: PITSTOP_MIN_PEOPLE - 1 }).success).toBe(false);
    expect(pitstopRiders.safeParse({ ...ok, count: 0, names: [] }).success).toBe(false);
    expect(pitstopRiders.safeParse({ ...ok, count: PITSTOP_MIN_PEOPLE }).success).toBe(true);
  });

  it(`caps names at ${PITSTOP_NAMES_SHOWN}, and never more names than people`, () => {
    const names = Array.from({ length: PITSTOP_NAMES_SHOWN + 1 }, (_, i) => ({ name: `Person ${i}`, handle: null }));
    expect(pitstopRiders.safeParse({ ...ok, count: 10, names }).success).toBe(false);
    expect(pitstopRiders.safeParse({ ...ok, count: 3, names: names.slice(0, 3), more: 1 }).success).toBe(false);
    // "and N more" only follows a full list of names.
    expect(pitstopRiders.safeParse({ ...ok, count: 6, more: 1 }).success).toBe(false);
  });

  it("checks the example data used on /design", () => {
    expect(pitstopRidersList.safeParse(exampleRiders).success).toBe(true);
  });
});

describe("the panel's words", () => {
  it("shortens names to the first word and the last word's initial", () => {
    expect(shortName("Asha Kulkarni")).toBe("Asha K.");
    expect(shortName("  ravi   kumar menon ")).toBe("ravi M.");
    expect(shortName("Priya")).toBe("Priya");
    expect(shortName("Dev (Ops)")).toBe("Dev O.");
  });

  it("says the count in words, and how many more connections", () => {
    expect(ridersCount({ count: 3 })).toBe("3 people on this pitstop");
    expect(ridersMore({ more: 0 })).toBeNull();
    expect(ridersMore({ more: 1 })).toBe("and 1 more connection");
    expect(ridersMore({ more: 4 })).toBe("and 4 more connections");
    expect(ridersAt(exampleRiders, "sql-window-functions")?.count).toBe(14);
    expect(ridersAt(exampleRiders, "no-such-skill")).toBeUndefined();
    expect(ridersAt(undefined, "sql-window-functions")).toBeUndefined();
  });
});
