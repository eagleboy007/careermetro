import { describe, expect, it } from "vitest";
import { matchHours, matchList, matchRole, type MatchRole } from "./match";

const ready: MatchRole = { slug: "data-analyst", title: "Data Analyst", onLine: true, required: 5, met: 5, open: [], hours: 0, jobs: 2 };
const soon: MatchRole = { slug: "bi-analyst", title: "BI Analyst", onLine: false, required: 6, met: 4, open: ["Power BI", "DAX"], hours: 16, jobs: null };

describe("match role", () => {
  it("takes a ready role and one with goals open", () => {
    expect(matchRole.parse(ready)).toEqual(ready);
    expect(matchRole.parse(soon)).toEqual(soon);
  });

  it("counts every required skill as met or open, and a ready role has no hours left", () => {
    expect(matchRole.safeParse({ ...soon, met: 5 }).success).toBe(false);
    expect(matchRole.safeParse({ ...ready, hours: 4 }).success).toBe(false);
    expect(matchRole.safeParse({ ...ready, required: 0, met: 0 }).success).toBe(false);
  });

  it("refuses extra fields and a bad slug", () => {
    expect(matchRole.safeParse({ ...ready, weeks: 2 }).success).toBe(false);
    expect(matchRole.safeParse({ ...ready, slug: "Data Analyst" }).success).toBe(false);
  });
});

describe("match list", () => {
  it("offers 3, 6 or 10 hours a week", () => {
    for (const h of [3, 6, 10]) expect(matchHours.parse(h)).toBe(h);
    for (const h of [0, 5, 8, 12]) expect(matchHours.safeParse(h).success).toBe(false);
  });

  it("lists a role once, with at most one on the line", () => {
    expect(matchList.parse({ resumeId: null, weeklyHours: 6, roles: [ready, soon] }).roles).toHaveLength(2);
    expect(matchList.safeParse({ resumeId: null, weeklyHours: 6, roles: [ready, ready] }).success).toBe(false);
    expect(matchList.safeParse({ resumeId: null, weeklyHours: 6, roles: [ready, { ...soon, onLine: true }] }).success).toBe(false);
    expect(matchList.safeParse({ resumeId: "not-a-uuid", weeklyHours: 6, roles: [] }).success).toBe(false);
  });
});
