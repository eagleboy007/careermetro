import { describe, expect, it } from "vitest";
import { gap } from "./gap";
import { roleProfile } from "./role-profile";
import { waitlistSignup } from "./waitlist";

describe("waitlistSignup", () => {
  it("normalizes the email", () => {
    const parsed = waitlistSignup.parse({ email: "  Priya@Example.COM ", consent: true });
    expect(parsed.email).toBe("priya@example.com");
  });

  it("rejects a signup without consent", () => {
    expect(waitlistSignup.safeParse({ email: "a@b.co", consent: false }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(waitlistSignup.safeParse({ email: "not-an-email", consent: true }).success).toBe(false);
  });
});

describe("gap", () => {
  it("does not allow a met skill to be reported as a gap", () => {
    const result = gap.safeParse({
      skillId: "sql-window-functions",
      skillName: "SQL window functions",
      status: "met",
      resumeQuote: null,
      requirement: "Window functions and CTEs",
      explanation: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("roleProfile", () => {
  it("requires at least one source", () => {
    const result = roleProfile.safeParse({
      slug: "data-analyst",
      title: "Data Analyst",
      experienceBand: { minYears: 2, maxYears: 4 },
      skills: [
        { skillId: "sql", importance: "required", expectation: "Joins and aggregates" },
        { skillId: "excel", importance: "required", expectation: "Pivot tables" },
        { skillId: "power-bi", importance: "nice_to_have", expectation: "One dashboard" },
      ],
      sources: [],
      reviewedBy: null,
      updatedOn: "2026-10-06",
    });
    expect(result.success).toBe(false);
  });

  const base = {
    slug: "data-analyst",
    title: "Data Analyst",
    experienceBand: { minYears: 2, maxYears: 4 },
    skills: [
      { skillId: "sql", importance: "required", expectation: "Joins and aggregates" },
      { skillId: "excel", importance: "required", expectation: "Pivot tables" },
      { skillId: "power-bi", importance: "nice_to_have", expectation: "One dashboard" },
    ],
    sources: [{ description: "Drafted by hand.", url: null }],
    reviewedBy: null,
    updatedOn: "2026-10-30",
  };
  const duties = ["Write SQL", "Clean data", "Build a dashboard", "Answer a question from sales", "Check the numbers"];
  const summary = "A data analyst turns a company's data into answers for the people who run it.";

  it("takes a role without a summary, daily duties or typical titles", () => {
    const parsed = roleProfile.parse(base);
    expect([parsed.summary, parsed.dailyDuties, parsed.typicalTitles]).toEqual([undefined, undefined, undefined]);
  });

  it("takes a summary, 5 to 7 daily duties and 3 to 8 typical titles", () => {
    const parsed = roleProfile.parse({ ...base, summary, dailyDuties: duties, typicalTitles: ["Data Analyst", "MIS Analyst", "Reporting Analyst"] });
    expect(parsed.dailyDuties).toHaveLength(5);
    const most = { ...base, dailyDuties: [...duties, "Six", "Seven"], typicalTitles: Array.from({ length: 8 }, (_, i) => `Analyst ${i}`) };
    expect(roleProfile.safeParse(most).success).toBe(true);
  });

  it("rejects a summary that is too short or too long", () => {
    for (const bad of ["", "Analyst.", "x".repeat(401)]) expect(roleProfile.safeParse({ ...base, summary: bad }).success).toBe(false);
  });

  it("rejects too few or too many daily duties, or an empty or long one", () => {
    for (const bad of [duties.slice(0, 4), [...duties, "Six", "Seven", "Eight"], [...duties.slice(0, 4), ""], [...duties.slice(0, 4), "x".repeat(141)]]) {
      expect(roleProfile.safeParse({ ...base, dailyDuties: bad }).success).toBe(false);
    }
  });

  it("rejects too few or too many typical titles, a long one or the same title twice", () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => `Analyst ${i}`);
    for (const bad of [["Data Analyst", "MIS Analyst"], tooMany, ["Data Analyst", "MIS Analyst", "x".repeat(61)], ["Data Analyst", "MIS Analyst", "data analyst"]]) {
      expect(roleProfile.safeParse({ ...base, typicalTitles: bad }).success).toBe(false);
    }
  });
});
