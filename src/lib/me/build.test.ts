import { describe, expect, it } from "vitest";
import { meProfile, type MapLine, type Profile } from "@/lib/schemas";
import { exampleMapLine } from "@/lib/map/fixtures";
import { duration, journeyFor, meFromProfile, worked, type MeInput } from "./build";
import { exampleMe } from "./fixtures";

const profile = (p: Partial<Profile>): Profile => ({
  headline: null,
  totalYearsExperience: null,
  roles: [],
  skills: [],
  education: [],
  certifications: [],
  ...p,
});
const input = (p: Partial<MeInput>): MeInput => ({
  name: "Asha",
  profile: null,
  analysis: null,
  line: null,
  skillName: (id) => id.toUpperCase(),
  joinedAt: new Date("2026-09-01T00:00:00Z"),
  resumeReadAt: null,
  now: new Date("2026-10-10T00:00:00Z"),
  ...p,
});

describe("duration", () => {
  it("says years and months in words", () => {
    expect(duration(2024 + 5 / 12, 2026 + 9 / 12)).toBe("2 years 4 months");
    expect(duration(2024, 2024 + 5 / 12)).toBe("5 months");
    expect(duration(2024, 2025)).toBe("1 year");
    expect(duration(2024, 2024)).toBe("Under a month");
  });
});

describe("worked", () => {
  it("counts overlapping roles once and gaps between roles not at all", () => {
    expect(
      worked([
        [2020, 2022],
        [2021, 2023],
      ]),
    ).toBe(3);
    expect(
      worked([
        [2020, 2024],
        [2021, 2022],
      ]),
    ).toBe(4);
    expect(
      worked([
        [2023, 2024],
        [2020, 2021],
      ]),
    ).toBe(2);
    expect(worked([])).toBe(0);
  });
});

describe("journeyFor", () => {
  it("before a resume, ends at adding one", () => {
    expect(journeyFor(null, { joinedAt: new Date("2026-09-01"), resumeReadAt: null, gaps: 0 }).map((s) => [s.state, s.name])).toEqual([
      ["done", "Signed up"],
      ["now", "Add your resume"],
    ]);
  });

  it("marks proved goals done, the first open goal now, folds the rest, and ends at Match", () => {
    const stops = journeyFor(exampleMapLine, { joinedAt: new Date("2026-09-02"), resumeReadAt: new Date("2026-09-02"), gaps: 4 });
    expect(stops.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done", "now", "future", "future", "future"]);
    expect(stops[5]).toMatchObject({ name: "SQL window functions goal · learn", detail: "Getting ready" });
    expect(stops.at(-2)).toMatchObject({ name: "2 more goals" });
    expect(stops.at(-1)).toMatchObject({ name: "Match", state: "future" });
  });

  it("puts Match now once every goal is proved", () => {
    const line: MapLine = { ...exampleMapLine, goals: exampleMapLine.goals.slice(0, 2).map((g) => ({ ...g, proved: true })) };
    expect(journeyFor(line, { joinedAt: new Date(), resumeReadAt: new Date(), gaps: 0 }).at(-1)).toMatchObject({ name: "Match", state: "now" });
  });
});

describe("meFromProfile", () => {
  it("lists roles newest first with the current one marked, and totals the time", () => {
    const me = meFromProfile(
      input({
        profile: profile({
          roles: [
            { title: "Intern", employer: "Ghats", start: "2024-01", end: "2024-05", highlights: [] },
            { title: "MIS Executive", employer: "Konkan", start: "2024-06", end: null, highlights: ["Built the weekly report"] },
            { title: "Trainee", employer: "Somewhere", start: null, end: null, highlights: [] },
          ],
        }),
      }),
    );
    expect(me.experience.map((e) => [e.title, e.current])).toEqual([
      ["MIS Executive", true],
      ["Intern", false],
      ["Trainee", false],
    ]);
    expect(me.experience[0].dates).toBe("Jun 2024 to now · 2 years 4 months");
    expect(me.experience[2].dates).toBe("No dates on your resume");
    expect(me.experienceTotal).toBe("2 years 8 months");
  });

  it("sorts skills into have, weak and missing without repeats", () => {
    const me = meFromProfile(
      input({
        profile: profile({
          skills: [
            { name: "excel", lastUsed: null, evidence: [] },
            { name: "Tableau", lastUsed: null, evidence: [] },
          ],
        }),
        analysis: {
          roleSlug: "data-analyst",
          gaps: [
            { skillId: "sql", skillName: "SQL", status: "missing", resumeQuote: null, requirement: "r", explanation: "e" },
            { skillId: "pbi", skillName: "Power BI", status: "outdated", resumeQuote: null, requirement: "r", explanation: "e" },
          ],
          metSkillIds: ["excel"],
          niceToHave: [],
          readiness: { headline: "h", explanation: "e", estimatedHours: 1 },
        },
      }),
    );
    expect(me.skills).toEqual({ have: ["EXCEL", "Tableau"], weak: ["Power BI"], missing: ["SQL"] });
  });

  it("never marks a resume certificate verified, and stays inside the schema for long input", () => {
    const long = "x".repeat(500);
    const me = meFromProfile(
      input({
        name: long,
        profile: profile({
          roles: Array.from({ length: 30 }, (_, i) => ({
            title: long,
            employer: long,
            start: `${2000 + (i % 20)}-01`,
            end: null,
            highlights: Array(12).fill(long),
          })),
          education: Array.from({ length: 20 }, () => ({ qualification: long, institution: long, year: long })),
          certifications: [" ", "AWS Cloud Practitioner"],
        }),
      }),
    );
    expect(me.certifications).toEqual([{ name: "AWS Cloud Practitioner", verified: false }]);
    expect(meProfile.safeParse(me).success).toBe(true);
  });

  it("has nothing to say about stories, interests or proof yet", () => {
    const me = meFromProfile(input({}));
    expect([me.stories, me.interests, me.proofs]).toEqual([[], [], []]);
    expect(me.resumeReadOn).toBeNull();
  });

  it("builds a valid example", () => {
    expect(meProfile.safeParse(exampleMe).success).toBe(true);
    expect(exampleMe.stories.some((s) => s.fromGoal)).toBe(true);
  });
});
