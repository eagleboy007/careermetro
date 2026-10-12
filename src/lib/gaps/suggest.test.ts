import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import type { Profile } from "@/lib/schemas";
import { MIN_SHARE, suggestRoles } from "./suggest";

const now = new Date("2026-10-12T00:00:00Z");
const profile = (patch: Partial<Profile>): Profile => ({
  headline: null,
  totalYearsExperience: null,
  roles: [],
  skills: [],
  education: [],
  certifications: [],
  ...patch,
});
const skill = (name: string, line: string) => ({ name, lastUsed: "2026-05", evidence: [line] });

// A fresher with coding projects: the case Milin tested (2026-10-12).
const fresher = profile({
  totalYearsExperience: 0,
  skills: [
    skill("JavaScript", "Built a React and JavaScript to-do app with a Node.js and Express API"),
    skill("React", "Built a React and JavaScript to-do app with a Node.js and Express API"),
    skill("Node.js", "Built a React and JavaScript to-do app with a Node.js and Express API"),
    skill("HTML", "Made a portfolio site in HTML and CSS"),
    skill("CSS", "Made a portfolio site in HTML and CSS"),
    skill("Git", "Kept all projects on GitHub using Git branches and pull requests"),
    skill("SQL", "Stored tasks in PostgreSQL and wrote SQL queries for reports"),
  ],
});

describe("suggestRoles", () => {
  it("suggests up to 3 roles, best covered first, with the skills that earned them", () => {
    const out = suggestRoles(fresher, roleProfiles, now);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(3);
    const slugs = out.map((s) => s.slug);
    expect(slugs.some((s) => ["frontend-developer", "full-stack-developer"].includes(s))).toBe(true);
    for (const s of out) {
      expect(s.met).toBeGreaterThan(0);
      expect(s.met / s.total).toBeGreaterThanOrEqual(MIN_SHARE);
      expect(s.shown.length).toBeGreaterThan(0);
      expect(s.shown.length).toBeLessThanOrEqual(3);
    }
    // Fitting roles come first, and within them the better covered.
    const fitting = out.filter((s) => s.fits);
    expect(out.slice(0, fitting.length)).toEqual(fitting);
    for (let i = 1; i < fitting.length; i++) expect(fitting[i - 1].met / fitting[i - 1].total).toBeGreaterThanOrEqual(fitting[i].met / fitting[i].total);
  });

  it("never puts a senior role ahead of a fitting one for a fresher", () => {
    const out = suggestRoles(fresher, roleProfiles, now);
    const firstSenior = out.findIndex((s) => !s.fits);
    if (firstSenior >= 0) expect(out.slice(firstSenior).every((s) => !s.fits)).toBe(true);
    expect(out[0].fits).toBe(true);
  });

  it("is stable: the same resume gives the same suggestions", () => {
    expect(suggestRoles(fresher, roleProfiles, now)).toEqual(suggestRoles(fresher, roleProfiles, now));
  });

  it("suggests nothing when no role is covered enough", () => {
    expect(suggestRoles(profile({ skills: [skill("Cooking", "Cooked for a family of four")] }), roleProfiles, now)).toEqual([]);
  });
});
