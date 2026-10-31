import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withKeyLock } from "@/db/lock";
import { gapAnalyses, profiles, resumes } from "@/db/schema";
import { ownerKey } from "@/lib/owner";
import { SAMPLE_MIME } from "@/lib/resume/sample-mime";
import { destinationChoice } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { currentAnalysis, pickedNow, type Db as ReadDb } from "./current";
import { GAP_LIMITS } from "./store";

/*
 * "Make this my destination" on a role's Gaps page and "Switch back" on the Map (docs/plans/change-destination-plan.md,
 * section 5; C25, Project manager approved on Milin's behalf, 2026-10-31). Opening a Gaps page never switches the
 * destination; only this does. It marks one of the person's own analyses picked now (`chosenAt`, `notChosen` dropped),
 * so it is current, and their goals follow it. No table of its own, no migration. Nothing here is logged.
 */

type Db = ReturnType<typeof getDb>;

export const DESTINATION_ERRORS = ["invalid", "limit", "busy"] as const;
export type DestinationError = (typeof DESTINATION_ERRORS)[number];
/** `changed` is false when the analysis was already the destination: nothing is written. */
export type DestinationResult = { ok: true; changed: boolean } | { ok: false; error: DestinationError };

export const DESTINATION_MESSAGES: Record<DestinationError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many destination changes as we allow in a day. Try again tomorrow.",
  busy: "Your gaps are still being worked out. Please try again in a minute.",
};

/** Only the latest saved version of each resume's profile can be current. */
const latestVersion = sql`${profiles.version} = (select max(p2.version) from profiles p2 where p2.resume_id = ${profiles.resumeId})`;

/**
 * Makes one of the person's own analyses their destination. Taken only for an analysis of the latest saved version of
 * one of their own resumes, never the sample's (a made-up person's) and never anyone else's. Every try counts against
 * the day's DESTINATION_CHANGES_PER_DAY. Runs under the person's Gaps lock, so it never crosses a Gaps page deciding
 * whether a new analysis waits.
 */
export async function makeDestination(userId: string, raw: unknown, deps: { db?: Db; now?: Date } = {}): Promise<DestinationResult> {
  const input = destinationChoice.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { analysisId } = input.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const done = await withKeyLock(db, `cm-gaps:${ownerKey({ userId })}`, GAP_LIMITS.lockTimeoutMs, async (tx): Promise<DestinationResult> => {
    if (!(await takeShared(LIMITS.destinationChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    const [own] = await tx
      .select({ id: gapAnalyses.id })
      .from(gapAnalyses)
      .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
      .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
      .where(and(eq(gapAnalyses.id, analysisId), eq(resumes.userId, userId), latestVersion, sql`${resumes.mimeType} is distinct from ${SAMPLE_MIME}`))
      .limit(1);
    if (!own) return { ok: false, error: "invalid" };
    const current = await currentAnalysis(userId, tx as unknown as ReadDb);
    if (current?.id === analysisId) return { ok: true, changed: false };
    const updated = await tx.update(gapAnalyses).set({ result: pickedNow }).where(eq(gapAnalyses.id, analysisId)).returning({ id: gapAnalyses.id });
    return updated.length === 1 ? { ok: true, changed: true } : { ok: false, error: "invalid" };
  });
  return done === "busy" ? { ok: false, error: "busy" } : done;
}
