import { describe, expect, it } from "vitest";
import type { LevelFacts, Profile } from "@/lib/schemas";
import { levelAbove, levelIndexForYears, readLevel, scopeSignals, shownLevel, yearsFromRoles } from "./level";

const now = new Date("2026-11-18T00:00:00Z");
const none: LevelFacts = {
  yearsInThisWork: null,
  thisWork: null,
  peopleLed: null,
  peopleLedQuote: null,
  managesManagers: false,
  managesManagersQuote: null,
  budget: null,
  reportsTo: null,
  reportsToQuote: null,
  scope: null,
};
const role = (title: string, start: string | null, end: string | null): Profile["roles"][number] => ({ title, employer: "Example Pvt Ltd", start, end, highlights: [] });
const person = (years: number | null, facts: Partial<LevelFacts> | null = {}, roles: Profile["roles"] = []) => ({
  totalYearsExperience: years,
  roles,
  levelFacts: facts === null ? null : { ...none, ...facts },
});

describe("levels from years", () => {
  it("puts years on the cut points", () => {
    expect([0, 0.9, 1, 2.4, 2.5, 4.4, 4.5, 7.4, 7.5, 10.9, 11, 13.4, 13.5, 15.9, 16, 30].map(levelIndexForYears)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
  });

  it("reads a fresher as L1 and Priya's 2 years 9 months as L3, as the design shows", () => {
    expect(readLevel(person(0), now).level).toBe("L1");
    expect(readLevel(person(2.75), now)).toMatchObject({ level: "L3", basis: ["years"] });
  });

  it("counts years from the role dates when the resume states none, overlaps once", () => {
    const roles = [role("Analyst", "2023-06", null), role("Intern", "2023-01", "2023-08"), role("Trainee", "2022-01", "2022-06")];
    expect(yearsFromRoles(roles, now)).toBe(4.4);
    expect(readLevel(person(null, {}, roles), now).level).toBe("L3");
    expect(yearsFromRoles([], now)).toBeNull();
    // An older role with no end date adds nothing it may not have.
    expect(yearsFromRoles([role("Analyst", "2025-11", "2026-10"), role("Clerk", "2010", null)], now)).toBe(1);
  });

  it("reads a resume with no work and no years as L1", () => {
    expect(readLevel(person(null, null), now)).toMatchObject({ level: "L1", years: null });
  });
});

describe("a change of field", () => {
  it("drops a career changer one step at most", () => {
    expect(readLevel(person(8, { yearsInThisWork: 1 }), now)).toMatchObject({ level: "L4", basis: ["years", "this_work"] });
    expect(readLevel(person(8, { yearsInThisWork: 5 }), now)).toMatchObject({ level: "L4", basis: ["years", "this_work"] });
    expect(readLevel(person(8, { yearsInThisWork: 8 }), now)).toMatchObject({ level: "L5", basis: ["years"] });
  });
});

describe("scope", () => {
  it("moves the level up one step when a scope fact holds and the years reach the next level's typical start", () => {
    expect(readLevel(person(7, { peopleLed: 6, peopleLedQuote: "Led a team of 6" }), now)).toMatchObject({ level: "L5", basis: ["years", "scope"] });
    expect(readLevel(person(12, { managesManagers: true, budget: "Owned a ₹40 crore budget" }), now)).toMatchObject({ level: "L7", scope: ["manages_managers", "budget"] });
  });

  it("never moves it for scope the years don't reach, and never above L8", () => {
    expect(readLevel(person(3, { peopleLed: 12 }), now)).toMatchObject({ level: "L3", scope: ["people_led"], basis: ["years"] });
    expect(readLevel(person(25, { reportsTo: "CEO" }), now).level).toBe("L8");
  });

  it("reads a reporting line to the top, but not to a vice president or a manager", () => {
    expect(scopeSignals({ ...none, reportsTo: "Managing Director" })).toEqual(["reports_to_top"]);
    expect(scopeSignals({ ...none, reportsTo: "Chief Risk Officer" })).toEqual(["reports_to_top"]);
    expect(scopeSignals({ ...none, reportsTo: "Vice President, Engineering" })).toEqual([]);
    expect(scopeSignals({ ...none, reportsTo: "IT manager", peopleLed: 4 })).toEqual([]);
  });
});

describe("the title", () => {
  it("never changes the level", () => {
    const facts = { yearsInThisWork: 3 };
    const titles = ["Intern", "Chief Technology Officer", "Head of Data Science", "Senior Vice President"];
    const read = titles.map((t) => readLevel(person(3, facts, [role(t, "2023-11", null)]), now).level);
    expect(new Set(read)).toEqual(new Set(["L3"]));
  });
});

describe("the person's one step", () => {
  it("moves the shown level one step, within L1 to L8", () => {
    expect(shownLevel("L3", -1)).toBe("L2");
    expect(shownLevel("L3", 1)).toBe("L4");
    expect(shownLevel("L3", null)).toBe("L3");
    expect(shownLevel("L1", -1)).toBe("L1");
    expect(shownLevel("L8", 1)).toBe("L8");
    expect(levelAbove("L7")).toBe("L8");
    expect(levelAbove("L8")).toBeNull();
  });
});
