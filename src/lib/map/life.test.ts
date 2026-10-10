import { describe, expect, it } from "vitest";
import { lifeLine, type LifeLine, type Profile } from "@/lib/schemas";
import { exampleLifeLine } from "./fixtures";
import { lifeFromProfile } from "./life";
import { defaultZoom, layoutLife, readYearMonth } from "./life-layout";

const profile = (p: Partial<Profile>): Profile => ({ headline: null, totalYearsExperience: null, roles: [], skills: [], education: [], certifications: [], ...p });
const opts = { joinedAt: new Date("2026-09-01T00:00:00Z"), now: new Date("2026-10-10T00:00:00Z"), destination: "Data Analyst" };

describe("readYearMonth", () => {
  it("reads YYYY and YYYY-MM, and nothing else", () => {
    expect(readYearMonth("2024-06")).toEqual({ t: 2024 + 5 / 12, label: "Jun 2024" });
    expect(readYearMonth("2023")).toEqual({ t: 2023, label: "2023" });
    expect(readYearMonth("2024-13")).toBeNull();
    expect(readYearMonth("June 2024")).toBeNull();
    expect(readYearMonth(null)).toBeNull();
  });
});

describe("lifeFromProfile", () => {
  it("places roles by start date, education by year, and starts the journey when the first education ends", () => {
    const line = lifeFromProfile(
      profile({
        roles: [
          { title: "MIS Executive", employer: "Konkan Bank", start: "2024-06", end: null, highlights: [] },
          { title: "Intern", employer: "Ghats Logistics", start: "2024-01", end: "2024-05", highlights: [] },
        ],
        education: [{ qualification: "B.Com", institution: "Pune University", year: "2023" }],
        certifications: ["Google Data Analytics"],
      }),
      opts,
    );
    expect(lifeLine.safeParse(line).success).toBe(true);
    expect(line.moments.filter((m) => m.row === "work").map((m) => [m.name, m.date])).toEqual([
      ["Intern", "Jan 2024"],
      ["MIS Executive", "Jun 2024"],
    ]);
    expect(line.moments.find((m) => m.id === "work-0")?.detail).toBe("Since Jun 2024. Current role.");
    expect(line.moments.find((m) => m.id === "journey-start")).toMatchObject({ date: "2023", t: 2023.45 });
    expect(line.moments.find((m) => m.id === "joined")).toMatchObject({ name: "Joined CareerMetro", date: "Sep 2026" });
    // Certificates on a resume have no dates, so they wait to be placed.
    expect(line.undated).toEqual([{ row: "certificates", name: "Google Data Analytics" }]);
  });

  it("starts the journey at the first job when there is no dated education, and keeps undated lines aside", () => {
    const line = lifeFromProfile(
      profile({
        roles: [
          { title: "Analyst", employer: "Acme", start: "2019-04", end: null, highlights: [] },
          { title: "Trainee", employer: "Acme", start: null, end: null, highlights: [] },
        ],
        education: [{ qualification: "B.Sc.", institution: "Mumbai University", year: null }],
      }),
      opts,
    );
    expect(line.moments.find((m) => m.id === "journey-start")).toMatchObject({ date: "Apr 2019" });
    expect(line.undated.map((u) => u.row).sort()).toEqual(["education", "work"]);
  });

  it("never places a moment in the future", () => {
    const line = lifeFromProfile(profile({ roles: [{ title: "Lead", employer: "Acme", start: "2030-01", end: null, highlights: [] }] }), opts);
    expect(line.moments.every((m) => m.t <= line.now)).toBe(true);
  });
});

const long: LifeLine = {
  now: 2026.77,
  destination: "Head of Security",
  undated: [],
  moments: [
    { id: "s", row: "journey", t: 2011.55, date: "Jul 2011", name: "Journey started", heading: "h", detail: "", verified: false },
    ...[2011.6, 2013.5, 2015.3, 2018.2, 2021.3, 2024.2].map((t, i) => ({ id: `w${i}`, row: "work" as const, t, date: String(Math.floor(t)), name: `Role ${i}`, heading: "h", detail: "", verified: false })),
  ],
};

describe("layoutLife", () => {
  it("shows a short career whole, years left to right, Now near the right edge", () => {
    const l = layoutLife(exampleLifeLine);
    expect(defaultZoom(exampleLifeLine)).toBe("all");
    expect(l.hidden).toBeNull();
    expect(l.splitX).toBeNull();
    const xs = l.years.map((y) => y.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(l.nowX).toBeGreaterThan(xs.at(-1)!);
    expect(l.stations.every((s) => s.x >= 170 && s.x <= l.nowX)).toBe(true);
  });

  it("opens a long career at the last 5 years, with older moments behind a button", () => {
    expect(defaultZoom(long)).toBe("recent");
    const l = layoutLife(long);
    expect(l.hidden).toEqual({ count: 6, fromYear: 2011, toYear: 2021 });
    expect(l.stations.map((s) => s.id)).toEqual(["w5"]);
  });

  it("groups 3 or more older moments in a row into one numbered dot on the whole career", () => {
    const l = layoutLife(long, "all");
    expect(l.splitX).not.toBeNull();
    const group = l.stations.find((s) => s.kind === "group");
    expect(group).toMatchObject({ row: "work", label: "5 roles", years: "2011 to 2021" });
    // The last 5 years get most of the width.
    expect(l.nowX - l.splitX!).toBeGreaterThan((l.nowX - 170) * 0.6);
  });

  it("puts labels above a row, and below only when the one before is too close", () => {
    const l = layoutLife(exampleLifeLine);
    const work = l.stations.filter((s) => s.y === 250);
    expect(work.map((s) => s.above)).toEqual([true, false]);
    const interests = l.stations.filter((s) => s.y === 430);
    expect(interests.map((s) => s.above)).toEqual([true, true, true]);
  });

  it("runs the journey on, dotted, to the destination", () => {
    const l = layoutLife(exampleLifeLine);
    expect(l.ahead).not.toBeNull();
    expect(l.ahead!.to).toBeGreaterThan(l.nowX);
  });
});
