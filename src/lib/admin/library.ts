import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, resourceReports, resources, resourceSuggestions } from "@/db/schema";
import { skills } from "@/content";
import {
  brokenLinkRow,
  resourceDecisionInput,
  suggestionDecisionInput,
  suggestionRow,
  type BrokenLinkRow,
  type LibraryAdminView,
  type SuggestionRow,
} from "@/lib/schemas";
import type { ProofReviewResult } from "@/lib/schemas/admin";
import { clip } from "@/lib/text";

/*
 * The Library review page's data (/admin/library; docs/plans/library-part-2-plan.md). Broken links: one row per
 * resource with open reports, and links an admin hid, so they can be shown again. Suggestions waiting for a reviewer.
 * The caller has already checked the person is an admin (src/lib/admin/server.ts); these take the admin's user id for
 * the audit line, which carries ids and fixed action names only. No reporter or suggester is shown or logged.
 */

type Db = ReturnType<typeof getDb>;
export type LibraryAdminDeps = { db?: Db; now?: Date };

/** Rows each list shows, oldest first. */
export const ADMIN_LIST_MAX = 200;

const skillNames: ReadonlyMap<string, string> = new Map(skills.map((s) => [s.id, s.name]));

/** Both lists for /admin/library, oldest first, up to 200 each. */
export async function libraryReviewQueue(deps: LibraryAdminDeps = {}): Promise<LibraryAdminView> {
  const db = deps.db ?? getDb();
  const india = (column: unknown) => sql<string>`to_char(${column} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
  const brokenRows = await db.execute<{
    id: string;
    title: string;
    provider: string;
    url: string;
    healthy: boolean;
    hidden: boolean;
    lastChecked: string | null;
    firstReported: string | null;
    broken: number;
    not_free: number;
    outdated: number;
    other: number;
  }>(sql`
    select r.id, r.title, r.provider, r.url, r.healthy, r.hidden_at is not null as hidden,
      ${india(sql`r.last_checked_at`)} as "lastChecked",
      ${india(sql`min(o.created_at)`)} as "firstReported",
      count(o.id) filter (where o.reason = 'broken')::int as broken,
      count(o.id) filter (where o.reason = 'not_free')::int as not_free,
      count(o.id) filter (where o.reason = 'outdated')::int as outdated,
      count(o.id) filter (where o.reason = 'other')::int as other
    from ${resources} r
    left join ${resourceReports} o on o.resource_id = r.id and o.status = 'open'
    where r.hidden_at is not null or exists (select 1 from ${resourceReports} x where x.resource_id = r.id and x.status = 'open')
    group by r.id
    order by min(o.created_at) asc nulls last, r.hidden_at asc nulls last, r.id
    limit ${ADMIN_LIST_MAX}
  `);
  const broken = [...brokenRows].flatMap((r): BrokenLinkRow[] => {
    const parsed = brokenLinkRow.safeParse({
      id: r.id,
      title: clip(r.title, 160),
      provider: clip(r.provider, 60),
      url: r.url,
      counts: { broken: Number(r.broken), not_free: Number(r.not_free), outdated: Number(r.outdated), other: Number(r.other) },
      firstReported: r.firstReported,
      healthy: r.healthy,
      lastChecked: r.lastChecked,
      hidden: r.hidden,
    });
    return parsed.success ? [parsed.data] : [];
  });
  const open = await db
    .select({ id: resourceSuggestions.id, url: resourceSuggestions.url, host: resourceSuggestions.host, skillId: resourceSuggestions.skillId, sent: india(resourceSuggestions.createdAt) })
    .from(resourceSuggestions)
    .where(eq(resourceSuggestions.status, "open"))
    .orderBy(asc(resourceSuggestions.createdAt), asc(resourceSuggestions.id))
    .limit(ADMIN_LIST_MAX);
  const suggestions = open.flatMap((s): SuggestionRow[] => {
    const parsed = suggestionRow.safeParse({ id: s.id, url: s.url, host: s.host, skill: s.skillId ? clip(skillNames.get(s.skillId) ?? s.skillId, 80) : null, sent: s.sent });
    return parsed.success ? [parsed.data] : [];
  });
  return { broken, suggestions };
}

const NOT_AVAILABLE: ProofReviewResult = { ok: false, message: "That isn't available. Refresh the page to see the latest." };

/**
 * Hide link, Show again or Dismiss reports, on one resource. Hiding sets `resources.hidden_at` (the Library, paths and
 * rides leave it out at once) and closes its open reports as hidden; showing again clears it. Dismissing closes the
 * open reports and leaves the link as it is. One audit line per change: admin:<id>, the action, resource:<id>.
 */
export async function decideResource(adminId: string, raw: unknown, deps: LibraryAdminDeps = {}): Promise<ProofReviewResult> {
  const input = resourceDecisionInput.safeParse(raw);
  if (!input.success) return NOT_AVAILABLE;
  const { resourceId, decision } = input.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const actor = `admin:${adminId}`;
  const target = `resource:${resourceId}`;
  return db.transaction(async (tx): Promise<ProofReviewResult> => {
    const [row] = await tx.select({ hiddenAt: resources.hiddenAt }).from(resources).where(eq(resources.id, resourceId)).limit(1).for("update");
    if (!row) return NOT_AVAILABLE;
    const close = (status: "hidden" | "dismissed") =>
      tx
        .update(resourceReports)
        .set({ status, decidedAt: now, decidedBy: adminId })
        .where(and(eq(resourceReports.resourceId, resourceId), eq(resourceReports.status, "open")))
        .returning({ id: resourceReports.id });
    if (decision === "hide") {
      if (!row.hiddenAt) await tx.update(resources).set({ hiddenAt: now }).where(eq(resources.id, resourceId));
      const closed = await close("hidden");
      if (row.hiddenAt && !closed.length) return { ok: true, message: "That link was already hidden." };
      await tx.insert(auditLogs).values({ actor, action: "resource_hidden", target, createdAt: now });
      return { ok: true, message: "Hidden. It has left the Library, paths and rides." };
    }
    if (decision === "show") {
      if (!row.hiddenAt) return { ok: true, message: "That link is already showing." };
      await tx.update(resources).set({ hiddenAt: null }).where(eq(resources.id, resourceId));
      await tx.insert(auditLogs).values({ actor, action: "resource_shown", target, createdAt: now });
      return { ok: true, message: "Showing again in the Library, paths and rides." };
    }
    const closed = await close("dismissed");
    if (!closed.length) return { ok: true, message: "No open reports on that link." };
    await tx.insert(auditLogs).values({ actor, action: "resource_reports_dismissed", target, createdAt: now });
    return { ok: true, message: "Reports dismissed. The link stays as it is." };
  });
}

const DECIDED: Record<"accepted" | "duplicate" | "declined", string> = {
  accepted: "Noted as accepted. Add it to src/content/resources.json in a pull request, so the link check and the free-only review run.",
  duplicate: "Noted as already in the Library.",
  declined: "Declined.",
};

/**
 * Accept, Already in the Library or Decline (with its reason), on one waiting suggestion. Accepting records the
 * decision only: the catalog changes by a pull request to src/content/resources.json. One audit line:
 * admin:<id>, suggestion_<decision>, suggestion:<id>.
 */
export async function decideSuggestion(adminId: string, raw: unknown, deps: LibraryAdminDeps = {}): Promise<ProofReviewResult> {
  const input = suggestionDecisionInput.safeParse(raw);
  if (!input.success) return NOT_AVAILABLE;
  const { suggestionId, decision, declineReason } = input.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx): Promise<ProofReviewResult> => {
    const done = await tx
      .update(resourceSuggestions)
      .set({ status: decision, declineReason, decidedAt: now, decidedBy: adminId })
      .where(and(eq(resourceSuggestions.id, suggestionId), eq(resourceSuggestions.status, "open")))
      .returning({ id: resourceSuggestions.id });
    if (!done.length) return NOT_AVAILABLE;
    await tx.insert(auditLogs).values({ actor: `admin:${adminId}`, action: `suggestion_${decision}`, target: `suggestion:${suggestionId}`, createdAt: now });
    return { ok: true, message: DECIDED[decision] };
  });
}
