import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { roleProfiles } from "@/content";
import { profile as profileSchema } from "@/lib/schemas";
import parsed from "../../../fixtures/sample-resume/priya-sharma.parsed.json";
import { buildGapAnalysis, SHOWN_GAPS } from "./analysis";
import { explainOutput } from "./explain";
import { matchProfile } from "./match";
import { SAMPLE_EXPLAINED_ROLES, sampleExplanations, sampleWords } from "./sample-explanations";
import { suggestRoles } from "./suggest";

vi.mock("server-only", () => ({}));

// The sample resume's words are checked in (T113): they must say what the matcher says, under the explain-gaps rules.
const sample = profileSchema.parse(parsed);
const resumeText = readFileSync(join(process.cwd(), "fixtures/resumes/priya-sharma.txt"), "utf8");
const now = new Date("2026-10-20T00:00:00Z");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("the sample resume's explanations", () => {
  it("cover the role the sample suggests first", () => {
    const [first] = suggestRoles(sample, roleProfiles, now);
    expect(first).toBeDefined();
    expect(SAMPLE_EXPLAINED_ROLES).toContain(first.slug);
  });

  for (const slug of SAMPLE_EXPLAINED_ROLES) {
    it(`for ${slug} fit the explain-gaps output and the prompt's rules`, () => {
      const data = JSON.parse(readFileSync(join(process.cwd(), `fixtures/sample-resume/explanations.${slug}.json`), "utf8"));
      expect(explainOutput.safeParse(data).success).toBe(true);
      expect(sampleWords.safeParse(data).success).toBe(true);
      const role = roleProfiles.find((r) => r.slug === slug)!;
      const match = matchProfile(sample, role, now);
      // Exactly the matcher's shown gaps, in its order, each in the state and with the resume line it was written for.
      const shown = match.gaps.slice(0, SHOWN_GAPS).map(({ skillId, status, resumeQuote }) => ({ skillId, status, resumeQuote }));
      expect(data.gaps.map(({ skillId, status, resumeQuote }: { skillId: string; status: string; resumeQuote: string | null }) => ({ skillId, status, resumeQuote }))).toEqual(shown);
      expect(data.matched).toEqual(match.readiness);
      const texts: string[] = [data.readiness, ...data.gaps.map((g: { explanation: string }) => g.explanation)];
      for (const t of texts) {
        expect(t).not.toContain("!");
        expect(words(t)).toBeLessThanOrEqual(45);
        // No invented quotes: every quoted phrase is in the sample resume's own text.
        for (const [, q] of t.matchAll(/"([^"]+)"/g)) expect(resumeText).toContain(q);
      }
      // The matcher's numbers, with the hours called an estimate.
      const { requiredMet, requiredTotal, estimatedHours } = match.readiness;
      expect(data.readiness).toContain(`${requiredMet} of the ${requiredTotal}`);
      expect(data.readiness).toContain(`${estimatedHours} hours`);
      expect(data.readiness).toMatch(/estimate/i);

      const explained = sampleExplanations(match);
      expect(explained).not.toBeNull();
      const analysis = buildGapAnalysis(match, explained);
      expect(analysis.gaps.slice(0, SHOWN_GAPS).map((g) => g.explanation)).toEqual(data.gaps.map((g: { explanation: string }) => g.explanation));
    });
  }

  it("give nothing for another role or gaps that no longer match, so the template is used", () => {
    const other = roleProfiles.find((r) => !SAMPLE_EXPLAINED_ROLES.includes(r.slug))!;
    expect(sampleExplanations(matchProfile(sample, other, now))).toBeNull();
    const role = roleProfiles.find((r) => r.slug === SAMPLE_EXPLAINED_ROLES[0])!;
    const match = matchProfile(sample, role, now);
    expect(sampleExplanations({ ...match, gaps: match.gaps.slice(1) })).toBeNull();
    // The same gaps in the same order, but another state, resume line or readiness number.
    const [first, ...rest] = match.gaps;
    expect(sampleExplanations({ ...match, gaps: [{ ...first, status: first.status === "missing" ? "weak" : "missing" }, ...rest] })).toBeNull();
    expect(sampleExplanations({ ...match, gaps: [{ ...first, resumeQuote: "Another line" }, ...rest] })).toBeNull();
    expect(sampleExplanations({ ...match, readiness: { ...match.readiness, estimatedHours: match.readiness.estimatedHours + 1 } })).toBeNull();
    expect(sampleExplanations({ ...match, readiness: { ...match.readiness, requiredMet: match.readiness.requiredMet - 1 } })).toBeNull();
  });

  it("give nothing for a sample the person edited on the confirm step, so its gaps get the template", () => {
    const role = roleProfiles.find((r) => r.slug === "data-analyst")!;
    // Python taken out: Python is now missing and the hours change.
    const noPython = {
      ...sample,
      roles: sample.roles.map((r) => ({ ...r, highlights: r.highlights.filter((h) => !/python/i.test(h)) })),
      skills: sample.skills.filter((sk) => !/python|pandas/i.test(sk.name)).map((sk) => ({ ...sk, evidence: sk.evidence.map((e) => e.replace(/Python, /, "")) })),
    };
    const edited = matchProfile(noPython, role, now);
    expect(edited.gaps.find((g) => g.skillId === "python")?.status).toBe("missing");
    expect(sampleExplanations(edited)).toBeNull();
    const analysis = buildGapAnalysis(edited, sampleExplanations(edited));
    expect(analysis.readiness.explanation).toContain("rough estimate");
    expect(analysis.gaps.find((g) => g.skillId === "python")!.explanation).not.toContain("Used Python (pandas)");

    // The Python line reworded: still outdated, but the words quote a line the resume no longer has.
    const line = "Used Python (pandas) to merge vendor files";
    const reworded = (t: string) => (t === line ? "Used Python (pandas) to merge vendor and supplier files" : t);
    const otherLine = {
      ...sample,
      roles: sample.roles.map((r) => ({ ...r, highlights: r.highlights.map(reworded) })),
      skills: sample.skills.map((sk) => ({ ...sk, evidence: sk.evidence.map(reworded) })),
    };
    const moved = matchProfile(otherLine, role, now);
    expect(moved.gaps.find((g) => g.skillId === "python")?.status).toBe("outdated");
    expect(sampleExplanations(moved)).toBeNull();
  });
});
