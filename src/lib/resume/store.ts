import "server-only";
import { and, desc, eq, gt, isNotNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles, resumes } from "@/db/schema";
import type { Profile } from "@/lib/schemas";
import { ANONYMOUS_TTL_HOURS } from "@/lib/session";

type Db = ReturnType<typeof getDb>;

export type ResumeForReview = { resumeId: string; version: number; confirmed: boolean; profile: Profile };

/**
 * The latest profile of a resume, only if it belongs to this anonymous session. Anyone else gets null, as if it
 * didn't exist. Anonymous resumes past their 24 hours are hidden even before the daily cleanup deletes them (FR-2).
 */
export async function getResumeForSession(resumeId: string, sessionId: string, db: Db = getDb()): Promise<ResumeForReview | null> {
  if (!/^[0-9a-f-]{36}$/i.test(resumeId)) return null;
  const [row] = await db
    .select({ version: profiles.version, confirmed: profiles.confirmedByUser, data: profiles.data })
    .from(profiles)
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(
      and(
        eq(resumes.id, resumeId),
        eq(resumes.anonymousSessionId, sessionId),
        or(gt(resumes.createdAt, new Date(Date.now() - ANONYMOUS_TTL_HOURS * 3600_000)), isNotNull(resumes.userId)),
      ),
    )
    .orderBy(desc(profiles.version))
    .limit(1);
  return row ? { resumeId, version: row.version, confirmed: row.confirmed, profile: row.data } : null;
}

/** FR-6: saves the user's corrected profile as a new confirmed version. Returns the new version, or null if not theirs. */
export async function confirmProfile(resumeId: string, sessionId: string, profile: Profile, db: Db = getDb()): Promise<number | null> {
  const current = await getResumeForSession(resumeId, sessionId, db);
  if (!current) return null;
  const version = current.version + 1;
  await db.insert(profiles).values({ resumeId, version, data: profile, confirmedByUser: true });
  return version;
}
