import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gapAnalyses, profiles, resumes } from "@/db/schema";
import { SAMPLE_MIME } from "@/lib/resume/sample-mime";
import { gapAnalysis, type GapAnalysis } from "@/lib/schemas";

export type Db = Pick<ReturnType<typeof getDb>, "select">;

/** What `currentAnalysis` returns: a page that read it once can hand it on instead of reading it again. */
export type CurrentAnalysis = { id: string; resumeId: string; result: GapAnalysis };

/**
 * When the person last picked an analysis's role as their destination: `chosenAt` once they came back to it from the
 * Gaps page (docs/plans/change-destination-plan.md), else when it was made. Only a well-formed date is cast, so a
 * value that isn't one never breaks the read.
 */
export const pickedAt = sql`coalesce(case when ${gapAnalyses.result}->>'chosenAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (${gapAnalyses.result}->>'chosenAt')::timestamptz end, ${gapAnalyses.createdAt})`;

/** Only the latest saved version of each resume's profile counts. */
const latestVersion = sql`${profiles.version} = (select max(p2.version) from profiles p2 where p2.resume_id = ${profiles.resumeId})`;

/**
 * The person's current gap analysis from the latest saved version of one of their resumes' profiles: the one picked
 * last (`pickedAt`), whichever matcher made it: an older matcher's analysis stands until the Gaps page carries it over
 * or replaces it, so a matcher update never empties Today, Map or Me. Null when there is none, or it no longer reads.
 */
export async function currentAnalysis(userId: string, db: Db = getDb()): Promise<CurrentAnalysis | null> {
  const [row] = await db
    .select({ id: gapAnalyses.id, result: gapAnalyses.result, resumeId: resumes.id })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(and(eq(resumes.userId, userId), latestVersion))
    // Picked last first, so the latest resume or the role the person came back to wins; an older matcher's row is
    // only ever replaced by a newer one.
    .orderBy(desc(pickedAt), desc(gapAnalyses.createdAt))
    .limit(1);
  const parsed = row ? gapAnalysis.safeParse(row.result) : null;
  return row && parsed?.success ? { id: row.id, resumeId: row.resumeId, result: parsed.data } : null;
}

/**
 * The person's destination before the current one (handoff section 14, open decision 5): of their analyses for
 * another role, the one picked last, from the latest saved version of one of their own resumes (never the sample,
 * which is a made-up person's). Null when they never changed role, or it no longer reads.
 */
export async function previousAnalysis(
  userId: string,
  current: { id: string; result: Pick<GapAnalysis, "roleSlug"> },
  db: Db = getDb(),
): Promise<{ id: string; result: GapAnalysis } | null> {
  const [row] = await db
    .select({ id: gapAnalyses.id, result: gapAnalyses.result })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(
      and(
        eq(resumes.userId, userId),
        latestVersion,
        ne(gapAnalyses.id, current.id),
        sql`${gapAnalyses.result}->>'roleSlug' <> ${current.result.roleSlug}`,
        sql`${resumes.mimeType} is distinct from ${SAMPLE_MIME}`,
      ),
    )
    .orderBy(desc(pickedAt), desc(gapAnalyses.createdAt))
    .limit(1);
  const parsed = row ? gapAnalysis.safeParse(row.result) : null;
  return row && parsed?.success ? { id: row.id, result: parsed.data } : null;
}
