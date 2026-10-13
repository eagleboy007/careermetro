import "server-only";
import { sql } from "drizzle-orm";
import { roleProfiles } from "@/content";
import { getDb } from "@/db";
import { roleRequests } from "@/db/schema";
import { errorFields, logEvent } from "@/lib/log";
import { ownerKey, type Owner } from "@/lib/owner";
import { roleRequestTitle } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";

type Db = ReturnType<typeof getDb>;

export type RoleRequestOutcome = "counted" | "repeat" | "limit" | "skipped" | "known" | "failed";

/** Our library's titles as role_requests would spell them, so a role we have is never counted as missing. */
const libraryTitles = new Set(roleProfiles.flatMap((r) => roleRequestTitle.safeParse(r.title).data ?? []));

/**
 * Counts a role someone looked for and we don't have (role-suggest-plan.md part B): the typed title, normalised, in
 * role_requests, with nothing about the person. One person counts a title at most once a day and at most
 * LIMITS.roleRequestsPerOwner titles a day (shared limits, so every server agrees). Never throws: counting is a side
 * note, so a failure is logged by name and the caller goes on. The title is never logged.
 */
export async function countRoleRequest(rawTitle: string, owner: Owner, deps: { db?: Db; now?: number } = {}): Promise<RoleRequestOutcome> {
  const parsed = roleRequestTitle.safeParse(rawTitle);
  if (!parsed.success) return "skipped";
  const title = parsed.data;
  if (libraryTitles.has(title)) return "known";
  const who = ownerKey(owner);
  // The repeat check comes first, so searching for the same role again doesn't use up the person's daily count.
  if (!(await takeShared(LIMITS.roleRequestTitlePerOwner, `${who}|${title}`, deps))) return "repeat";
  if (!(await takeShared(LIMITS.roleRequestsPerOwner, who, deps))) return "limit";
  try {
    await (deps.db ?? getDb())
      .insert(roleRequests)
      .values({ title })
      .onConflictDoUpdate({ target: roleRequests.title, set: { count: sql`${roleRequests.count} + 1`, lastSeen: sql`now()` } });
    return "counted";
  } catch (error) {
    logEvent("error", "role_request_failed", errorFields(error));
    return "failed";
  }
}
