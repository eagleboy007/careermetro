import "server-only";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gapProofs, resumes, users } from "@/db/schema";
import { skills } from "@/content";
import { displayName } from "@/lib/account/name";
import { mapLineFor } from "@/lib/map/store";
import { getResumeForOwner } from "@/lib/resume/store";
import type { MeProfile } from "@/lib/schemas";
import { currentAnalysis } from "@/lib/today/state";
import { meFromProfile } from "./build";
import { jobChecksFor } from "./job-email-check";
import type { ProofCertRow } from "./certs";

const skillNames = new Map(skills.map((s) => [s.id, s.name]));

/**
 * The person's accepted certificate proofs, and Credly badges waiting for their check, for Certifications on their
 * profile (pending item 13). Ones held for review and refused ones never show. Only what the profile needs: never the credential key's meaning, a file path or a name.
 */
export async function certificateProofsFor(userId: string, db: ReturnType<typeof getDb> = getDb()): Promise<ProofCertRow[]> {
  return db
    .select({
      proofId: gapProofs.id,
      certId: gapProofs.certId,
      credentialKey: gapProofs.credentialKey,
      issuedOn: gapProofs.issuedOn,
      expiresOn: gapProofs.expiresOn,
      verifier: gapProofs.verifier,
      url: sql<string | null>`${gapProofs.evidence}->>'url'`,
      badgeId: gapProofs.badgeId,
      checkNote: gapProofs.checkNote,
      pending: sql<boolean>`${gapProofs.status} = 'pending'`,
      createdAt: gapProofs.createdAt,
    })
    .from(gapProofs)
    .where(
      and(
        eq(gapProofs.userId, userId),
        eq(gapProofs.type, "certification"),
        // Accepted ones, and Credly badges waiting for their check, which only the owner ever sees.
        or(eq(gapProofs.status, "accepted"), and(eq(gapProofs.status, "pending"), eq(gapProofs.heldReason, "credly_check"))),
      ),
    )
    .orderBy(desc(gapProofs.createdAt))
    .limit(200);
}

/**
 * The signed-in person's own profile page: their account, the latest saved profile behind their current gaps, and their
 * line. Everything is read through the owner, so it only ever shows the person their own data. Null without an account.
 */
export async function meFor(userId: string, now: Date, db: ReturnType<typeof getDb> = getDb()): Promise<MeProfile | null> {
  const [[user], analysis, proofCerts, jobChecks] = await Promise.all([
    db.select({ name: users.name, headline: users.headline, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1),
    currentAnalysis(userId, db),
    certificateProofsFor(userId, db),
    jobChecksFor([userId], db),
  ]);
  if (!user) return null;
  const [resume, [read], line] = analysis
    ? await Promise.all([
        getResumeForOwner(analysis.resumeId, { userId }, db),
        db
          .select({ createdAt: resumes.createdAt })
          .from(resumes)
          .where(and(eq(resumes.id, analysis.resumeId), eq(resumes.userId, userId)))
          .limit(1),
        mapLineFor(userId, db),
      ])
    : [null, [], null];
  return meFromProfile({
    // The email is never shown, not even its first part (T6).
    name: displayName(user.name),
    headline: user.headline,
    profile: resume?.profile ?? null,
    analysis: resume ? analysis!.result : null,
    line: resume ? line : null,
    skillName: (id) => skillNames.get(id) ?? id,
    joinedAt: user.createdAt,
    resumeReadAt: resume ? (read?.createdAt ?? null) : null,
    now,
    proofCerts,
    jobChecks: jobChecks.get(userId) ?? [],
  });
}
