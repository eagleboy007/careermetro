import { roleProfiles } from "@/content";
import type { MapGoal, MapLine, NearbyLine } from "@/lib/schemas";

const MAX_OTHER_LINES = 2;

/**
 * The other role lines that cross the person's line, one per goal, at most two so their labels never collide. Nearby
 * lines come first, as interchanges (dev/nearby-lines-plan.md): each crosses at the latest goal on the line that it
 * also needs. Free places then go to other roles that need one of the line's gap skills, the roles sharing the most
 * gaps first. A Nearby line that finds no free goal is not drawn as a plain other line. Plain code, no database, so the
 * example data uses it too. The people at a crossing come from On your line (src/lib/map/riders.ts), in its panel only.
 */
export function otherLines(
  roleSlug: string,
  goals: Pick<MapGoal, "skillId">[],
  nearby: { lines: Pick<NearbyLine, "slug" | "title" | "crossSkillIds">[] } = { lines: [] },
): MapLine["otherLines"] {
  const gapIds = goals.map((g) => g.skillId);
  const used = new Set<string>();
  const out: MapLine["otherLines"] = [];
  for (const n of nearby.lines) {
    const at = [...n.crossSkillIds].reverse().find((id) => gapIds.includes(id) && !used.has(id));
    if (!at) continue;
    used.add(at);
    out.push({ slug: n.slug, title: n.title, skillId: at, nearby: true });
    if (out.length === MAX_OTHER_LINES) return out;
  }
  const nearbySlugs = new Set(nearby.lines.map((n) => n.slug));
  const candidates = roleProfiles
    .filter((r) => r.slug !== roleSlug && !nearbySlugs.has(r.slug))
    .map((r) => {
      const required = new Set(r.skills.filter((s) => s.importance === "required").map((s) => s.skillId));
      return { role: r, shared: gapIds.filter((id) => required.has(id)) };
    })
    .filter((c) => c.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length || a.role.title.localeCompare(b.role.title));
  for (const c of candidates) {
    // Cross late on the line, where fewer labels sit, at a goal no other line uses.
    const at = [...c.shared].reverse().find((id) => !used.has(id));
    if (!at) continue;
    used.add(at);
    out.push({ slug: c.role.slug, title: c.role.title, skillId: at });
    if (out.length === MAX_OTHER_LINES) break;
  }
  return out;
}
