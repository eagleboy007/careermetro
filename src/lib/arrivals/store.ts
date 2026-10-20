import "server-only";
import { getDb } from "@/db";
import { skillGroupMembers } from "@/content";
import { closedJobRequirements } from "@/lib/corporate/applications-store";
import type { MyApplicationView } from "@/lib/corporate/types";
import { swappedSkill } from "@/lib/goals/not-for-me";
import { goalsOf, provedSkills } from "@/lib/goals/store";
import { mapLineFor } from "@/lib/map/store";
import { goalLinksFor, type GoalLink } from "./goal-link";

type Db = ReturnType<typeof getDb>;

/**
 * For each closed application, the goal on the person's line its job asked for, numbered as on the Map (v44 gap list
 * item 47). Read only when something closed; nothing without a line (no current gap analysis). The person's goals are
 * read (without writing) for their "Not for me" swaps. The proved skills are read too: a job's "one of these" group can
 * be met by a skill that isn't on the line at all, which no goal's `proved` shows.
 */
export async function closedGoalLinks(userId: string, applications: readonly MyApplicationView[], now: Date, db: Db = getDb()): Promise<Record<string, GoalLink>> {
  if (!applications.some((a) => !a.withdrawn && a.stage === "not_this_time")) return {};
  const line = await mapLineFor(userId, db, now);
  if (!line) return {};
  const [closed, goals, proved] = await Promise.all([closedJobRequirements(userId, db), goalsOf(userId, db), provedSkills(userId, db)]);
  const bySkill = new Map(goals.filter((g) => g.source === "gap").map((g) => [g.skillId, g]));
  const lineGoals = line.goals.map((g) => {
    const own = bySkill.get(g.skillId);
    return { ...g, learns: (own && !g.proved ? swappedSkill(own, skillGroupMembers) : null) ?? g.skillId };
  });
  return goalLinksFor(closed, lineGoals, new Set(proved));
}
