import { describe, expect, it } from "vitest";
import { skills } from "@/content";
import { taxonomyId } from "@/lib/gaps/match";
import { containsPhrase, normalizeForMatch } from "@/lib/resume/verify";
import { loadJdEvalCases } from "./cases";
import { formatJdEval, runJdEval, scoreJdCase } from "./jd-eval";

const cases = loadJdEvalCases();
const byId = new Map(skills.map((s) => [s.id, s]));
const each = cases.map((c) => [c.id, c] as const);
/** True when the posting prints the skill's name or one of its aliases as whole words. */
const names = (text: string, id: string) => {
  const s = byId.get(id)!;
  return [s.name, ...s.aliases].some((t) => containsPhrase(normalizeForMatch(text), normalizeForMatch(t)));
};

describe("job posting eval set", () => {
  it("has ten cases with unique ids, none from a real company", () => {
    expect(cases).toHaveLength(10);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) expect(c.company).toMatch(/^(Example|Sample) /);
  });

  it.each(each)("%s labels known skills, each once, that the posting names", (_, c) => {
    const labelled = [...c.expected.required, ...c.expected.nice];
    expect([...labelled, ...c.expected.mustNotClaim].filter((id) => !byId.has(id))).toEqual([]);
    expect(new Set(labelled).size).toBe(labelled.length);
    expect(labelled.filter((id) => !names(c.text, id))).toEqual([]);
    expect(c.expected.mustNotClaim.filter((id) => names(c.text, id))).toEqual([]);
  });

  it.each(each)("%s lists unknown names the posting prints and our skill list lacks", (_, c) => {
    for (const n of c.expected.unknown) {
      expect(c.text).toContain(n);
      expect(taxonomyId(n)).toBeUndefined();
    }
  });
});

describe("job posting eval scoring", () => {
  const c = cases[0];
  const call = { purpose: "parse-jd", model: "m", promptVersion: "parse-jd/v1", inputRefs: {}, inputTokens: 1, outputTokens: 1, costUsd: 0.02, latencyMs: 4000, ok: true };

  it("scores recall, level and hallucinations", () => {
    const r = scoreJdCase(c, {
      ok: true,
      requiredSkillIds: [c.expected.required[0], c.expected.mustNotClaim[0]],
      niceSkillIds: [c.expected.required[1]],
      unknownSkills: c.expected.unknown.map((n) => n.toUpperCase()),
      dropped: 1,
      calls: [call],
    });
    const total = c.expected.required.length + c.expected.nice.length;
    expect(r.recall).toBeCloseTo(2 / total);
    expect(r.levelAccuracy).toBeCloseTo(0.5);
    expect(r.hallucinations).toEqual([c.expected.mustNotClaim[0]]);
    expect(r.unknownFound).toBe(c.expected.unknown.length);
    expect(r).toMatchObject({ ok: true, dropped: 1, costUsd: 0.02 });
  });

  it("counts a failed reading as finding nothing, and writes no posting text in the summary", async () => {
    const report = await runJdEval(cases, async () => ({ ok: false, reason: "malformed", calls: [call] }), { promptVersion: "parse-jd/v1", model: "m" });
    expect(report).toMatchObject({ failed: 10, meanRecall: 0, hallucinations: 0 });
    const summary = formatJdEval(report);
    for (const x of cases) for (const line of x.text.split("\n").filter((l) => l.length > 20)) expect(summary).not.toContain(line);
  });
});
