import { describe, expect, it } from "vitest";
import { jobPost } from "@/lib/schemas";
import { exampleApplied, exampleJobs, exampleSaved } from "./fixtures";
import { citiesOf, departuresEmpty, EMPTY_SAVED, filterDepartures, initials, NO_FILTERS, readiness, startFilters } from "./filter";

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
  it("only take https postings", () => {
    const base = { ...exampleJobs[0] };
    expect(jobPost.safeParse({ ...base, applyUrl: "https://careers.example.com/1" }).success).toBe(true);
    expect(jobPost.safeParse({ ...base, applyUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(jobPost.safeParse({ ...base, applyUrl: "http://careers.example.com/1" }).success).toBe(false);
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

describe("Your places (FR-55)", () => {
  const places = (list: string[], f: Partial<typeof NO_FILTERS> = {}) =>
    filterDepartures(exampleJobs, { ...NO_FILTERS, yourPlaces: true, ...f }, saved, applied, list).map((j) => j.id);
  const india = { ...exampleJobs[0], id: "india", city: "India" };

  it("opens on Your places only when the person picked a place", () => {
    expect(startFilters(["Pune"]).yourPlaces).toBe(true);
    expect(startFilters([]).yourPlaces).toBe(false);
  });

  it("keeps roles in the person's cities, and remote roles only when Remote is picked", () => {
    expect(places(["Bengaluru", "Hyderabad"])).toEqual(["j4", "j5"]);
    expect(places(["Remote"])).toEqual(["j3", "j8"]);
    expect(places(["Remote", "Bengaluru"])).toEqual(["j3", "j4", "j8"]);
    expect(places(["Kochi"])).toEqual([]);
  });

  it("leaves out roles that name no city", () => {
    const shown = filterDepartures([...exampleJobs, india], { ...NO_FILTERS, yourPlaces: true }, saved, applied, ["Remote", "Pune"]).map((j) => j.id);
    expect(shown).not.toContain("india");
    expect(filterDepartures([india], NO_FILTERS, saved, applied, ["Pune"]).map((j) => j.id)).toEqual(["india"]);
  });

  it("filters nothing with no places, and Any city still lists every role", () => {
    expect(places([])).toEqual(exampleJobs.map((j) => j.id));
    expect(filterDepartures(exampleJobs, NO_FILTERS, saved, applied, ["Kochi"])).toHaveLength(exampleJobs.length);
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

  it("never splits an emoji or a Devanagari letter in half (server and client must render the same text)", () => {
    expect(initials("🚀📈🎯 Data")).toBe("🚀D");
    expect(initials("डेटा विश्लेषण")).toBe("डव");
    // encodeURIComponent throws on a lone surrogate.
    for (const name of ["🚀📈", "📊 🧠", "x 💡"]) expect(() => encodeURIComponent(initials(name))).not.toThrow();
  });
});

describe("an empty Departures list", () => {
  const counts = { open: 4, places: [] as string[], saved: 0, applied: 0 };
  const kind = (f: Partial<typeof NO_FILTERS>, c: Partial<typeof counts> = {}) => departuresEmpty({ ...NO_FILTERS, ...f }, { ...counts, ...c }).kind;

  it("says why, with a next step for each reason", () => {
    expect(kind({}, { open: 0 })).toBe("no_roles");
    expect(departuresEmpty(NO_FILTERS, { ...counts, open: 0 }).text).toMatch(/paste a job post below/);
    expect(kind({ yourPlaces: true }, { places: ["Pune"] })).toBe("places");
    expect(kind({ city: "Pune" })).toBe("filtered");
    expect(kind({ tab: "saved" })).toBe("no_saved");
    expect(departuresEmpty({ ...NO_FILTERS, tab: "saved" }, counts).text).toBe(EMPTY_SAVED);
    expect(kind({ tab: "applied" })).toBe("no_applied");
    expect(kind({ tab: "saved", query: "zzz" }, { saved: 2 })).toBe("filtered");
    expect(departuresEmpty({ ...NO_FILTERS, tab: "applied" }, { ...counts, applied: 1 }).text).toBe("Nothing applied matches these filters.");
  });

  it("offers Clear filters as well as every city when a search or type filter is on with your places (T110)", () => {
    const places = { places: ["Pune"] };
    expect(departuresEmpty({ ...NO_FILTERS, yourPlaces: true }, { ...counts, ...places })).toEqual({ kind: "places", text: "No roles in your places yet." });
    for (const f of [{ query: "sql" }, { workType: "Part time" as const }, { boardingOnly: true }, { city: "Pune" }]) {
      expect(departuresEmpty({ ...NO_FILTERS, yourPlaces: true, ...f }, { ...counts, ...places })).toEqual({
        kind: "places",
        text: "No roles in your places match these filters.",
        clear: true,
      });
    }
    // A blank search is no filter.
    expect(departuresEmpty({ ...NO_FILTERS, yourPlaces: true, query: "  " }, { ...counts, ...places }).clear).toBeUndefined();
  });

  it("never blames the filters when no role is open at all", () => {
    expect(kind({ yourPlaces: true, city: "Pune" }, { open: 0, places: ["Pune"] })).toBe("no_roles");
  });
});
