import { describe, expect, it } from "vitest";
import { JOB_TEXT_MAX, JOB_TEXT_MIN, jobCheckRequest, postingSkills, ROLE_REQUEST_TITLE_MAX, roleRequestBody, roleRequestTitle } from "./job-check";

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

  it("takes a null role for a check that stands in for a role we don't have, but never a missing one", () => {
    expect(jobCheckRequest.parse({ ...ok, roleSlug: null }).roleSlug).toBeNull();
    expect(jobCheckRequest.safeParse({ ...ok, roleSlug: undefined }).success).toBe(false);
    expect(jobCheckRequest.safeParse({ ...ok, roleSlug: "" }).success).toBe(false);
  });
});

describe("roleRequestTitle", () => {
  const title = (s: string) => roleRequestTitle.safeParse(s);

  it("keeps one plain, lowercased line", () => {
    expect(title("  Blockchain   Developer ").data).toBe("blockchain developer");
    expect(title("Blockchain\nDeveloper\t(Web3)").data).toBe("blockchain developer (web3)");
    expect(title("C++ / .NET Developer").data).toBe("c++ / .net developer");
    expect(title("ＳＡＰ Consultant").data).toBe("sap consultant");
    expect(title("Développeur *** Salesforce!!").data).toBe("développeur salesforce");
  });

  it("caps the length at a word boundary", () => {
    const long = title("Senior Principal Staff ".repeat(6));
    expect(long.success).toBe(true);
    expect(long.data!.length).toBeLessThanOrEqual(ROLE_REQUEST_TITLE_MAX);
    expect(long.data!.endsWith(" ")).toBe(false);
    expect(long.data!.split(" ").every((w) => ["senior", "principal", "staff"].includes(w))).toBe(true);
  });

  it("refuses what is too short, has no letters, or looks like contact details", () => {
    for (const bad of ["", " a ", "1234", "!!!", "priya@example.com", "call 98765 43210", "https://example.com/jobs", "www.example.com", "x".repeat(201)]) {
      expect(title(bad).success, bad).toBe(false);
    }
  });

  it("refuses bare links, but keeps technology names with dots", () => {
    for (const bad of ["linkedin.com/in/priya", "priya.dev/about", "example.com", "Analyst at example.co.in", "careers.example.io", "myname.org", "site.net", "example.co"]) {
      expect(title(bad).success, bad).toBe(false);
    }
    for (const good of [".NET Developer", "ASP.NET Developer", "Node.js Developer", "Vue.js Engineer", "VB.NET Programmer", "B.Com Accountant", "Sr. Analyst", "UI/UX Designer"]) {
      expect(title(good).success, good).toBe(true);
    }
  });
});

describe("roleRequestBody", () => {
  it("takes only a title", () => {
    expect(roleRequestBody.parse({ title: "Blockchain Developer" })).toEqual({ title: "blockchain developer" });
    expect(roleRequestBody.safeParse({ title: "Blockchain Developer", email: "a@b.c" }).success).toBe(false);
    expect(roleRequestBody.safeParse({}).success).toBe(false);
  });
});

describe("postingSkills", () => {
  it("takes only required or nice skills, each with a quote", () => {
    expect(postingSkills.safeParse({ skills: [{ name: "SQL", quote: "SQL", level: "required" }] }).success).toBe(true);
    expect(postingSkills.safeParse({ skills: [{ name: "SQL", quote: "SQL", level: "must" }] }).success).toBe(false);
    expect(postingSkills.safeParse({ skills: [{ name: "SQL", level: "nice" }] }).success).toBe(false);
  });
});
