import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gapAnalyses, profiles, resumes } from "@/db/schema";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { gapAnalysis, type GapAnalysis } from "@/lib/schemas";

export type Db = Pick<ReturnType<typeof getDb>, "select">;

/**
 * The person's current gap analysis: the newest one made by today's matcher from the latest saved version of one of
 * their resumes' profiles. Null when there is none, or it no longer reads.
 */
export async function currentAnalysis(userId: string, db: Db = getDb()): Promise<{ id: string; resumeId: string; result: GapAnalysis } | null> {
  const [row] = await db
    .select({ id: gapAnalyses.id, result: gapAnalyses.result, resumeId: resumes.id })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(
      and(
        eq(resumes.userId, userId),
        eq(gapAnalyses.matcherVersion, MATCHER_VERSION),
        sql`${profiles.version} = (select max(p2.version) from profiles p2 where p2.resume_id = ${profiles.resumeId})`,
      ),
    )
    .orderBy(desc(gapAnalyses.createdAt))
    .limit(1);
  const parsed = row ? gapAnalysis.safeParse(row.result) : null;
  return row && parsed?.success ? { id: row.id, resumeId: row.resumeId, result: parsed.data } : null;
}
