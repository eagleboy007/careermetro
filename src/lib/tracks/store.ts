import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gapAnalyses, profiles, resumes } from "@/db/schema";
import { roleProfiles } from "@/content";
import { currentAnalysis, type Db as ReadDb } from "@/lib/gaps/current";
import { lockPerson } from "@/lib/goals/store";
import { unreviewedAllowed } from "@/lib/mock/rules";
import { trackChoice, type GapAnalysis, type RoleProfile, type RoleTrack } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { allowedTracks, applyTrack } from "./apply";

/*
 * The person's track of their goal role (docs/plans/tracks-plan.md). No table of its own: the choice is kept as
 * `trackId` in the person's current gap analysis, and read back from the newest of their analyses for that role that
 * has one, so it stays with the role across a new resume. Only tracks the deployment offers count (reviewed ones in
 * production, where none are yet), so production reads nothing and stays on the whole role. Nothing here is logged.
 */

type Db = ReturnType<typeof getDb>;

export type TrackedAnalysis = {
  id: string;
  resumeId: string;
  /** The analysis as the track sees it: what Today's ride, Your goals and the Map's line are made from. */
  result: GapAnalysis;
  /** The analysis as stored, for the whole role: the picker works every track out from it. */
  base: GapAnalysis;
  role: RoleProfile | null;
  /** The track in use; null for the whole role. */
  track: RoleTrack | null;
  /** The tracks this deployment offers for the role. */
  tracks: RoleTrack[];
};

/** The person's saved track id for a role: the newest analysis of theirs for it that has one. Null for none or the whole role. */
export async function savedTrackId(userId: string, roleSlug: string, db: ReadDb = getDb()): Promise<string | null> {
  const [row] = await db
    .select({ trackId: sql<string | null>`${gapAnalyses.result}->>'trackId'` })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(and(eq(resumes.userId, userId), sql`${gapAnalyses.result}->>'roleSlug' = ${roleSlug}`, sql`${gapAnalyses.result} -> 'trackId' is not null`))
    .orderBy(desc(gapAnalyses.createdAt))
    .limit(1);
  return row?.trackId ?? null;
}

/**
 * The person's current analysis with their track applied (./apply.ts). Null before there is one. With no tracks on
 * offer for the role, or none chosen, `result` is the analysis as stored.
 */
export async function trackedCurrentAnalysis(userId: string, db: ReadDb = getDb(), allowUnreviewed = unreviewedAllowed()): Promise<TrackedAnalysis | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const role = roleProfiles.find((r) => r.slug === analysis.result.roleSlug) ?? null;
  const tracks = role ? allowedTracks(role.slug, allowUnreviewed) : [];
  const id = role && tracks.length ? await savedTrackId(userId, role.slug, db) : null;
  const track = tracks.find((t) => t.id === id) ?? null;
  return { ...analysis, base: analysis.result, result: role ? applyTrack(analysis.result, role, track) : analysis.result, role, track, tracks };
}

export const TRACK_ERRORS = ["invalid", "limit"] as const;
export type TrackError = (typeof TRACK_ERRORS)[number];
export type TrackResult = { ok: true; trackId: string | null } | { ok: false; error: TrackError };

export const TRACK_MESSAGES: Record<TrackError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many track changes as we allow in a day. Try again tomorrow.",
};

/**
 * "Switch track" on Your goals: saves a track of the person's goal role (or null for the whole role) on their current
 * analysis, under the person's goal lock, counting the try against the day's TRACK_CHANGES_PER_DAY. Only a track this
 * deployment offers for that role is taken. Writes only the person's own analysis.
 */
export async function setTrack(userId: string, raw: unknown, deps: { db?: Db; now?: Date; allowUnreviewed?: boolean } = {}): Promise<TrackResult> {
  const choice = trackChoice.safeParse(raw);
  if (!choice.success) return { ok: false, error: "invalid" };
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const allowUnreviewed = deps.allowUnreviewed ?? unreviewedAllowed();
  return db.transaction(async (tx): Promise<TrackResult> => {
    await lockPerson(tx, userId);
    if (!(await takeShared(LIMITS.trackChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    const analysis = await currentAnalysis(userId, tx as unknown as ReadDb);
    if (!analysis) return { ok: false, error: "invalid" };
    const tracks = allowedTracks(analysis.result.roleSlug, allowUnreviewed);
    if (!tracks.length || (choice.data !== null && !tracks.some((t) => t.id === choice.data))) return { ok: false, error: "invalid" };
    const own = tx.select({ id: profiles.id }).from(profiles).innerJoin(resumes, eq(resumes.id, profiles.resumeId)).where(eq(resumes.userId, userId));
    const updated = await tx
      .update(gapAnalyses)
      .set({ result: { ...analysis.result, trackId: choice.data } })
      .where(and(eq(gapAnalyses.id, analysis.id), inArray(gapAnalyses.profileId, own)))
      .returning({ id: gapAnalyses.id });
    return updated.length === 1 ? { ok: true, trackId: choice.data } : { ok: false, error: "invalid" };
  });
}
