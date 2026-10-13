import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roleProfiles, skills } from "@/content";
import { matchProfile } from "@/lib/gaps/match";
import { NEARBY_MAX, nearbyLines, type Profile, type RoleProfile } from "@/lib/schemas";
import { nearbyLinesFor } from "./build";

const NOW = new Date("2026-10-13T00:00:00Z");

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
  updatedOn: "2026-10-13",
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

const target = role("target-role", ["sql", "excel", "statistics"]);
const near = role("near-role", ["sql", "excel", "python", "statistics"]); // 3 of 4
const half = role("half-role", ["sql", "python", "machine-learning", "statistics"]); // 2 of 4
const far = role("far-role", ["sql", "machine-learning", "statistics", "aws", "linux"]); // 1 of 5
const withListed = role("listed-role", ["sql", "excel", "tableau", "statistics"]); // 2 of 4, Tableau only listed

describe("nearbyLinesFor", () => {
  const out = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles: [target, near, half, far, withListed], now: NOW });

  it("never lists the target role, and its output reads as the schema", () => {
    expect(out.lines.map((l) => l.slug)).not.toContain("target-role");
    expect(nearbyLines.safeParse(out).success).toBe(true);
  });

  it("counts shared key skills exactly as the matcher counts the role's required skills", () => {
    for (const l of out.lines) {
      const r = [near, half, withListed].find((x) => x.slug === l.slug)!;
      const m = matchProfile(analyst, r, NOW);
      expect([l.shared, l.total]).toEqual([m.readiness.requiredMet, m.readiness.requiredTotal]);
    }
    const n = out.lines.find((l) => l.slug === "near-role")!;
    expect([n.shared, n.total]).toEqual([3, 4]);
    expect(n.sharedSkills.map((s) => s.name).sort()).toEqual(["Excel", "Python", "SQL"]);
    expect(n.toAdd).toEqual([{ name: "Statistics", outdated: false }]);
  });

  it("keeps roles sharing at least half their key skills, and at least two, and drops the rest", () => {
    expect(out.lines.map((l) => l.slug)).toEqual(["near-role", "listed-role", "half-role"]);
    expect(out.lines.some((l) => l.slug === "far-role")).toBe(false);
    const one = nearbyLinesFor({
      profile: profile({ skills: [used("SQL", "Wrote SQL queries to match invoices with deliveries")] }),
      targetSlug: "target-role",
      roles: [target, role("tiny-role", ["sql", "statistics"])],
      now: NOW,
    });
    // 1 of 2 is half, but a single shared skill is not a nearby line.
    expect(one.lines).toEqual([]);
  });

  it("counts a listed-only skill as on the resume, not as shared", () => {
    const l = out.lines.find((x) => x.slug === "listed-role")!;
    expect(l.shared).toBe(2);
    expect(l.onResume).toEqual(["Tableau"]);
    expect(l.sharedSkills.map((s) => s.name)).not.toContain("Tableau");
  });

  it("orders by share, then by count, and stops at the cap", () => {
    const many = Array.from({ length: NEARBY_MAX + 2 }, (_, i) => role(`near-${String.fromCharCode(97 + i)}`, ["sql", "excel", "python", "statistics"]));
    const res = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles: [target, half, ...many], now: NOW });
    expect(res.lines).toHaveLength(NEARBY_MAX);
    expect(res.lines.map((l) => l.slug)).toEqual(many.slice(0, NEARBY_MAX).map((r) => r.slug));
  });

  it("puts roles that ask for more years than the resume shows after the ones that fit", () => {
    const senior = role("senior-role", ["sql", "excel", "python", "statistics"], { experienceBand: { minYears: 8, maxYears: 12 } });
    const res = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles: [target, senior, half], now: NOW });
    expect(res.lines.map((l) => l.slug)).toEqual(["half-role", "senior-role"]);
    expect(res.lines[1].experience).toBe("8 to 12 years");
  });

  it("lets proof carry over: a skill with current accepted proof counts as shared, by proof", () => {
    const res = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles: [target, far], proved: new Set(["machine-learning", "statistics"]), now: NOW });
    const l = res.lines.find((x) => x.slug === "far-role")!;
    expect(l.shared).toBe(3);
    expect(l.sharedSkills.filter((s) => s.byProof).map((s) => s.name).sort()).toEqual(["Machine learning", "Statistics"].sort());
    expect(nearbyLines.safeParse(res).success).toBe(true);
  });

  it("fills a 'one of these' group with proof of any of its skills, and counts the group once", () => {
    const cloud = role("cloud-role", ["sql", "aws", "azure", "linux"], {
      groups: [{ id: "cloud", label: "A cloud platform (AWS or Azure)" }],
    });
    cloud.skills = cloud.skills.map((s) => (s.skillId === "aws" || s.skillId === "azure" ? { ...s, oneOf: "cloud" } : s));
    const without = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles: [target, cloud], now: NOW });
    expect(without.lines).toEqual([]);
    expect(without.closest).toEqual({ slug: "cloud-role", title: "Cloud Role", shared: 1, total: 3 });
    const res = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles: [target, cloud], proved: new Set(["azure"]), now: NOW });
    expect(res.lines.map((l) => [l.shared, l.total])).toEqual([[2, 3]]);
  });

  it("says which role comes closest when none is near, and nothing when no role shares a skill", () => {
    const none = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles: [target, far], now: NOW });
    expect(none).toEqual({ lines: [], closest: { slug: "far-role", title: "Far Role", shared: 1, total: 5 } });
    const empty = nearbyLinesFor({ profile: profile({}), targetSlug: "target-role", roles: [target, far], now: NOW });
    expect(empty).toEqual({ lines: [], closest: null });
  });

  it("names where each line can cross the person's own line: its unshared skills that are gaps there, in line order", () => {
    const res = nearbyLinesFor({
      profile: analyst,
      targetSlug: "target-role",
      roles: [target, near, half],
      lineSkillIds: ["statistics", "machine-learning", "python"],
      now: NOW,
    });
    expect(res.lines.find((l) => l.slug === "near-role")!.crossSkillIds).toEqual(["statistics"]);
    // Python is shared with half-role, so it isn't a crossing even though it is on the line.
    expect(res.lines.find((l) => l.slug === "half-role")!.crossSkillIds).toEqual(["statistics", "machine-learning"]);
  });

  it("is plain code: the same input gives the same lines, and the inputs are left alone", () => {
    const roles = [target, near, half];
    const before = JSON.stringify([analyst, roles]);
    const a = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles, now: NOW });
    const b = nearbyLinesFor({ profile: analyst, targetSlug: "target-role", roles, now: NOW });
    expect(a).toEqual(b);
    expect(JSON.stringify([analyst, roles])).toBe(before);
  });

  it("uses only the live role profiles by default", () => {
    const res = nearbyLinesFor({ profile: analyst, targetSlug: "data-analyst", now: NOW });
    const live = new Set(roleProfiles.map((r) => r.slug));
    for (const l of res.lines) expect(live.has(l.slug)).toBe(true);
    expect(live.has("soc-analyst-l1")).toBe(false);
    expect(live.has("grc-analyst")).toBe(false);
  });
});

/**
 * The persona the end-to-end walk uploads for Nearby lines (e2e/walk.mjs), read the way e2e/mock-ai.mjs reads it. The
 * walk checks the page shows exactly these numbers.
 */
describe("the e2e walk's switcher persona", () => {
  const e = JSON.parse(readFileSync(new URL("../../../fixtures/evals/data-scientist-analyst-upskilling.json", import.meta.url), "utf8"));
  const names = new Map(skills.map((s) => [s.id, s.name]));
  const persona = profile({
    totalYearsExperience: e.expected.totalYearsExperience ?? null,
    skills: e.expected.skills.map((s: { skillId: string; quote: string }) => ({ name: names.get(s.skillId) ?? s.skillId, lastUsed: null, evidence: [s.quote] })),
  });
  it("has Data Analyst, then Senior Data Scientist (asks for more years), as Nearby lines of Data Scientist", () => {
    const res = nearbyLinesFor({ profile: persona, targetSlug: "data-scientist", now: NOW });
    expect(res.lines.map((l) => `${l.title}: ${l.shared} of ${l.total}`)).toEqual(WALK_EXPECTED);
  });
});

/** Mirrored in e2e/walk.mjs. */
const WALK_EXPECTED = ["Data Analyst: 4 of 7", "Senior Data Scientist: 5 of 7"];

/** The walk's own resume: the fixed profile e2e/mock-ai.mjs returns for fixtures/resumes/priya-sharma (mirrored here). */
describe("the e2e walk's resume", () => {
  const priya = profile({
    headline: "Data Analyst",
    totalYearsExperience: 3,
    roles: [
      {
        title: "Data Analyst",
        employer: "Example Retail Pvt Ltd",
        start: "2022-06",
        end: null,
        highlights: ["Wrote SQL queries for weekly sales reports across 40 stores", "Built Excel dashboards with pivot tables for regional managers"],
      },
      { title: "Junior Analyst", employer: "Sample Analytics LLP", start: "2021-07", end: "2022-05", highlights: ["Prepared monthly MIS reports in Excel"] },
    ],
    skills: [
      used("SQL", "Wrote SQL queries for weekly sales reports across 40 stores"),
      used("Excel", "Built Excel dashboards with pivot tables for regional managers"),
      { name: "Python", lastUsed: "2022-05", evidence: ["Used Python (pandas) to merge vendor files"] },
      listed("Power BI"),
    ],
    education: [{ qualification: "B.Com", institution: "Savitribai Phule Pune University", year: "2021" }],
    certifications: [{ name: "Google Data Analytics Professional Certificate", earned: null, expires: null }],
  });
  it("has no Nearby line of Data Analyst, and names the closest role with its counts", () => {
    expect(nearbyLinesFor({ profile: priya, targetSlug: "data-analyst", now: NOW })).toEqual({ lines: [], closest: WALK_CLOSEST });
  });
});

/** Mirrored in e2e/walk.mjs. */
const WALK_CLOSEST = { slug: "senior-data-scientist", title: "Senior Data Scientist", shared: 2, total: 7 };
