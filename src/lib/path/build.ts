import { proofTasks as catalogProofTasks, skills as taxonomy } from "@/content";
import { HOURS_BY_STATUS } from "@/lib/gaps/match";
import { plannedPath, weeklyHours as weeklyHoursSchema, type Gap, type PlannedPath, type PlannedStep } from "@/lib/schemas";

/** FR-15: a path has at most 6 steps and aims to fit in about 6 weeks at the chosen hours. */
export const MAX_STEPS = 6;
export const MAX_WEEKS = 6;
export const MAX_RESOURCES_PER_STEP = 3;

/** The fields of a catalog row (the resources table) the builder needs. */
export type CatalogResource = { id: string; skillIds: string[]; minutes: number; free: boolean; healthy: boolean };

export type PathInput = {
  /** The stored gaps, in the Gaps page's ranking. */
  gaps: Gap[];
  weeklyHours: number;
  resources: CatalogResource[];
  /** Defaults to the skill taxonomy; tests pass their own. */
  skills?: { id: string; implies: string[] }[];
  /** Fallback proof task per skill id. Defaults to the catalog's. */
  proofTasks?: ReadonlyMap<string, string>;
};

const defaultProofTasks = new Map(catalogProofTasks.map((t) => [t.skillId, t.task]));

/**
 * Turns ranked gaps into an ordered, sized path (FR-15, FR-16). Plain code, no model: the order, the hours and the
 * resources are decided here, and the model may only reword each step's reason and proof task afterwards.
 */
export function buildPath(input: PathInput): PlannedPath {
  const weeklyHours = weeklyHoursSchema.parse(input.weeklyHours);
  if (input.gaps.length === 0) throw new Error("buildPath needs at least one gap");
  if (new Set(input.gaps.map((g) => g.skillId)).size !== input.gaps.length) throw new Error("buildPath got a gap twice");
  const implies = new Map((input.skills ?? taxonomy).map((s) => [s.id, s.implies]));
  const proofTasks = input.proofTasks ?? defaultProofTasks;

  const ordered = prerequisitesFirst(input.gaps, implies);
  const budget = weeklyHours * MAX_WEEKS;
  const steps: PlannedStep[] = [];
  const deferredSkillIds: string[] = [];
  const usedResourceIds = new Set<string>();
  let hoursBefore = 0;

  for (const g of ordered) {
    const chosen = pickResources(g, input.resources, usedResourceIds);
    const hours = stepHours(g, chosen);
    // Always keep the first step. After that, stop at 6 steps or at the first step that would end after the last
    // week; everything after it waits too, so a kept step never loses a prerequisite placed before it.
    if (deferredSkillIds.length > 0 || (steps.length > 0 && (steps.length >= MAX_STEPS || hoursBefore + hours > budget))) {
      deferredSkillIds.push(g.skillId);
      continue;
    }
    for (const r of chosen) usedResourceIds.add(r.id);
    steps.push({
      position: steps.length + 1,
      skillId: g.skillId,
      skillName: g.skillName,
      status: g.status,
      hours,
      week: Math.floor(hoursBefore / weeklyHours) + 1,
      resourceIds: chosen.map((r) => r.id),
      reason: g.explanation,
      proofTask: proofTasks.get(g.skillId) ?? templateProofTask(g),
    });
    hoursBefore += hours;
  }

  return plannedPath.parse({
    weeklyHours,
    steps,
    totalHours: hoursBefore,
    weeks: Math.ceil(hoursBefore / weeklyHours),
    deferredSkillIds,
  });
}

/**
 * Keeps the gaps' ranking, except that a gap goes before any gap that builds on it: a skill implies the broader
 * skills it rests on (Next.js → React → JavaScript), so JavaScript is learned before Next.js. When one gap rests on
 * several others, they keep their own ranking among themselves.
 */
export function prerequisitesFirst(gaps: Gap[], implies: ReadonlyMap<string, string[]>): Gap[] {
  const byId = new Map(gaps.map((g) => [g.skillId, g]));
  const rank = new Map(gaps.map((g, i) => [g.skillId, i]));
  // The best rank of any gap reachable from a skill, so a non-gap link in a chain sorts by the gap behind it.
  const reach = new Map<string, number>();
  const reachRank = (id: string, seen: Set<string>): number => {
    const known = reach.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return Infinity;
    seen.add(id);
    const best = Math.min(rank.get(id) ?? Infinity, ...(implies.get(id) ?? []).map((b) => reachRank(b, seen)));
    reach.set(id, best);
    return best;
  };
  const placed = new Set<string>();
  const out: Gap[] = [];
  const place = (skillId: string, visiting: Set<string>) => {
    if (placed.has(skillId) || visiting.has(skillId)) return;
    visiting.add(skillId);
    const broader = [...(implies.get(skillId) ?? [])].sort((a, b) => reachRank(a, new Set()) - reachRank(b, new Set()));
    for (const b of broader) place(b, visiting);
    const g = byId.get(skillId);
    if (g) {
      placed.add(skillId);
      out.push(g);
    }
  };
  for (const g of gaps) place(g.skillId, new Set());
  return out;
}

/**
 * Healthy catalog links for the skill, free first, then shortest: the fewest that cover the gap's estimate, at most 3.
 * A link already used by an earlier step is not repeated.
 */
function pickResources(g: Gap, resources: CatalogResource[], used: ReadonlySet<string>): CatalogResource[] {
  const candidates = resources
    .filter((r) => r.healthy && r.skillIds.includes(g.skillId) && !used.has(r.id))
    .sort((a, b) => Number(b.free) - Number(a.free) || a.minutes - b.minutes || a.id.localeCompare(b.id));
  const chosen: CatalogResource[] = [];
  let minutes = 0;
  for (const r of candidates) {
    if (chosen.length >= MAX_RESOURCES_PER_STEP || minutes >= HOURS_BY_STATUS[g.status] * 60) break;
    chosen.push(r);
    minutes += r.minutes;
  }
  return chosen;
}

/** The resources' length, capped by the Gaps estimate for this kind of gap; the estimate when there are none. */
function stepHours(g: Gap, chosen: CatalogResource[]): number {
  const estimate = HOURS_BY_STATUS[g.status];
  if (chosen.length === 0) return estimate;
  const minutes = chosen.reduce((sum, r) => sum + r.minutes, 0);
  return Math.max(1, Math.min(estimate, Math.ceil(minutes / 60)));
}

function templateProofTask(g: Gap): string {
  return `Make one small piece of work that shows ${g.skillName}, such as a short project or exercise, and keep a link or screenshot to share.`;
}
