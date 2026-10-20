import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { roleProfiles } from "@/content";
import { profile as profileSchema } from "@/lib/schemas";
import parsed from "../../../fixtures/sample-resume/priya-sharma.parsed.json";
import { buildGapAnalysis, SHOWN_GAPS } from "./analysis";
import { explainOutput } from "./explain";
import { matchProfile } from "./match";
import { SAMPLE_EXPLAINED_ROLES, sampleExplanations } from "./sample-explanations";
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
      const role = roleProfiles.find((r) => r.slug === slug)!;
      const match = matchProfile(sample, role, now);
      // Exactly the matcher's shown gaps, in its order.
      expect(data.gaps.map((g: { skillId: string }) => g.skillId)).toEqual(match.gaps.slice(0, SHOWN_GAPS).map((g) => g.skillId));
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
  });
});
