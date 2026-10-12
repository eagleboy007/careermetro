import { describe, expect, it } from "vitest";
import { JOB_TEXT_MAX, JOB_TEXT_MIN, jobCheckRequest, postingSkills } from "./job-check";

const ok = {
  resumeId: "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69",
  roleSlug: "data-analyst",
  company: "  Example   Analytics Pvt Ltd ",
  title: "Data Analyst",
  text: "We are hiring. ".repeat(20),
};

describe("jobCheckRequest", () => {
  it("accepts a posting and tidies the company and title", () => {
    const parsed = jobCheckRequest.parse(ok);
    expect(parsed.company).toBe("Example Analytics Pvt Ltd");
    expect(parsed.text.endsWith(".")).toBe(true);
  });

  it("refuses postings that are too short or too long", () => {
    expect(jobCheckRequest.safeParse({ ...ok, text: "x".repeat(JOB_TEXT_MIN - 1) }).success).toBe(false);
    expect(jobCheckRequest.safeParse({ ...ok, text: "x".repeat(JOB_TEXT_MAX + 1) }).success).toBe(false);
    // Surrounding spaces don't count toward the minimum.
    expect(jobCheckRequest.safeParse({ ...ok, text: ` ${"x".repeat(JOB_TEXT_MIN - 1)}    ` }).success).toBe(false);
  });

  it("needs a company and a title, each one line", () => {
    expect(jobCheckRequest.safeParse({ ...ok, company: "   " }).success).toBe(false);
    expect(jobCheckRequest.safeParse({ ...ok, title: "" }).success).toBe(false);
    expect(jobCheckRequest.safeParse({ ...ok, title: "x".repeat(121) }).success).toBe(false);
    expect(jobCheckRequest.parse({ ...ok, title: "Data\nAnalyst" }).title).toBe("Data Analyst");
  });

  it("refuses a bad resume id, a bad role slug and extra fields", () => {
    expect(jobCheckRequest.safeParse({ ...ok, resumeId: "1" }).success).toBe(false);
    expect(jobCheckRequest.safeParse({ ...ok, roleSlug: "../x" }).success).toBe(false);
    expect(jobCheckRequest.safeParse({ ...ok, goals: ["sql"] }).success).toBe(false);
  });
});

describe("postingSkills", () => {
  it("takes only required or nice skills, each with a quote", () => {
    expect(postingSkills.safeParse({ skills: [{ name: "SQL", quote: "SQL", level: "required" }] }).success).toBe(true);
    expect(postingSkills.safeParse({ skills: [{ name: "SQL", quote: "SQL", level: "must" }] }).success).toBe(false);
    expect(postingSkills.safeParse({ skills: [{ name: "SQL", level: "nice" }] }).success).toBe(false);
  });
});
