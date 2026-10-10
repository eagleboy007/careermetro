import { describe, expect, it } from "vitest";
import { jobPost } from "@/lib/schemas";
import { exampleApplied, exampleJobs, exampleSaved } from "./fixtures";
import { citiesOf, filterDepartures, initials, NO_FILTERS, readiness } from "./filter";

const saved = new Set(exampleSaved);
const applied = new Map(exampleApplied);
const ids = (f: Partial<typeof NO_FILTERS>) => filterDepartures(exampleJobs, { ...NO_FILTERS, ...f }, saved, applied).map((j) => j.id);

describe("example jobs", () => {
  it("are valid, and boarding now means no gaps", () => {
    for (const j of exampleJobs) {
      expect(jobPost.safeParse(j).success).toBe(true);
      expect(j.goalsBefore === 0).toBe(j.gaps.length === 0);
    }
  });
});

describe("readiness", () => {
  it("says how far away in words, never a score", () => {
    expect(readiness({ gaps: [], destination: false })).toBe("Ready now");
    expect(readiness({ gaps: [{ status: "missing", name: "SQL" }], destination: false })).toBe("One gap away");
    expect(readiness({ gaps: Array(3).fill({ status: "weak", name: "x" }), destination: false })).toBe("Three gaps away");
    expect(readiness({ gaps: Array(7).fill({ status: "weak", name: "x" }), destination: false })).toBe("7 gaps away");
    expect(readiness({ gaps: [{ status: "weak", name: "x" }], destination: true })).toBe("Your destination");
    expect(readiness({ gaps: [], destination: true })).toBe("Ready now");
  });
});

describe("filterDepartures", () => {
  it("shows every role in the listed order", () => {
    expect(ids({})).toEqual(exampleJobs.map((j) => j.id));
  });

  it("filters by city, work type and boarding now", () => {
    expect(ids({ city: "Remote" })).toEqual(["j3", "j8"]);
    expect(ids({ workType: "Part time" })).toEqual(["j7", "j9"]);
    expect(ids({ workType: "Full time", boardingOnly: true })).toEqual(["j1", "j6"]);
  });

  it("searches role, company, city and skills, every word, any case", () => {
    expect(ids({ query: "power bi" })).toEqual(["j2", "j3", "j4", "j5"]);
    expect(ids({ query: "KAVACH weekend" })).toEqual(["j9"]);
    expect(ids({ query: "  " })).toHaveLength(exampleJobs.length);
    expect(ids({ query: "nothing like this" })).toEqual([]);
  });

  it("keeps Saved and Applied to the person's own lists", () => {
    expect(ids({ tab: "saved" })).toEqual(["j4"]);
    expect(ids({ tab: "applied" })).toEqual(["j1", "j6"]);
  });
});

describe("citiesOf and initials", () => {
  it("lists cities by count with Remote last", () => {
    expect(citiesOf(exampleJobs)).toEqual(["Pune", "Bengaluru", "Hyderabad", "Remote"]);
  });
  it("takes two initials", () => {
    expect(initials("Sahyadri Fintech")).toBe("SF");
    expect(initials("Garuda")).toBe("G");
    expect(initials("  ")).toBe("?");
  });
});
