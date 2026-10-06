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
});
