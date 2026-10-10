import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inflections } from "@/lib/gaps/match";
import { normalizeForMatch } from "@/lib/resume/verify";
import { MAX_GAPS, requiredUnits, skillGroups } from "@/lib/schemas";
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

  it("never reads one term's plural or spelling as another skill", () => {
    const owner = new Map<string, string>();
    for (const s of skills) for (const t of [s.name, ...s.aliases]) owner.set(normalizeForMatch(t), s.id);
    const clashes = skills.flatMap((s) =>
      [s.name, ...s.aliases].flatMap((t) =>
        inflections(normalizeForMatch(t)).flatMap((v) => {
          const other = owner.get(v);
          if (other && other !== s.id) return [`"${v}" → ${other} and ${s.id}`];
          owner.set(v, s.id);
          return [];
        }),
      ),
    );
    expect(clashes).toEqual([]);
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

  it("proves and touches only known skills, never the same skill both ways", () => {
    const known = new Set(skills.map((s) => s.id));
    const bad = certifications.flatMap((c) => [
      ...[...c.proves, ...c.partial].filter((id) => !known.has(id)).map((id) => `${c.id}: unknown ${id}`),
      ...c.proves.filter((id) => c.partial.includes(id)).map((id) => `${c.id}: ${id} in both`),
    ]);
    expect(bad).toEqual([]);
  });

  it("never gives one alias to two certifications", () => {
    const seen = new Map<string, string>();
    const clashes = certifications.flatMap((c) =>
      [c.name, ...c.aliases].map(normalizeSkillTerm).flatMap((t) => {
        const other = seen.get(t);
        seen.set(t, c.id);
        return other && other !== c.id ? [`${t}: ${other} and ${c.id}`] : [];
      }),
    );
    expect(clashes).toEqual([]);
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

  it("gives a group id the same skills in every role, so a goal's group means one set", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const r of roleProfiles) {
      for (const g of skillGroups(r)) {
        const set = [...g.skillIds].sort().join(",");
        if (seen.has(g.id) && seen.get(g.id) !== set) clashes.push(`${r.slug}: ${g.id}`);
        seen.set(g.id, seen.get(g.id) ?? set);
      }
    }
    expect(clashes).toEqual([]);
  });

  it.each(roleProfiles.map((r) => [r.slug, r] as const))("%s has at least 5 required skills and a valid band", (_, role) => {
    // A "one of these" group counts as one required skill.
    const units = requiredUnits(role);
    expect(units.length).toBeGreaterThanOrEqual(5);
    expect(units.length).toBeLessThanOrEqual(MAX_GAPS);
    // Context skills (communication) are never gaps, so every role keeps five it can score.
    const context = new Set(skills.filter((s) => s.scoring === "context").map((s) => s.id));
    expect(units.filter((u) => u.some((id) => !context.has(id))).length).toBeGreaterThanOrEqual(5);
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
