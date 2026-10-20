import { describe, expect, it } from "vitest";
import { meProfile, type MapLine, type Profile } from "@/lib/schemas";
import { exampleMapLine } from "@/lib/map/fixtures";
import { companyKey } from "@/lib/profile/employer";
import { duration, journeyFor, meFromProfile, NO_ADDITIONS, worked, type MeAdditions, type MeInput } from "./build";
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

  it("passes a skipped goal: it says Skipped and the next open goal is now (T60)", () => {
    const first = exampleMapLine.goals.findIndex((g) => !g.proved);
    const line: MapLine = { ...exampleMapLine, goals: exampleMapLine.goals.map((g, i) => ({ ...g, skipped: i === first })) };
    const stops = journeyFor(line, { joinedAt: new Date("2026-09-02"), resumeReadAt: new Date("2026-09-02"), gaps: 4 });
    expect(stops[5]).toMatchObject({ state: "future", detail: "Skipped" });
    expect(stops.filter((s) => s.state === "now")).toHaveLength(1);
    expect(stops[6]).toMatchObject({ state: "now" });
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
          certifications: [{ name: "Tableau", earned: null, expires: null }],
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
    expect(me.certifications.map((c) => [c.name, c.status, c.fromResume])).toEqual([["Tableau", "added", true]]);
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
          certifications: [{ name: " ", earned: null, expires: null }, { name: "AWS Cloud Practitioner", earned: null, expires: null }, { name: " aws cloud practitioner ", earned: null, expires: null }],
        }),
      }),
    );
    expect(me.certifications.map((c) => [c.name, c.status, c.issuer])).toEqual([["AWS Cloud Practitioner", "added", "Amazon Web Services"]]);
    expect(meProfile.safeParse(me).success).toBe(true);
  });

  it("shows others only the skills count until who-sees-what switches exist (T19)", () => {
    const me = meFromProfile(input({}));
    expect(me.stats.filter((s) => !s.private).map((s) => s.label)).toEqual(["skills found"]);
  });

  it("has no stories, interests or proof before the person adds any", () => {
    const me = meFromProfile(input({}));
    expect([me.stories, me.interests, me.proofs]).toEqual([[], [], []]);
    expect(me.resumeReadOn).toBeNull();
  });

  it("shows the line's Nearby lines and links to the existing role picker, and nothing before there is a line", () => {
    const nearby = { lines: [], closest: { slug: "data-engineer", title: "Data Engineer", shared: 2, total: 9 } };
    const me = meFromProfile(input({ line: { ...exampleMapLine, resumeId: "r1", nearby } }));
    expect(me.nearby).toEqual(nearby);
    expect(me.changeRoleHref).toBe("/resume/r1/role");
    const none = meFromProfile(input({}));
    expect([none.nearby, none.changeRoleHref]).toEqual([null, null]);
  });

  it("builds a valid example", () => {
    expect(meProfile.safeParse(exampleMe).success).toBe(true);
    expect(exampleMe.nearby?.lines.length).toBeGreaterThan(0);
    expect(exampleMe.stories.some((s) => s.fromGoal)).toBe(true);
  });
});

// Me editing (docs/plans/me-editing-plan.md). Every name and company here is made up.
describe("what the person added on Me", () => {
  const ids = { role: "00000000-0000-4000-8000-0000000a0101", edu: "00000000-0000-4000-8000-0000000a0102", story: "00000000-0000-4000-8000-0000000a0103", goal: "00000000-0000-4000-8000-0000000a0104" };
  const added = (p: Partial<MeAdditions>): MeAdditions => ({ ...NO_ADDITIONS, ...p });
  const resume = profile({
    roles: [{ title: "Analyst", employer: "Acme", start: "2024-01", end: null, highlights: ["Built the weekly report"] }],
    education: [{ qualification: "B.Com", institution: "Example University", year: "2021" }],
  });

  it("merges added roles with resume roles by start date, and counts overlapping spans once", () => {
    const me = meFromProfile(
      input({
        profile: resume,
        added: added({ roles: [{ id: ids.role, title: "Volunteer data lead", employer: "Pune Reads", startMonth: "2023-06", endMonth: "2024-06", isCurrent: false }] }),
      }),
    );
    expect(meProfile.safeParse(me).success).toBe(true);
    expect(me.experience.map((e) => [e.title, e.added?.id ?? null])).toEqual([
      ["Analyst", null],
      ["Volunteer data lead", ids.role],
    ]);
    expect(me.experience[1]).toMatchObject({ dates: "Jun 2023 to Jun 2024 · 1 year", current: false, highlights: [], added: { startMonth: "2023-06", endMonth: "2024-06" } });
    // Jun 2023 to now (10 Oct 2026), with Jan to Jun 2024 counted once.
    expect(me.experienceTotal).toBe("3 years 4 months");
  });

  it("gives an added current role the work-email check, as a resume one (FR-47)", () => {
    const role = { id: ids.role, title: "SOC analyst", employer: "Garuda Security", startMonth: "2025-02", endMonth: null, isCurrent: true };
    const open = meFromProfile(input({ added: added({ roles: [role] }) }));
    expect(open.experience[0]).toMatchObject({ current: true, dates: expect.stringMatching(/^Feb 2025 to now/), check: { state: "not_verified", month: null } });
    const verified = meFromProfile(
      input({
        added: added({ roles: [role] }),
        jobChecks: [{ employerKey: companyKey("Garuda Security"), startMonth: "2025-02", status: "verified", checkedAt: new Date("2026-10-01T00:00:00Z") }],
      }),
    );
    expect(verified.experience[0].check).toEqual({ state: "verified", month: "Oct 2026" });
  });

  it("badges only the job the check was made on when an added role and a resume role share company and start month (T95)", () => {
    // "CTO, Acme, 2024-01" was added first; then a resume with Analyst at Acme from 2024-01 came, and its check passed.
    const cto = { id: ids.role, title: "CTO", employer: "Acme", startMonth: "2024-01", endMonth: null, isCurrent: true };
    const passed = { employerKey: companyKey("Acme"), startMonth: "2024-01", status: "verified" as const, checkedAt: new Date("2026-10-01T00:00:00Z") };
    const badges = (me: ReturnType<typeof meFromProfile>) => me.experience.map((e) => [e.title, e.check?.state ?? null]);
    const both = meFromProfile(input({ profile: resume, added: added({ roles: [cto] }), jobChecks: [{ ...passed, employer: "Acme" }] }));
    expect(badges(both)).toEqual([
      ["Analyst", "verified"],
      ["CTO", null],
    ]);
    // An older check row without the company as written goes to the resume role too.
    expect(badges(meFromProfile(input({ profile: resume, added: added({ roles: [cto] }), jobChecks: [passed] })))).toEqual(badges(both));
    // Not yet verified: only one "Not verified" label, on the resume role.
    expect(badges(meFromProfile(input({ profile: resume, added: added({ roles: [cto] }) })))).toEqual([
      ["Analyst", "not_verified"],
      ["CTO", null],
    ]);
    // The check was made on the added role itself (written "Acme Pvt Ltd", before the resume came): it keeps the badge.
    const own = meFromProfile(
      input({ profile: resume, added: added({ roles: [{ ...cto, employer: "Acme Pvt Ltd" }] }), jobChecks: [{ ...passed, employer: "Acme Pvt Ltd" }] }),
    );
    expect(badges(own)).toEqual([
      ["Analyst", null],
      ["CTO", "verified"],
    ]);
    expect(meProfile.safeParse(both).success && meProfile.safeParse(own).success).toBe(true);
  });

  it("gives the shared badge to the current role, the one the check is for, when the company doesn't settle it (T95)", () => {
    // The resume's Analyst at Acme from 2024-01 has ended; the added CTO role at Acme from 2024-01 is current.
    const ended = profile({ roles: [{ title: "Analyst", employer: "Acme", start: "2024-01", end: "2025-06", highlights: [] }] });
    const cto = { id: ids.role, title: "CTO", employer: "Acme", startMonth: "2024-01", endMonth: null, isCurrent: true };
    const passed = { employerKey: companyKey("Acme"), startMonth: "2024-01", status: "verified" as const, checkedAt: new Date("2026-10-01T00:00:00Z") };
    const badges = (me: ReturnType<typeof meFromProfile>) => me.experience.map((e) => [e.title, e.check?.state ?? null]);
    // No check yet: "Not verified" sits on the current CTO role, not the ended one.
    expect(badges(meFromProfile(input({ profile: ended, added: added({ roles: [cto] }) })))).toEqual([
      ["Analyst", null],
      ["CTO", "not_verified"],
    ]);
    // A check written "Acme", as both rows write it, and an older row with no company as written: the CTO role too.
    for (const check of [{ ...passed, employer: "Acme" }, passed])
      expect(badges(meFromProfile(input({ profile: ended, added: added({ roles: [cto] }), jobChecks: [check] })))).toEqual([
        ["Analyst", null],
        ["CTO", "verified"],
      ]);
  });

  it("puts added education after the resume's, with its row id", () => {
    const me = meFromProfile(input({ profile: resume, added: added({ education: [{ id: ids.edu, qualification: "Data Analytics with Python", institution: "NPTEL", year: null }] }) }));
    expect(me.education).toEqual([
      { qualification: "B.Com", institution: "Example University", year: "2021" },
      { qualification: "Data Analytics with Python", institution: "NPTEL", year: "", added: { id: ids.edu } },
    ]);
  });

  it("shows stories with their SMART check, worked out here, and interests as typed", () => {
    const story = {
      id: ids.story,
      title: "Cut missed alerts",
      where: "Konkan Co-operative Bank · 2025",
      situation: "Alerts piled up.",
      task: "I owned triage.",
      action: "Sorted alerts by sender.",
      result: "Missed alerts fell a lot.",
      boxes: ["Ownership" as const],
      goalId: ids.goal,
      confirmed: true,
    };
    const me = meFromProfile(input({ added: added({ stories: [story], interests: ["Chess", "Public speaking"] }) }));
    expect(meProfile.safeParse(me).success).toBe(true);
    expect(me.stories[0]).toMatchObject({ id: ids.story, smart: ["A", "R", "T"], hint: expect.stringMatching(/12 words/), confirmed: true, fromGoal: true, goalId: ids.goal });
    expect(me.interests).toEqual(["Chess", "Public speaking"]);
  });
});
