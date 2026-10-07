import { describe, expect, it } from "vitest";
import type { EvalCase, Profile } from "@/lib/schemas";
import { loadEvalCases } from "./cases";
import { formatParseEval, resolveSkillId, runParseEval } from "./parse-eval";

const cases = loadEvalCases();
const call = { purpose: "parse-resume", model: "m", promptVersion: "parse-resume/v1", inputRefs: {}, inputTokens: 1, outputTokens: 1, costUsd: 0.05, latencyMs: 2000, ok: true };

const profileWith = (names: string[]): Profile => ({
  headline: null,
  totalYearsExperience: null,
  roles: [],
  skills: names.map((name) => ({ name, lastUsed: null, evidence: [] })),
  education: [],
  certifications: [],
});

describe("runParseEval", () => {
  it("scores recall, hallucinations and unmapped names per case", async () => {
    const c: EvalCase = cases[0];
    const expectedIds = c.expected.skills.map((s) => s.skillId);
    const bad = c.expected.mustNotClaim[0];
    const names = [expectedIds[0], ...(bad ? [bad] : []), "Totally Made Up Skill"];
    const report = await runParseEval([c], async () => ({ profile: profileWith([...names, "Totally Made Up Skill"]), droppedSkills: ["Kubernetes"], calls: [call] }), {
      promptVersion: "parse-resume/v1",
      model: "m",
    });

    expect(report.cases[0].parseRecall).toBeCloseTo(1 / new Set(expectedIds).size);
    expect(report.cases[0].hallucinations).toEqual(bad ? [bad] : []);
    expect(report.cases[0].unmapped).toEqual(["Totally Made Up Skill"]);
    expect(report.cases[0].dropped).toEqual(["Kubernetes"]);
    expect(report.costUsd).toBeCloseTo(0.05);
    expect(formatParseEval(report)).toContain(c.id);
    expect(formatParseEval(report)).not.toContain(c.resumeText.slice(0, 40));
  });

  it("counts a failed parse as zero recall", async () => {
    const report = await runParseEval(cases.slice(0, 2), async () => ({ profile: null, reason: "refused", calls: [] }), { promptVersion: "v", model: "m" });
    expect(report.failed).toBe(2);
    expect(formatParseEval(report)).toContain("failed (refused)");
    expect(report.meanRecall).toBe(0);
  });
});

describe("resolveSkillId", () => {
  it("matches names and aliases regardless of case and spacing", () => {
    expect(resolveSkillId("  SQL ")).toBe("sql");
    expect(resolveSkillId("No such skill")).toBeUndefined();
  });
});
