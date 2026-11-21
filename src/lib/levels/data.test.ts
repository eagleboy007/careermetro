import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { LEVELS } from "@/lib/schemas/levels";
import { levels, roleLevels } from "./data";

describe("level data", () => {
  it("lists the eight levels in order, each starting no earlier than the one before", () => {
    expect(levels.levels.map((l) => l.level)).toEqual([...LEVELS]);
    for (let i = 1; i < levels.levels.length; i++) {
      expect(levels.levels[i].typicalYears.min).toBeGreaterThanOrEqual(levels.levels[i - 1].typicalYears.min);
    }
  });

  it("gives every role profile a level, and names no other role", () => {
    expect(Object.keys(roleLevels).sort()).toEqual(roleProfiles.map((r) => r.slug).sort());
  });

  it("keeps a role's other level one step from its level", () => {
    for (const [slug, r] of Object.entries(roleLevels)) {
      if (!r.alsoLevel) continue;
      const gap = Math.abs(LEVELS.indexOf(r.alsoLevel) - LEVELS.indexOf(r.level));
      expect(gap, slug).toBe(1);
    }
  });

  it("has Director roles at L7, so a 13-year manager has a next step", () => {
    expect(Object.values(roleLevels).filter((r) => r.level === "L7").length).toBeGreaterThanOrEqual(8);
  });

  it("offers each title once, ignoring case", () => {
    const names = levels.titles.flatMap((t) => [t.title, ...t.variants]).map((t) => t.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
