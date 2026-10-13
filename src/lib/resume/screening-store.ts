import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { jobChecks, resumes } from "@/db/schema";
import { skills as taxonomy } from "@/content";
import { matchProfile } from "@/lib/gaps/match";
import { postingRole } from "@/lib/jobs/groups";
import { ownsResume, type Owner } from "@/lib/owner";
import { resumeScreening, type ResumeScreening, type RoleProfile, type ScreeningView } from "@/lib/schemas";
import { buildScreeningView } from "./screening";
import { confirmProfile, getResumeForOwner } from "./store";

type Db = ReturnType<typeof getDb>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The flags the upload stored, or null for a resume from before FR-34 (or a row that doesn't read). */
async function storedScreening(resumeId: string, owner: Owner, db: Pick<Db, "select">): Promise<ResumeScreening | null> {
  const [row] = await db.select({ screening: resumes.screening }).from(resumes).where(and(eq(resumes.id, resumeId), ownsResume(owner)));
  const parsed = resumeScreening.safeParse(row?.screening);
  return parsed.success ? parsed.data : null;
}

/**
 * FR-34 for one page: against a library role (the Gaps page) or a saved job check standing in as the target (the
 * job's Gaps page). Null when the resume or check isn't this owner's, or the profile isn't confirmed yet.
 */
export async function screeningForPage(
  resumeId: string,
  owner: Owner,
  target: { role: RoleProfile } | { checkId: string },
  { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<ScreeningView | null> {
  const resume = await getResumeForOwner(resumeId, owner, db);
  if (!resume?.confirmed) return null;
  let role: RoleProfile;
  if ("role" in target) role = target.role;
  else {
    if (!UUID.test(target.checkId)) return null;
    const [check] = await db
      .select({ requiredSkillIds: jobChecks.requiredSkillIds, niceSkillIds: jobChecks.niceSkillIds })
      .from(jobChecks)
      .innerJoin(resumes, eq(resumes.id, jobChecks.resumeId))
      .where(and(eq(jobChecks.id, target.checkId), eq(jobChecks.resumeId, resumeId), isNull(jobChecks.roleSlug), ownsResume(owner)));
    if (!check) return null;
    role = postingRole(check, now);
  }
  const stored = await storedScreening(resumeId, owner, db);
  return buildScreeningView({ against: "role" in target ? "role" : "job", profile: resume.profile, role, stored, now });
}

export type ConfirmKeywordResult =
  | { ok: true; version: number }
  | { ok: false; reason: "not_found" | "not_confirmed" | "unknown_skill" | "already" | "conflict" | "too_many" };

const skillById = new Map(taxonomy.map((s) => [s.id, s]));

/**
 * "I have this" (FR-34): the person confirms a skill their resume doesn't name, and it joins the confirmed profile's
 * skills list with no quote. The matcher reads a listed skill with no work line as weak, so it stays a gap and a goal
 * until proved; proof rules don't change. Only a taxonomy skill the resume doesn't name yet can be added, by its own
 * name, so nothing is written that the person didn't confirm. Saved as a new profile version, like any correction.
 */
export async function confirmKeyword(resumeId: string, owner: Owner, skillId: string, { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {}): Promise<ConfirmKeywordResult> {
  const skill = skillById.get(skillId);
  if (!skill) return { ok: false, reason: "unknown_skill" };
  const current = await getResumeForOwner(resumeId, owner, db);
  if (!current) return { ok: false, reason: "not_found" };
  if (!current.confirmed) return { ok: false, reason: "not_confirmed" };
  // The same matcher as the check: a skill named anywhere on the resume (even weakly) isn't a missing keyword.
  const one = matchProfile(current.profile, postingRole({ requiredSkillIds: [skillId], niceSkillIds: [] }, now), now);
  if (one.gaps[0]?.status !== "missing") return { ok: false, reason: "already" };
  const profile = { ...current.profile, skills: [...current.profile.skills, { name: skill.name, lastUsed: null, evidence: [] }] };
  const saved = await confirmProfile(resumeId, owner, profile, db);
  return saved.ok ? saved : { ok: false, reason: saved.reason };
}
