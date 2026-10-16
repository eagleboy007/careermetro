import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { domainMatchesEmployer, domainName, experienceCheck, experienceCheckText, isSelfDeclared, jobKeyOf, jobToCheck, startMonthOf } from "./job-check-rules";

const role = (employer: string, start: string | null, end: string | null = null) => ({ title: "Analyst", employer, start, end, highlights: [] });
const profile = (roles: ReturnType<typeof role>[]): Profile => ({ headline: null, totalYearsExperience: 3, roles, skills: [], education: [], certifications: [] });
const OCT = new Date("2026-10-16T10:00:00Z");

describe("the work-email check of the current job (FR-47)", () => {
  it("checks the current job only: the open one that started last, else the latest", () => {
    expect(jobToCheck(profile([role("Garuda Sec Pvt Ltd", "2024-06"), role("Konkan Bank", "2021-01", "2024-05")]))).toEqual({
      employer: "Garuda Sec Pvt Ltd",
      employerKey: "garuda sec",
      startMonth: "2024-06",
    });
    expect(jobToCheck(profile([role("Konkan Bank", "2021-01", "2024-05"), role("Garuda Sec", "2019-01", "2020-12")]))?.employer).toBe("Konkan Bank");
    expect(jobToCheck(profile([role("Old Co", "2020", null), role("New Co", "2024-02", null)]))?.employer).toBe("New Co");
    expect(jobToCheck(profile([]))).toBeNull();
    expect(jobToCheck(null)).toBeNull();
  });

  it("never checks freelance or self-employed work, which is self-declared", () => {
    for (const e of ["Freelance", "Freelancer (design)", "Self-employed", "Self employed", "Independent consultant", "Own business"]) expect(isSelfDeclared(e)).toBe(true);
    expect(isSelfDeclared("Garuda Sec")).toBe(false);
    expect(jobToCheck(profile([role("Freelance", "2024-06")]))).toBeNull();
    expect(experienceCheck(role("Freelance", "2024-06"), null, [])).toEqual({ state: "self_declared", month: null });
    expect(experienceCheck(role("Freelance", "2020-01", "2021-01"), null, [])).toBeNull();
  });

  it("keys a job by its company and start month, so a new company or start date is a new job", () => {
    expect(startMonthOf("2024-06")).toBe("2024-06");
    expect(startMonthOf("2024")).toBe("2024");
    expect(startMonthOf("June 2024")).toBe("");
    expect(startMonthOf(null)).toBe("");
    expect(jobKeyOf(role("Example Labs Private Limited", "2024-06")).employerKey).toBe("example labs");
  });

  it("matches a domain that plainly belongs to the company, and sends anything else to review", () => {
    expect(domainName("mail.garudasec.co.in")).toBe("garudasec");
    expect(domainName("example-labs.com")).toBe("examplelabs");
    expect(domainMatchesEmployer("garudasec.com", "garuda sec")).toBe(true);
    expect(domainMatchesEmployer("in.infosys.com", "infosys bpm")).toBe(true);
    expect(domainMatchesEmployer("tcs.com", "tata consultancy services")).toBe(true);
    expect(domainMatchesEmployer("example-labs.in", "example labs")).toBe(true);
    expect(domainMatchesEmployer("info.com", "infosys")).toBe(false);
    expect(domainMatchesEmployer("otherco.com", "garuda sec")).toBe(false);
  });

  it("labels the checked job, keeps a passed check after an end date, and says nothing about older jobs", () => {
    const now = role("Garuda Sec", "2024-06");
    const key = jobKeyOf(now);
    const verified = [{ employerKey: "garuda sec", startMonth: "2024-06", status: "verified" as const, checkedAt: OCT }];
    expect(experienceCheck(now, key, [])).toEqual({ state: "not_verified", month: null });
    expect(experienceCheck(now, key, verified)).toEqual({ state: "verified", month: "Oct 2026" });
    expect(experienceCheck(role("Garuda Sec", "2024-06", "2026-09"), null, verified)).toEqual({ state: "verified_while_there", month: "Oct 2026" });
    expect(experienceCheck(now, key, [{ ...verified[0], status: "review" }])).toEqual({ state: "review", month: null });
    expect(experienceCheck(now, key, [{ ...verified[0], status: "refused" }])).toEqual({ state: "not_verified", month: null });
    // A new start date on the profile is a new job: the old check doesn't carry over.
    const moved = role("Garuda Sec", "2025-01");
    expect(experienceCheck(moved, jobKeyOf(moved), verified)).toEqual({ state: "not_verified", month: null });
    expect(experienceCheck(role("Konkan Bank", "2021-01", "2024-05"), key, [])).toBeNull();
  });

  it("says each label in words, and a domain under review reads as not verified to others", () => {
    expect(experienceCheckText({ state: "verified", month: "Oct 2026" }, false)).toBe("Verified with work email · Oct 2026");
    expect(experienceCheckText({ state: "verified_while_there", month: "Oct 2026" }, false)).toBe("Verified while there · Oct 2026");
    expect(experienceCheckText({ state: "self_declared", month: null }, false)).toBe("Self-declared");
    expect(experienceCheckText({ state: "review", month: null }, false)).toBe("Not verified");
    expect(experienceCheckText({ state: "review", month: null }, true)).toContain("checking");
  });
});
