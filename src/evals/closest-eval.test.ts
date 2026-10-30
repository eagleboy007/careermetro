import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { matchProfile } from "@/lib/gaps/match";
import { nearbyLinesFor } from "@/lib/nearby/build";
import { loadEvalCases } from "./cases";
import { expectedProfile } from "./matcher-eval";

type Families = { families: Record<string, string[]>; neighbours: [string, string][]; alsoNear: [string, string][] };
const data = JSON.parse(readFileSync(join(process.cwd(), "fixtures/evals/closest/role-families.json"), "utf8")) as Families;
const familyOf = new Map(Object.entries(data.families).flatMap(([family, slugs]) => slugs.map((slug) => [slug, family] as const)));
const near = (a: string, b: string) => a === b || data.neighbours.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const NOW = new Date("2026-10-07T00:00:00Z");

/**
 * Closest-role eval: for each synthetic fixture resume, the role Nearby names first (its first line, or the closest
 * role when none is near) must sit in the target role's family or a neighbouring one. An analyst resume landing on
 * RPA Developer fails. Free and deterministic; every new role batch runs against it.
 */
describe("closest-role eval", () => {
  it("puts every live role in exactly one family", () => {
    const counts = new Map<string, number>();
    for (const slugs of Object.values(data.families)) for (const s of slugs) counts.set(s, (counts.get(s) ?? 0) + 1);
    expect(roleProfiles.filter((r) => counts.get(r.slug) !== 1).map((r) => r.slug)).toEqual([]);
    expect([...counts.keys()].filter((s) => !roleProfiles.some((r) => r.slug === s))).toEqual([]);
    for (const [a, b] of data.neighbours) expect([a in data.families, b in data.families]).toEqual([true, true]);
    for (const [a, b] of data.alsoNear) expect([familyOf.has(a), familyOf.has(b)]).toEqual([true, true]);
  });

  // One test per fixture resume, so each gets its own time budget as batches grow, and a miss names its case.
  it.each(loadEvalCases().map((c) => [c.id, c] as const))("names a role from the same or a neighbouring family for %s", (_, c) => {
    const { lines, closest } = nearbyLinesFor({ profile: expectedProfile(c), targetSlug: c.roleSlug, now: NOW });
    const top = lines[0]?.slug ?? closest?.slug;
    if (!top) return;
    const want = familyOf.get(c.roleSlug) ?? "?";
    const got = familyOf.get(top) ?? "?";
    const reviewed = data.alsoNear.some(([from, to]) => from === c.roleSlug && to === top);
    if (near(want, got) || reviewed) return;
    // The roles sharing most, so a miss shows what the ranking passed over.
    const others = roleProfiles
      .filter((r) => r.slug !== c.roleSlug)
      .map((r) => ({ slug: r.slug, m: matchProfile(expectedProfile(c), r, NOW) }))
      .sort((a, b) => b.m.met.length - a.m.met.length)
      .slice(0, 4)
      .map((o) => `${o.slug} ${o.m.met.length}/${o.m.readiness.requiredTotal}`);
    throw new Error(`${c.roleSlug} (${want}) -> ${top} (${got}) ${lines.length ? "near" : "closest"}; most shared: ${others.join(", ")}`);
  });
});
