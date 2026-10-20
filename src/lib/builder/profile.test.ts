import { describe, expect, it } from "vitest";
import { builderAnswers } from "@/lib/schemas";
import { buildProfile, builderText, checkedLines, freeAnswers, profileFromAnswers, yearsOfWork } from "./profile";
import { lineSupported, numbersIn, ownLines, toolsIn } from "./verify-lines";

// Every answer here is made up.
const answers = builderAnswers.parse({
  role: { roleSlug: "cyber-security-analyst", stage: "working", city: "Pune" },
  education: [{ id: "e1", degree: "B.Sc. Computer Science", college: "Example College", start: "2019", end: "2022" }],
  projects: [{ id: "p1", name: "Home lab", did: "Set up Wazuh on 3 home machines. Wrote alert rules for failed logins." }],
  worked: true,
  jobs: [
    { id: "j1", kind: "internship", company: "Example Co", title: "IT support intern", from: "2022-01", to: "2022-06", did: "Closed about 20 tickets a week." },
    { id: "j2", kind: "job", company: "Sample Ltd", title: "Support engineer", from: "2022-07", to: "2025-01", did: "Looked after 40 laptops and the office network." },
  ],
  tools: ["Wazuh", "SQL"],
  certificates: [{ id: "c1", name: "Example Security Basics", issuer: "Example Board", earned: "2024-03" }],
});
const now = new Date("2026-10-19T06:00:00Z");

describe("builder lines", () => {
  it("keeps a reworded line only when its numbers and tools are in the answer or the picks", () => {
    const answer = "Set up Wazuh on 3 home machines.";
    expect(lineSupported("Deployed Wazuh across 3 home machines", answer)).toBe(true);
    expect(lineSupported("Deployed Wazuh across 5 home machines", answer)).toBe(false);
    expect(lineSupported("Set up Wazuh and SQL reports on 3 machines", answer)).toBe(false);
    expect(lineSupported("Set up Wazuh and SQL reports on 3 machines", answer, ["SQL"])).toBe(true);
    expect(numbersIn("Saved 1,200 rupees in 2.5 hours")).toEqual(["1200", "2.5"]);
  });

  it("checks frameworks whose names are also ordinary words against the answer itself", () => {
    expect(toolsIn("Built a todo app with React and Express")).toEqual(expect.arrayContaining(["react", "express"]));
    expect(lineSupported("Built a todo app with React and Express", "Built a todo app")).toBe(false);
    // A pick is not enough for a name that is also a plain word: the answer has to say it.
    expect(lineSupported("Built a todo app with React and Express", "Built a todo app", ["React", "Node.js"])).toBe(false);
    expect(lineSupported("Built a todo app with React and Express", "Built a todo app in React with an Express API")).toBe(true);
    for (const [line, answer] of [
      ["Built APIs with Spring", "Built APIs in Java"],
      ["Moved jobs to Lambda", "Moved jobs to the cloud"],
      ["Packaged releases with Helm", "Packaged releases"],
      ["Ran the app in containers", "Ran the app on a server"],
    ])
      expect(lineSupported(line, answer)).toBe(false);
    // A tool that isn't also a plain word still passes when it was picked.
    expect(lineSupported("Wrote queries in PostgreSQL", "Wrote queries", ["PostgreSQL"])).toBe(true);
  });

  it("treats number words like digits", () => {
    expect(numbersIn("Trained five people twice, and a hundred more")).toEqual(["5", "2", "100"]);
    expect(lineSupported("Trained five interns", "Trained interns")).toBe(false);
    expect(lineSupported("Trained 5 interns", "Trained five interns")).toBe(true);
    expect(lineSupported("Trained five interns", "Trained 5 interns")).toBe(true);
    expect(lineSupported("Ran the audit twice", "Ran the audit")).toBe(false);
    expect(lineSupported("Served a hundred users", "Served 50 users")).toBe(false);
    // Whole words only: "someone" and "often" hold no number.
    expect(numbersIn("Helped someone often")).toEqual([]);
  });

  it("falls back to the person's own sentences", () => {
    expect(ownLines("One. Two! Three? Four. Five.")).toEqual(["One.", "Two!", "Three?", "Four. Five."]);
    const { lines, dropped } = checkedLines(answers, [{ answerId: "p:p1", lines: ["Monitored 12 machines with Splunk"] }]);
    expect(dropped).toBe(1);
    expect(lines["p:p1"]).toEqual(["Set up Wazuh on 3 home machines.", "Wrote alert rules for failed logins."]);
    expect(Object.keys(freeAnswers(answers)).sort()).toEqual(["j:j1", "j:j2", "p:p1"]);
    expect(checkedLines(answers, null).dropped).toBe(0);
  });
});

describe("profile from answers", () => {
  it("builds every fact from the answers, and counts only jobs as years of work", () => {
    const { lines } = checkedLines(answers, [{ answerId: "j:j2", lines: ["Supported 40 laptops and the office network"] }]);
    const p = profileFromAnswers(answers, lines, now);
    expect(p.roles.map((r) => [r.title, r.employer, r.start, r.end])).toEqual([
      ["IT support intern (Internship)", "Example Co", "2022-01", "2022-06"],
      ["Support engineer", "Sample Ltd", "2022-07", "2025-01"],
      ["Home lab", "Project", null, null],
    ]);
    expect(p.roles[1].highlights).toEqual(["Supported 40 laptops and the office network"]);
    expect(p.skills.map((s) => s.name)).toEqual(["Wazuh", "SQL", "Example Security Basics"]);
    expect(p.totalYearsExperience).toBe(2);
    expect(p.education).toEqual([{ qualification: "B.Sc. Computer Science", institution: "Example College", year: "2022" }]);
    expect(p.certifications).toEqual([{ name: "Example Security Basics", earned: "2024-03", expires: null }]);
    expect(yearsOfWork({ ...answers, worked: false, jobs: [] }, now)).toBe(0);
    expect(yearsOfWork({ ...answers, jobs: [{ ...answers.jobs[1], from: "2024-10", to: "now" }] }, now)).toBe(2);
  });

  it("runs the AI-5 check against the person's own answers, never the model's lines", () => {
    // A line that slipped past the first check (here, put straight into the lines) is still caught: the backstop reads
    // only what the person wrote, so the model's own line can't vouch for itself.
    const lines = { ...checkedLines(answers, null).lines, "p:p1": ["Set up Wazuh on 3 home machines.", "Monitored 12 machines with Splunk"] };
    const { profile, report } = buildProfile(answers, lines, now);
    expect(profile.roles.find((r) => r.employer === "Project")?.highlights).toEqual(["Set up Wazuh on 3 home machines."]);
    expect(report.droppedQuotes).toBe(1);
    // A reworded line the answer supports stays, though it isn't word for word in the answer.
    const reworded = { ...lines, "p:p1": ["Deployed Wazuh across 3 home machines"] };
    expect(buildProfile(answers, reworded, now).profile.roles.find((r) => r.employer === "Project")?.highlights).toEqual(["Deployed Wazuh across 3 home machines"]);
  });

  it("passes the same AI-5 check as an upload without dropping anything", () => {
    const { lines } = checkedLines(answers, null);
    const { profile, report } = buildProfile(answers, lines, now);
    expect(report).toEqual({ droppedSkills: [], droppedQuotes: 0, droppedRoles: 0, droppedOther: 0 });
    expect(profile).toEqual(profileFromAnswers(answers, lines, now));
    expect(builderText(answers, lines)).not.toContain("Pune");
  });
});
