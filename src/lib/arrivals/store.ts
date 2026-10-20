import "server-only";
import { getDb } from "@/db";
import { closedJobRequirements } from "@/lib/corporate/applications-store";
import type { MyApplicationView } from "@/lib/corporate/types";
import { provedSkills } from "@/lib/goals/store";
import { mapLineFor } from "@/lib/map/store";
import { goalLinksFor, type GoalLink } from "./goal-link";

type Db = ReturnType<typeof getDb>;

/**
 * For each closed application, the goal on the person's line its job asked for, numbered as on the Map (v44 gap list
 * item 47). Read only when something closed; nothing without a line (no current gap analysis).
 */
export async function closedGoalLinks(userId: string, applications: readonly MyApplicationView[], now: Date, db: Db = getDb()): Promise<Record<string, GoalLink>> {
  if (!applications.some((a) => !a.withdrawn && a.stage === "not_this_time")) return {};
  const [closed, line, proved] = await Promise.all([closedJobRequirements(userId, db), mapLineFor(userId, db, now), provedSkills(userId, db)]);
  return line ? goalLinksFor(closed, line.goals, new Set(proved)) : {};
}
