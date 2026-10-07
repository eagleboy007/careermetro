import "server-only";
import { and, desc, eq, gt, isNotNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles, resumes } from "@/db/schema";
import type { Profile } from "@/lib/schemas";
import { ANONYMOUS_TTL_HOURS } from "@/lib/session";

type Db = ReturnType<typeof getDb>;

export type ResumeForReview = { resumeId: string; profileId: string; version: number; confirmed: boolean; profile: Profile };

/**
 * The latest profile of a resume, only if it belongs to this anonymous session. Anyone else gets null, as if it
 * didn't exist. Anonymous resumes past their 24 hours are hidden even before the daily cleanup deletes them (FR-2).
 */
export async function getResumeForSession(resumeId: string, sessionId: string, db: Db = getDb()): Promise<ResumeForReview | null> {
  if (!/^[0-9a-f-]{36}$/i.test(resumeId)) return null;
  const [row] = await db
    .select({ profileId: profiles.id, version: profiles.version, confirmed: profiles.confirmedByUser, data: profiles.data })
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
  return row ? { resumeId, profileId: row.profileId, version: row.version, confirmed: row.confirmed, profile: row.data } : null;
}

/** A resume keeps at most this many profile versions; each save adds one. */
export const MAX_PROFILE_VERSIONS = 20;

export type ConfirmResult = { ok: true; version: number } | { ok: false; reason: "not_found" | "conflict" | "too_many" };

/**
 * FR-6: saves the user's corrected profile as a new confirmed version.
 * Evidence quotes and highlights are kept only if the parsed profile already had them: the user can remove
 * them but not add new ones, so every quote still comes from the resume (AI-5).
 */
export async function confirmProfile(resumeId: string, sessionId: string, profile: Profile, db: Db = getDb()): Promise<ConfirmResult> {
  const current = await getResumeForSession(resumeId, sessionId, db);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.version >= MAX_PROFILE_VERSIONS) return { ok: false, reason: "too_many" };

  const known = new Set([...current.profile.roles.flatMap((r) => r.highlights), ...current.profile.skills.flatMap((s) => s.evidence)]);
  const data: Profile = {
    ...profile,
    roles: profile.roles.map((r) => ({ ...r, highlights: r.highlights.filter((h) => known.has(h)) })),
    skills: profile.skills.map((s) => ({ ...s, evidence: s.evidence.filter((q) => known.has(q)) })),
  };
  const version = current.version + 1;
  try {
    await db.insert(profiles).values({ resumeId, version, data, confirmedByUser: true });
  } catch (error) {
    // 23505: another save took this version number first, for example from a second tab.
    const code = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
    if (code === "23505") return { ok: false, reason: "conflict" };
    throw error;
  }
  return { ok: true, version };
}
