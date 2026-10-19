import { describe, expect, it } from "vitest";
import { BUILDER_TEXT_MAX, BUILDER_TOOLS_MAX, EMPTY_BUILDER_ANSWERS, builderAnswers, builderMissing, builderReword } from "./builder";

// Every answer here is made up.
const ready = builderAnswers.parse({
  role: { roleSlug: "cyber-security-analyst", stage: "graduated", city: "Pune" },
  education: [{ id: "e1", degree: "B.Sc. Computer Science", college: "Example College", start: "2021", end: "2024" }],
  projects: [{ id: "p1", name: "Home lab", did: "Set up Wazuh on 3 home machines." }],
  worked: true,
  jobs: [{ id: "j1", kind: "internship", company: "Example Co", title: "IT support intern", from: "2024-01", to: "2024-06", did: "Closed about 20 tickets a week." }],
  tools: ["Wazuh", "Linux"],
});

describe("builder answers", () => {
  it("fills an empty draft with defaults and needs every section", () => {
    expect(EMPTY_BUILDER_ANSWERS.links).toEqual({ github: "", portfolio: "", linkedin: "", email: "" });
    expect(Object.keys(builderMissing(EMPTY_BUILDER_ANSWERS)).sort()).toEqual(["education", "jobs", "role", "tools"]);
  });

  it("is ready once each required answer is there", () => {
    expect(builderMissing(ready)).toEqual({});
    expect(builderMissing({ ...ready, worked: false, jobs: [] })).toEqual({});
    expect(builderMissing({ ...ready, jobs: [{ ...ready.jobs[0], to: "" }] }).jobs).toBeDefined();
    expect(builderMissing({ ...ready, certificates: [{ id: "c1", name: "", issuer: "", earned: "", badge: "" }] }).certificates).toBeDefined();
    expect(builderMissing({ ...ready, noCertificates: true, certificates: [{ id: "c1", name: "", issuer: "", earned: "", badge: "" }] }).certificates).toBeUndefined();
  });

  it("caps free text and tools", () => {
    const long = "a".repeat(BUILDER_TEXT_MAX + 1);
    expect(builderAnswers.safeParse({ projects: [{ id: "p1", name: "X", did: long }] }).success).toBe(false);
    expect(builderAnswers.safeParse({ tools: Array.from({ length: BUILDER_TOOLS_MAX + 1 }, (_, i) => `t${i}`) }).success).toBe(false);
  });

  it("takes https links only, and GitHub and LinkedIn only on their sites", () => {
    const links = (l: object) => builderAnswers.safeParse({ links: { github: "", portfolio: "", linkedin: "", email: "", ...l } }).success;
    expect(links({ github: "https://github.com/example" })).toBe(true);
    expect(links({ github: "https://gitlab.com/example" })).toBe(false);
    expect(links({ portfolio: "http://example.com" })).toBe(false);
    expect(links({ portfolio: "javascript:alert(1)" })).toBe(false);
    expect(links({ linkedin: "https://in.linkedin.com/in/example" })).toBe(true);
    expect(links({ email: "not an email" })).toBe(false);
  });

  it("refuses bad months, years and row ids", () => {
    expect(builderAnswers.safeParse({ jobs: [{ ...ready.jobs[0], from: "2024-13" }] }).success).toBe(false);
    expect(builderAnswers.safeParse({ education: [{ ...ready.education[0], end: "24" }] }).success).toBe(false);
    expect(builderAnswers.safeParse({ projects: [{ ...ready.projects[0], id: "../x" }] }).success).toBe(false);
  });
});

describe("builder reword reply", () => {
  it("takes at most four lines an answer and names answers by id", () => {
    const ok = { answers: [{ answerId: "p:p1", lines: ["Set up Wazuh on 3 home machines."] }], suggestions: [{ kind: "number", text: "How many alerts?", answerId: "p:p1" }] };
    expect(builderReword.safeParse(ok).success).toBe(true);
    expect(builderReword.safeParse({ ...ok, answers: [{ answerId: "p:p1", lines: ["a", "b", "c", "d", "e"] }] }).success).toBe(false);
    expect(builderReword.safeParse({ ...ok, answers: [{ answerId: "x:p1", lines: ["a"] }] }).success).toBe(false);
  });
});
