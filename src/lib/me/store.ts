import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { resumes, users } from "@/db/schema";
import { skills } from "@/content";
import { mapLineFor } from "@/lib/map/store";
import { getResumeForOwner } from "@/lib/resume/store";
import type { MeProfile } from "@/lib/schemas";
import { currentAnalysis, type Db } from "@/lib/today/state";
import { meFromProfile } from "./build";

const skillNames = new Map(skills.map((s) => [s.id, s.name]));

/**
 * The signed-in person's own profile page: their account, the latest saved profile behind their current gaps, and their
 * line. Everything is read through the owner, so it only ever shows the person their own data. Null without an account.
 */
export async function meFor(userId: string, now: Date, db: Db = getDb()): Promise<MeProfile | null> {
  const [[user], analysis] = await Promise.all([
    db.select({ name: users.name, email: users.email, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1),
    currentAnalysis(userId, db),
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
    name: user.name ?? user.email.split("@")[0]!,
    profile: resume?.profile ?? null,
    analysis: resume ? analysis!.result : null,
    line: resume ? line : null,
    skillName: (id) => skillNames.get(id) ?? id,
    joinedAt: user.createdAt,
    resumeReadAt: resume ? (read?.createdAt ?? null) : null,
    now,
  });
}
