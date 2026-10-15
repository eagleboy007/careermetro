import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { HOURS_BY_STATUS, matchProfile } from "@/lib/gaps/match";
import { matchList, MATCH_MAX_WEEKS, type Profile, type RoleProfile } from "@/lib/schemas";
import { matchListFor } from "./build";
import { exampleMatch } from "./fixtures";
import { groupMatches, matchHoursFor, weeksAway } from "./group";

const NOW = new Date("2026-10-15T00:00:00Z");

const profile = (p: Partial<Profile>): Profile => ({
  headline: null,
  totalYearsExperience: 3,
  roles: [],
  skills: [],
  education: [],
  certifications: [],
  ...p,
});

/** A skill shown in work: a bullet that says what the person did with it. */
const used = (name: string, quote: string) => ({ name, lastUsed: null, evidence: [quote] });
/** A skill only listed, with no job or project behind it. */
const listed = (name: string) => ({ name, lastUsed: null, evidence: [] });

const role = (slug: string, required: string[], extra: Partial<RoleProfile> = {}): RoleProfile => ({
  slug,
  title: slug
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" "),
  experienceBand: { minYears: 0, maxYears: 3 },
  skills: required.map((skillId) => ({ skillId, importance: "required" as const, expectation: "Uses it at work", postingShare: null })),
  groups: [],
  certifications: [],
  sources: [{ description: "Synthetic test role", url: null }],
  reviewedBy: null,
  updatedOn: "2026-10-15",
  ...extra,
});

const analyst = profile({
  roles: [
    {
      title: "MIS Executive",
      employer: "Example Co-operative Bank",
      start: "2024-06",
      end: null,
      highlights: [
        "Wrote SQL queries to match invoices with deliveries",
        "Built Excel dashboards with pivot tables for branch managers",
        "Automated the weekly report with Python scripts",
      ],
    },
  ],
  skills: [
    used("SQL", "Wrote SQL queries to match invoices with deliveries"),
    used("Excel", "Built Excel dashboards with pivot tables for branch managers"),
    used("Python", "Automated the weekly report with Python scripts"),
    listed("Tableau"),
  ],
});

const target = role("target-role", ["sql", "excel", "statistics"]); // 2 of 3
const ready = role("ready-role", ["sql", "excel", "python"]); // 3 of 3
const withListed = role("listed-role", ["sql", "excel", "tableau", "statistics"]); // 2 of 4, Tableau only listed
const far = role("far-role", ["sql", "machine-learning", "statistics", "aws", "linux"]); // 1 of 5
const none = role("none-role", ["aws", "linux"]); // 0 of 2
const roles = [target, ready, withListed, far, none];

const base = { profile: analyst, targetSlug: "target-role", resumeId: null, weeklyHours: 6 as const, roles, now: NOW };
/** The Gaps page's estimate for a role: its gaps' hours by status. */
const tableHours = (r: RoleProfile) => matchProfile(analyst, r, NOW).gaps.reduce((sum, g) => sum + HOURS_BY_STATUS[g.status as keyof typeof HOURS_BY_STATUS], 0);

describe("matchListFor", () => {
  const out = matchListFor(base);
  const bySlug = new Map(out.roles.map((r) => [r.slug, r]));

  it("reads as the schema, and tags only the target role as on your line", () => {
    expect(matchList.safeParse(out).success).toBe(true);
    expect(out.roles.filter((r) => r.onLine).map((r) => r.slug)).toEqual(["target-role"]);
  });

  it("counts required skills exactly as the matcher counts them for the Gaps page", () => {
    for (const r of out.roles) {
      const m = matchProfile(analyst, roles.find((x) => x.slug === r.slug)!, NOW);
      expect([r.met, r.required]).toEqual([m.readiness.requiredMet, m.readiness.requiredTotal]);
      expect(r.open).toEqual(m.gaps.map((g) => g.skillName));
    }
    expect(bySlug.get("ready-role")).toMatchObject({ met: 3, required: 3, open: [], hours: 0 });
    expect(bySlug.get("listed-role")?.open.sort()).toEqual(["Statistics", "Tableau"]);
  });

  it("estimates hours with the Gaps page's hours table when the path has no step for a skill", () => {
    expect(bySlug.get("target-role")?.hours).toBe(tableHours(target));
    expect(bySlug.get("listed-role")?.hours).toBe(tableHours(withListed));
  });

  it("uses the path's own step hours where it has them, and none for a step marked done, for every role with that skill", () => {
    const res = matchListFor({ ...base, pathHours: new Map([["statistics", 5]]) });
    const tableau = tableHours(withListed) - tableHours(target);
    expect(res.roles.find((r) => r.slug === "target-role")?.hours).toBe(5);
    expect(res.roles.find((r) => r.slug === "listed-role")?.hours).toBe(5 + tableau);
    const done = matchListFor({ ...base, pathHours: new Map([["statistics", 0]]) });
    // Learning done is not proof: the goal stays open with no hours left on it.
    expect(done.roles.find((r) => r.slug === "target-role")).toMatchObject({ open: ["Statistics"], hours: 0 });
  });

  it("lets proof carry over to every role: a proved skill is met, not open", () => {
    const res = matchListFor({ ...base, proved: new Set(["statistics"]) });
    expect(res.roles.find((r) => r.slug === "target-role")).toMatchObject({ met: 3, open: [], hours: 0 });
    expect(res.roles.find((r) => r.slug === "listed-role")?.open).toEqual(["Tableau"]);
  });

  it("leaves off roles the resume barely covers, as Closest to your resume does, but always keeps the target role", () => {
    expect(bySlug.has("far-role")).toBe(false);
    expect(bySlug.has("none-role")).toBe(false);
    const res = matchListFor({ ...base, targetSlug: "far-role" });
    expect(res.roles.find((r) => r.slug === "far-role")).toMatchObject({ onLine: true, met: 1, required: 5 });
  });

  it("gives each role its open jobs in Departures, none when it has none, and null when they couldn't be read", () => {
    expect(out.roles.every((r) => r.jobs === 0)).toBe(true);
    const res = matchListFor({ ...base, openJobs: new Map([["ready-role", 3]]) });
    expect(res.roles.find((r) => r.slug === "ready-role")?.jobs).toBe(3);
    expect(res.roles.find((r) => r.slug === "target-role")?.jobs).toBe(0);
    expect(matchListFor({ ...base, openJobs: null }).roles.every((r) => r.jobs === null)).toBe(true);
  });

  it("fills a 'one of these' group with proof of any of its skills, and counts the group once", () => {
    const cloud = role("cloud-role", ["sql", "excel", "aws", "azure"], { groups: [{ id: "cloud", label: "A cloud platform (AWS or Azure)" }] });
    cloud.skills = cloud.skills.map((s) => (s.skillId === "aws" || s.skillId === "azure" ? { ...s, oneOf: "cloud" } : s));
    const without = matchListFor({ ...base, roles: [target, cloud] }).roles.find((r) => r.slug === "cloud-role")!;
    expect([without.met, without.required, without.open.length]).toEqual([2, 3, 1]);
    const res = matchListFor({ ...base, roles: [target, cloud], proved: new Set(["azure"]) }).roles.find((r) => r.slug === "cloud-role")!;
    expect([res.met, res.required, res.open]).toEqual([3, 3, []]);
  });
});

describe("groupMatches", () => {
  const out = matchListFor({ ...base, openJobs: new Map() });

  it("puts roles with every required skill met or proved under Ready now, the rest under weeks", () => {
    const g = groupMatches(out.roles, 6);
    expect(g.ready.map((r) => r.slug)).toEqual(["ready-role"]);
    expect(g.soon.every((s) => s.role.open.length > 0)).toBe(true);
  });

  it("works weeks out as path hours over hours a week, rounded up, sorted by weeks, with the largest as the heading", () => {
    const g = groupMatches(out.roles, 6);
    for (const s of g.soon) expect(s.weeks).toBe(Math.max(1, Math.ceil(s.role.hours / 6)));
    expect(g.soon.map((s) => s.weeks)).toEqual([...g.soon.map((s) => s.weeks)].sort((a, b) => a - b));
    expect(g.within).toBe(Math.max(...g.soon.map((s) => s.weeks)));
  });

  it("leaves off roles more than 26 weeks away, which more hours a week can bring back", () => {
    const slow = { slug: "slow-role", title: "Slow Role", onLine: false, required: 10, met: 3, open: ["A", "B", "C", "D", "E", "F", "G"], hours: 84, jobs: 0 };
    expect(groupMatches([slow], 3)).toEqual({ ready: [], soon: [], within: null });
    expect(groupMatches([slow], 10).soon).toEqual([{ role: slow, weeks: 9 }]);
    expect(weeksAway(84, 3)).toBeGreaterThan(MATCH_MAX_WEEKS);
  });

  it("says at least a week while a goal is open, even with no hours left on it", () => {
    expect(weeksAway(0, 6)).toBe(1);
    expect(weeksAway(12, 6)).toBe(2);
    expect(weeksAway(13, 6)).toBe(3);
  });
});

describe("matchHoursFor", () => {
  it("starts from the person's own hours a week, to the nearest of 3, 6 or 10, and from 6 without one", () => {
    expect([undefined, null, 3, 5, 8, 10, 1, 20].map(matchHoursFor)).toEqual([6, 6, 3, 6, 6, 10, 3, 10]);
  });
});

describe("example data", () => {
  it("is worked out by the real code over the live role profiles, with the target on the line", () => {
    expect(matchList.safeParse(exampleMatch).success).toBe(true);
    expect(exampleMatch.roles.find((r) => r.onLine)?.slug).toBe("data-analyst");
    expect(exampleMatch.roles.every((r) => roleProfiles.some((p) => p.slug === r.slug))).toBe(true);
    const g = groupMatches(exampleMatch.roles, exampleMatch.weeklyHours);
    expect(g.ready.length + g.soon.length).toBeGreaterThan(0);
  });
});
