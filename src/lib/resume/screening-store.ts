import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { jobChecks, resumes } from "@/db/schema";
import { roleProfiles, skills as taxonomy } from "@/content";
import { postingRole } from "@/lib/jobs/groups";
import { ownsResume, type Owner } from "@/lib/owner";
import {
  resumeScreening,
  skillGroups,
  type ConfirmKeywordRequest,
  type ResumeScreening,
  type RoleProfile,
  type ScreeningTarget,
  type ScreeningView,
} from "@/lib/schemas";
import { buildScreeningView, missingKeywords } from "./screening";
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
 * The role a screening target stands for: a role from our library, or one of this owner's saved job checks on this
 * resume as a role (postingRole). `standInOnly` keeps to checks standing in for the role (the job's own Gaps page).
 */
async function targetRole(
  resumeId: string,
  owner: Owner,
  target: ScreeningTarget,
  { db, now, standInOnly = false }: { db: Pick<Db, "select">; now: Date; standInOnly?: boolean },
): Promise<RoleProfile | null> {
  if ("roleSlug" in target) return roleProfiles.find((r) => r.slug === target.roleSlug) ?? null;
  if (!UUID.test(target.checkId)) return null;
  const [check] = await db
    .select({ requiredSkillIds: jobChecks.requiredSkillIds, niceSkillIds: jobChecks.niceSkillIds })
    .from(jobChecks)
    .innerJoin(resumes, eq(resumes.id, jobChecks.resumeId))
    .where(
      and(eq(jobChecks.id, target.checkId), eq(jobChecks.resumeId, resumeId), standInOnly ? isNull(jobChecks.roleSlug) : undefined, ownsResume(owner)),
    );
  return check ? postingRole(check, now) : null;
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
  const key: ScreeningTarget = "role" in target ? { roleSlug: target.role.slug } : { checkId: target.checkId };
  const role = "role" in target ? target.role : await targetRole(resumeId, owner, key, { db, now, standInOnly: true });
  if (!role) return null;
  const stored = await storedScreening(resumeId, owner, db);
  return buildScreeningView({ target: key, profileVersion: resume.version, profile: resume.profile, role, stored, now });
}

export type ConfirmKeywordResult =
  | { ok: true; version: number }
  | { ok: false; reason: "not_found" | "not_confirmed" | "unknown_skill" | "not_asked" | "already" | "conflict" | "too_many" };

const skillById = new Map(taxonomy.map((s) => [s.id, s]));

/** Every required skill of a role, with every skill of its "one of these" groups. */
function requiredIn(role: RoleProfile): Set<string> {
  return new Set([...role.skills.filter((s) => s.importance === "required").map((s) => s.skillId), ...skillGroups(role).flatMap((g) => g.skillIds)]);
}

/**
 * "I have this" (FR-34): the person confirms a skill their resume doesn't name, and it joins the confirmed profile's
 * skills list with no quote. The matcher reads a listed skill with no work line as weak, so it stays a gap and a goal
 * until proved; proof rules don't change. Only a missing keyword of the page's own target (its role, or its job check)
 * can be added, by its taxonomy name, on the profile version the page showed; nothing else is written.
 */
export async function confirmKeyword(
  resumeId: string,
  owner: Owner,
  request: ConfirmKeywordRequest,
  { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<ConfirmKeywordResult> {
  const skill = skillById.get(request.skillId);
  if (!skill) return { ok: false, reason: "unknown_skill" };
  const current = await getResumeForOwner(resumeId, owner, db);
  if (!current) return { ok: false, reason: "not_found" };
  if (!current.confirmed) return { ok: false, reason: "not_confirmed" };
  if (current.version !== request.version) return { ok: false, reason: "conflict" };
  const role = await targetRole(resumeId, owner, request.target, { db, now });
  if (!role) return { ok: false, reason: "not_found" };
  // The same matcher as the check: only a skill this target asks for that the resume doesn't name at all.
  const missing = missingKeywords(current.profile, role, now).missing.flatMap((k) => k.options.map((o) => o.skillId));
  if (!missing.includes(skill.id)) return { ok: false, reason: requiredIn(role).has(skill.id) ? "already" : "not_asked" };
  const profile = { ...current.profile, skills: [...current.profile.skills, { name: skill.name, lastUsed: null, evidence: [] }] };
  const saved = await confirmProfile(resumeId, owner, profile, db, request.version);
  return saved.ok ? saved : { ok: false, reason: saved.reason };
}
