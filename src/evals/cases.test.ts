import { describe, expect, it } from "vitest";
import { roleProfiles, skills } from "@/content";
import { loadEvalCases } from "./cases";

const cases = loadEvalCases();
const roles = new Map(roleProfiles.map((r) => [r.slug, r]));
const knownSkills = new Set(skills.map((s) => s.id));
const each = cases.map((c) => [c.id, c] as const);

describe("eval set", () => {
  it("has unique ids", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("covers every role profile", () => {
    const covered = new Set(cases.map((c) => c.roleSlug));
    expect([...roles.keys()].filter((slug) => !covered.has(slug))).toEqual([]);
  });

  it.each(each)("%s targets a known role and known skills", (_, c) => {
    expect(roles.has(c.roleSlug)).toBe(true);
    const ids = [...c.expected.skills.map((s) => s.skillId), ...c.expected.gaps.map((g) => g.skillId), ...c.expected.mustNotClaim];
    expect(ids.filter((id) => !knownSkills.has(id))).toEqual([]);
  });

  it.each(each)("%s quotes the resume word for word", (_, c) => {
    expect(c.expected.skills.filter((s) => !c.resumeText.includes(s.quote)).map((s) => s.skillId)).toEqual([]);
  });

  it.each(each)("%s labels every required skill of its role exactly once", (_, c) => {
    const found = new Set(c.expected.skills.map((s) => s.skillId));
    const gapIds = c.expected.gaps.map((g) => g.skillId);
    expect(new Set(gapIds).size).toBe(gapIds.length);
    const required = roles.get(c.roleSlug)!.skills.filter((s) => s.importance === "required").map((s) => s.skillId);
    // A required skill is either met (found, no gap) or a gap. Gaps must point at required skills.
    expect(gapIds.filter((id) => !required.includes(id))).toEqual([]);
    expect(required.filter((id) => !found.has(id) && !gapIds.includes(id))).toEqual([]);
  });

  it.each(each)("%s keeps evidence and gap status consistent", (_, c) => {
    const found = new Set(c.expected.skills.map((s) => s.skillId));
    for (const g of c.expected.gaps) {
      // "missing" means no evidence; "weak" and "outdated" need some evidence to judge.
      expect([g.skillId, found.has(g.skillId)]).toEqual([g.skillId, g.status !== "missing"]);
    }
    expect(c.expected.mustNotClaim.filter((id) => found.has(id))).toEqual([]);
  });
});
