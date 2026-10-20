import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gapAnalyses, profiles, resumes } from "@/db/schema";
import { ownerKey, ownsResume, type Owner } from "@/lib/owner";
import { profile as profileSchema, type Profile } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import parsed from "../../../fixtures/sample-resume/priya-sharma.parsed.json";
import type { IngestResult } from "./ingest";
import { isSampleResume, SAMPLE_MIME } from "./sample-mime";

export { SAMPLE_MIME, isSampleResume } from "./sample-mime";

type Db = ReturnType<typeof getDb>;

/**
 * "Try a sample resume" (v44 gap item 3): the parsed result of the synthetic resume in fixtures/resumes/priya-sharma.txt,
 * worked out once and checked in (fixtures/sample-resume/priya-sharma.parsed.json), so a click never calls the model.
 * The name printed on it is dropped here, as a real parse drops it after the name check: nothing keeps it.
 */
export function sampleProfile(): Profile {
  return profileSchema.parse(parsed);
}

/** T114: the person's own resume, once its gaps were seen, is never quietly replaced by the sample. */
export const HAS_OWN_RESUME: IngestResult = { ok: false, status: 409, code: "has_resume", message: "You already have your own resume. Open it from your Map." };

const RATE_LIMITED: IngestResult = {
  ok: false,
  status: 429,
  code: "rate_limited",
  message: "You've tried the sample resume a lot today. Please try again tomorrow, or upload your own.",
};

/**
 * Makes the sample resume the person's resume, the same way an upload ends after its parse: a "parsed" resume row
 * with an unconfirmed profile, then the normal confirm, gaps and path steps. It skips what a real upload needs and a
 * sample doesn't: no file is read or kept, no model call is made or logged in ai_calls, no AI budget is spent, and no
 * resume consent is asked for, since none of the person's data is read. The row is marked by its MIME type
 * (SAMPLE_MIME), like the builder's, so every screen that shows the resume can label it "Sample". It carries no name
 * hashes: the sample isn't anyone's, so it never fails the name check when an anonymous visitor signs up. An owner
 * who already has a sample gets that one back, so trying it again never piles up rows. Their own resume takes over
 * once they check it and see its gaps, like any newer upload; from then on the sample is refused (HAS_OWN_RESUME).
 */
export async function createSampleResume(input: { owner: Owner; clientHash: string }, deps: { db?: Db } = {}): Promise<IngestResult> {
  const db = deps.db ?? getDb();
  // Someone whose own resume already has gaps never gets the sample (T114): picking a role on it would make the
  // made-up person current again and quietly take them out of Find people and Express apply. Checked first, so a
  // refused try uses none of the limits.
  if (await hasOwnAnalysis(input.owner, db)) return HAS_OWN_RESUME;
  // Its own limits, so trying the sample never uses up a real upload (LIMITS.perOwnerPerDay in ingest.ts). The address
  // first: a script making new anonymous sessions is stopped there.
  if (!(await takeShared(LIMITS.sampleResumesPerIp, input.clientHash, { db }))) return RATE_LIMITED;
  if (!(await takeShared(LIMITS.sampleResumesPerOwner, ownerKey(input.owner), { db }))) return RATE_LIMITED;

  const data = sampleProfile();
  const resumeId = await db.transaction(async (tx) => {
    // One sample per owner: a second try opens the one they have (an anonymous one only within its 24 hours). The
    // lock stops a double click making two.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-sample:${ownerKey(input.owner)}`}))`);
    const [mine] = await tx
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(ownsResume(input.owner), eq(resumes.mimeType, SAMPLE_MIME)))
      .orderBy(desc(resumes.createdAt))
      .limit(1);
    if (mine) return mine.id;
    const [resume] = await tx
      .insert(resumes)
      .values({
        userId: input.owner.userId ?? null,
        anonymousSessionId: input.owner.sessionId ?? null,
        clientHash: input.clientHash,
        mimeType: SAMPLE_MIME,
        sizeBytes: Buffer.byteLength(JSON.stringify(data)),
        status: "parsed",
      })
      .returning({ id: resumes.id });
    await tx.insert(profiles).values({ resumeId: resume.id, version: 1, data, aiCallId: null });
    return resume.id;
  });
  return { ok: true, resumeId };
}

/** Whether the owner has a resume of their own (not the sample) with a gap analysis. */
export async function hasOwnAnalysis(owner: Owner, db: Pick<Db, "select">): Promise<boolean> {
  const [row] = await db
    .select({ id: gapAnalyses.id })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(and(ownsResume(owner), sql`${resumes.mimeType} is distinct from ${SAMPLE_MIME}`))
    .limit(1);
  return !!row;
}

/**
 * Whether a resume is the sample. It is a made-up person's, so it is never sent to a company as the person's: Express
 * apply treats it as no resume, and company search leaves it out.
 */
export async function isSampleResumeId(resumeId: string, db: Pick<Db, "select"> = getDb()): Promise<boolean> {
  const [row] = await db.select({ mimeType: resumes.mimeType }).from(resumes).where(eq(resumes.id, resumeId)).limit(1);
  return isSampleResume(row?.mimeType);
}
