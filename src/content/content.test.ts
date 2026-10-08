import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { certifications, normalizeSkillTerm, proofTasks, resources, roleProfiles, skillIdByTerm, skills } from ".";

describe("skill taxonomy", () => {
  it("has unique ids", () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never maps one term to two skills", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const s of skills) {
      for (const term of new Set([s.id, s.name, ...s.aliases].map(normalizeSkillTerm))) {
        const other = owner.get(term);
        if (other && other !== s.id) clashes.push(`"${term}" → ${other} and ${s.id}`);
        owner.set(term, s.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("marks as ambiguous only its own names and aliases", () => {
    const stray = skills.flatMap((s) => {
      const own = new Set([s.name, ...s.aliases].map(normalizeSkillTerm));
      return s.ambiguous.filter((t) => !own.has(normalizeSkillTerm(t))).map((t) => `${s.id}: ${t}`);
    });
    expect(stray).toEqual([]);
  });

  it("implies only known skills, without cycles", () => {
    const byId = new Map(skills.map((s) => [s.id, s]));
    const unknown = skills.flatMap((s) => s.implies.filter((id) => !byId.has(id)).map((id) => `${s.id} → ${id}`));
    expect(unknown).toEqual([]);
    const reaches = (from: string, to: string, seen = new Set<string>()): boolean =>
      (byId.get(from)?.implies ?? []).some((id) => id === to || (!seen.has(id) && (seen.add(id), reaches(id, to, seen))));
    expect(skills.filter((s) => reaches(s.id, s.id)).map((s) => s.id)).toEqual([]);
  });

  it("resolves aliases regardless of case and spacing", () => {
    expect(skillIdByTerm.get(normalizeSkillTerm("  MS  Excel "))).toBe("excel");
    expect(skillIdByTerm.get(normalizeSkillTerm("PySpark"))).toBe("spark");
  });
});

describe("certifications", () => {
  it("has unique ids", () => {
    const ids = certifications.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("role profiles", () => {
  const known = new Set(skills.map((s) => s.id));

  it("includes every file in the roles folder", () => {
    const files = readdirSync(join(__dirname, "roles")).map((f) => f.replace(/\.json$/, ""));
    expect(roleProfiles.map((r) => r.slug).sort()).toEqual(files.sort());
  });

  it.each(roleProfiles.map((r) => [r.slug, r] as const))("%s uses only known skills, once each", (_, role) => {
    const ids = role.skills.map((s) => s.skillId);
    expect(ids.filter((id) => !known.has(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(roleProfiles.map((r) => [r.slug, r] as const))("%s recommends only known certifications, once each", (_, role) => {
    const knownCerts = new Set(certifications.map((c) => c.id));
    const ids = role.certifications.map((c) => c.certId);
    expect(ids.filter((id) => !knownCerts.has(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(roleProfiles.map((r) => [r.slug, r] as const))("%s has at least 5 required skills and a valid band", (_, role) => {
    expect(role.skills.filter((s) => s.importance === "required").length).toBeGreaterThanOrEqual(5);
    expect(role.experienceBand.minYears).toBeLessThan(role.experienceBand.maxYears);
  });
});

describe("resource catalog", () => {
  const known = new Set(skills.map((s) => s.id));
  const roleSkills = [...new Set(roleProfiles.flatMap((r) => r.skills.filter((s) => s.importance === "required").map((s) => s.skillId)))];

  it("has unique URLs", () => {
    const urls = resources.map((r) => r.url);
    expect(urls.filter((u, i) => urls.indexOf(u) !== i)).toEqual([]);
  });

  it("links only to known skills", () => {
    expect(resources.flatMap((r) => r.skillIds.filter((id) => !known.has(id)).map((id) => `${r.url} → ${id}`))).toEqual([]);
  });

  it("lists only free resources without tracking or referral parameters", () => {
    expect(resources.filter((r) => !r.free).map((r) => r.url)).toEqual([]);
    expect(resources.filter((r) => /[?&](utm_[a-z]+|ref|affiliate|aff|couponCode)=/i.test(r.url)).map((r) => r.url)).toEqual([]);
  });

  it("covers every required skill of every role", () => {
    const covered = new Set(resources.flatMap((r) => r.skillIds));
    expect(roleSkills.filter((id) => !covered.has(id))).toEqual([]);
  });

  it("has one fallback proof task for every required skill, and only for known skills", () => {
    const ids = proofTasks.map((t) => t.skillId);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids.filter((id) => !known.has(id))).toEqual([]);
    expect(roleSkills.filter((id) => !ids.includes(id))).toEqual([]);
  });
});
