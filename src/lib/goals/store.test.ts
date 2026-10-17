import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import type { GapAnalysis } from "@/lib/schemas";
import { addProof, changeGoal, goalsOf, setProofStatus, syncGoals } from "./store";

vi.mock("server-only", () => ({}));

// Runs against a real Postgres with migrations applied, like the other store tests.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

// Skills with no prerequisites among each other, so the order is the gaps' own ranking.
const ids = skills
  .filter((s) => s.implies.length === 0)
  .slice(0, 5)
  .map((s) => s.id);
const [a, b, c, d, e] = ids;
const analysis = (gapIds: string[], met: string[] = []): GapAnalysis => ({
  roleSlug: roleProfiles[0].slug,
  gaps: gapIds.map((skillId) => ({ skillId, skillName: skillId, status: "missing", resumeQuote: null, requirement: "r", explanation: "e" })),
  metSkillIds: met,
  niceToHave: [],
  readiness: { headline: "h", explanation: "e", estimatedHours: 10 },
});

describe.skipIf(!db)("goals (database)", () => {
  const run = `goals-${Date.now()}`;
  const userIds: string[] = [];
  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
  });
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  async function user(n: string) {
    const [row] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.test` })
      .returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  }

  /** A saved analysis for this user, with a path whose steps cover the given skills. */
  async function saved(userId: string, result: GapAnalysis, pathSkills: string[] = []) {
    const [resume] = await db!.insert(schema.resumes).values({ userId, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    const profile = {
      headline: null,
      totalYearsExperience: null,
      roles: [{ title: "Analyst", employer: "Example Co", start: "2023-01", end: null, highlights: [] }],
      skills: [],
      education: [],
      certifications: [],
    };
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
    const [ga] = await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result, matcherVersion: MATCHER_VERSION }).returning();
    if (pathSkills.length) {
      const [path] = await db!.insert(schema.paths).values({ gapAnalysisId: ga.id, weeklyHours: 5 }).returning();
      await db!
        .insert(schema.pathSteps)
        .values(
          pathSkills.map((skillId, i) => ({ pathId: path.id, position: i + 1, skillId, reason: "r", hours: 2, resourceIds: [], proofTask: "t" })),
        );
    }
    return { id: ga.id, result };
  }

  it("makes one goal per gap in order, links the path's steps, and keeps the order after a new resume", async () => {
    const me = await user("order");
    const first = await saved(me, analysis([a, b, c]), [a, b]);
    const goals = await syncGoals(me, first, db!);
    expect(goals.map((g) => [g.skillId, g.position, g.status])).toEqual([
      [a, 1, "active"],
      [b, 2, "active"],
      [c, 3, "active"],
    ]);
    const steps = await db!
      .select({ skillId: schema.pathSteps.skillId, goalId: schema.pathSteps.goalId, kind: schema.pathSteps.kind })
      .from(schema.pathSteps)
      .innerJoin(schema.paths, eq(schema.paths.id, schema.pathSteps.pathId))
      .where(eq(schema.paths.gapAnalysisId, first.id));
    expect(steps.map((s) => [s.goalId, s.kind])).toEqual(steps.map((s) => [goals.find((g) => g.skillId === s.skillId)!.id, "learn"]));

    // The new resume shows A and adds D as a gap: A is met, B and C keep their place, D goes last.
    const again = await syncGoals(me, await saved(me, analysis([d, c, b], [a])), db!);
    expect(again.map((g) => [g.skillId, g.position, g.status])).toEqual([
      [a, 1, "met"],
      [b, 2, "active"],
      [c, 3, "active"],
      [d, 4, "active"],
    ]);
    expect(again.every((g) => !g.proved)).toBe(true);
    // Running it again changes nothing.
    expect(await syncGoals(me, await saved(me, analysis([d, c, b], [a])), db!)).toEqual(again);
  });

  it("makes one goal for a 'one of these' group, keeps it paired with the gap, and fills it with proof of any skill", async () => {
    const me = await user("group");
    const members = new Map([["pair", [a, b]]]);
    const grouped = (
      gapIds: string[],
      groupSkill: string,
      met: string[] = [],
    ) => {
      const base = analysis(gapIds, met);
      return {
        ...base,
        gaps: base.gaps.map((g) =>
          g.skillId === groupSkill ? { ...g, groupId: "pair" } : g,
        ),
      };
    };
    await syncGoals(me, await saved(me, grouped([a, c], a)), db!, members);
    const [row] = await db!
      .select({ groupId: schema.userGoals.groupId })
      .from(schema.userGoals)
      .where(
        and(eq(schema.userGoals.userId, me), eq(schema.userGoals.skillId, a)),
      );
    expect(row.groupId).toBe("pair");
    // The group's gap now suggests B: the same goal moves to B, keeping its place.
    const moved = await syncGoals(
      me,
      await saved(me, grouped([b, c], b)),
      db!,
      members,
    );
    expect(moved.map((g) => [g.skillId, g.position, g.status])).toEqual([
      [b, 1, "active"],
      [c, 2, "active"],
    ]);
    // Accepted proof of A, the group's other skill, proves and meets it at once.
    const proofId = (await addProof(
      me,
      a,
      { type: "skill_check", checkId: "c-group" },
      db!,
    ))!;
    expect(
      await setProofStatus(proofId, me, "accepted", "app", db!, members),
    ).toBe(true);
    const after = await goalsOf(me, db!, members);
    expect(after.find((g) => g.skillId === b)).toMatchObject({
      status: "met",
      proved: true,
    });
  });

  it("fills a gap only with accepted proof, and carries proof over to a new role", async () => {
    const me = await user("proof");
    const ga = await saved(me, analysis([a, b]));
    await syncGoals(me, ga, db!);
    const proof = await addProof(me, a, { type: "certification", issuer: "Example Board", credentialId: "X-1", url: null }, db!);
    expect(proof).not.toBeNull();

    const status = async () => (await syncGoals(me, ga, db!)).find((g) => g.skillId === a)!;
    expect(await status()).toMatchObject({ status: "active", proved: false });
    expect(await setProofStatus(proof!, me, "rejected", "issuer", db!)).toBe(true);
    expect(await status()).toMatchObject({ status: "active", proved: false });
    expect(await setProofStatus(proof!, me, "accepted", "issuer", db!)).toBe(true);
    expect(await status()).toMatchObject({ status: "met", proved: true });

    // A new role that also needs A starts with it met.
    const goals = await syncGoals(me, await saved(me, analysis([e, a])), db!);
    expect(goals.find((g) => g.skillId === a)).toMatchObject({ status: "met", proved: true, position: 1 });
    expect(goals.find((g) => g.skillId === e)).toMatchObject({ status: "active", position: 3 });

    // Taking the acceptance back opens the goal again.
    await setProofStatus(proof!, me, "rejected", "issuer", db!);
    expect(await status()).toMatchObject({ status: "active", proved: false });
  });

  it("never lets one person read or change another's goals or proof", async () => {
    const me = await user("mine");
    const them = await user("theirs");
    await syncGoals(me, await saved(me, analysis([a])), db!);
    const theirs = await syncGoals(them, await saved(them, analysis([b])), db!);
    expect(theirs.map((g) => g.skillId)).toEqual([b]);

    // Work proof must point at a role on the person's own profile.
    const [theirProfile] = await db!
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .innerJoin(schema.resumes, eq(schema.resumes.id, schema.profiles.resumeId))
      .where(eq(schema.resumes.userId, them));
    expect(await addProof(me, a, { type: "work", profileId: theirProfile.id, roleIndex: 0 }, db!)).toBeNull();
    const [mine] = await db!
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .innerJoin(schema.resumes, eq(schema.resumes.id, schema.profiles.resumeId))
      .where(eq(schema.resumes.userId, me));
    expect(await addProof(me, a, { type: "work", profileId: mine.id, roleIndex: 1 }, db!)).toBeNull();
    const proof = await addProof(me, a, { type: "work", profileId: mine.id, roleIndex: 0 }, db!);
    expect(proof).not.toBeNull();
    expect(await setProofStatus(proof!, them, "accepted", "person", db!)).toBe(false);
    const [row] = await db!.select({ status: schema.gapProofs.status }).from(schema.gapProofs).where(eq(schema.gapProofs.id, proof!));
    expect(row.status).toBe("pending");

    // Someone else's analysis can't make goals or link its path steps to this person.
    const foreign = await saved(them, analysis([c]), [c]);
    expect(await syncGoals(me, foreign, db!)).toEqual([]);
    const linked = await db!
      .select({ goalId: schema.pathSteps.goalId })
      .from(schema.pathSteps)
      .innerJoin(schema.paths, eq(schema.paths.id, schema.pathSteps.pathId))
      .where(eq(schema.paths.gapAnalysisId, foreign.id));
    expect(linked).toEqual([{ goalId: null }]);
  });

  it("gives the same goals once when visits and proof checks happen at the same time", async () => {
    const me = await user("race");
    const ga = await saved(me, analysis([a, b, c]));
    const proof = await addProof(me, a, { type: "skill_check", checkId: "c1" }, db!);
    await setProofStatus(proof!, me, "accepted", "app", db!);
    // Five visits and a rejection at once: every goal once, positions 1 to 3, and A not met without proof.
    await Promise.all([...Array.from({ length: 5 }, () => syncGoals(me, ga, db!)), setProofStatus(proof!, me, "rejected", "app", db!)]);
    const goals = await syncGoals(me, ga, db!);
    expect(goals.map((g) => [g.skillId, g.position])).toEqual([
      [a, 1],
      [b, 2],
      [c, 3],
    ]);
    expect(goals[0]).toMatchObject({ status: "active", proved: false });
  });

  it("refuses proof for an unknown skill or with free text instead of structured evidence", async () => {
    const me = await user("bad-proof");
    expect(await addProof(me, "not-a-skill", { type: "skill_check", checkId: "c1" }, db!)).toBeNull();
    expect(await addProof(me, a, { type: "work", employer: "Acme", title: "Copied from a resume" } as never, db!)).toBeNull();
  });

  it("skips a required goal for good, swaps a group goal within its group, and brings a skipped goal back last", async () => {
    const me = await user("not-for-me");
    const members = new Map([["pair", [b, c]]]);
    const base = analysis([a, b, d]);
    const result = { ...base, gaps: base.gaps.map((g) => (g.skillId === b ? { ...g, groupId: "pair" } : g)) };
    const first = await saved(me, result);
    const goals = await syncGoals(me, first, db!, members);
    const goal = (skillId: string) => goals.find((g) => g.skillId === skillId)!.id;

    // A required goal can be skipped, a group goal can't; a group goal can be swapped, a required goal can't.
    expect(await changeGoal(me, goal(b), { action: "skip" }, db!, members)).toBe(false);
    expect(await changeGoal(me, goal(a), { action: "swap", skillId: b }, db!, members)).toBe(false);
    expect(await changeGoal(me, goal(b), { action: "swap", skillId: e }, db!, members)).toBe(false);
    expect(await changeGoal(me, goal(a), { action: "restore" }, db!, members)).toBe(false);
    expect(await changeGoal(me, goal(a), { action: "skip" }, db!, members)).toBe(true);
    expect(await changeGoal(me, goal(a), { action: "skip" }, db!, members)).toBe(false);
    expect(await changeGoal(me, goal(b), { action: "swap", skillId: c }, db!, members)).toBe(true);
    // Nobody else can change them, and a bad id changes nothing.
    const other = await user("not-for-me-other");
    expect(await changeGoal(other, goal(d), { action: "skip" }, db!, members)).toBe(false);
    expect(await changeGoal(me, "not-a-uuid", { action: "skip" }, db!, members)).toBe(false);

    // Goal sync keeps the skip and the swap: a recompute never brings a skipped goal back.
    const synced = await syncGoals(me, await saved(me, result), db!, members);
    expect(synced.map((g) => [g.skillId, g.status, g.swappedTo])).toEqual([
      [a, "skipped", null],
      [b, "active", c],
      [d, "active", null],
    ]);
    // Proof of the swapped-to skill fills the group goal, so the match never depended on the swap.
    const proof = await addProof(me, c, { type: "skill_check", checkId: "nfm" }, db!);
    await setProofStatus(proof!, me, "accepted", "app", db!, members);
    expect((await goalsOf(me, db!, members)).find((g) => g.skillId === b)).toMatchObject({ proved: true, swappedTo: c });
    // Back to the group's own skill clears the swap.
    expect(await changeGoal(me, goal(b), { action: "swap", skillId: b }, db!, members)).toBe(true);
    expect((await goalsOf(me, db!, members)).find((g) => g.skillId === b)?.swappedTo).toBeNull();

    // Bring back: active again, at the end of the order.
    expect(await changeGoal(me, goal(a), { action: "restore" }, db!, members)).toBe(true);
    const [row] = await db!
      .select({ status: schema.userGoals.status, position: schema.userGoals.position, skippedAt: schema.userGoals.skippedAt })
      .from(schema.userGoals)
      .where(eq(schema.userGoals.id, goal(a)));
    expect(row).toEqual({ status: "active", position: 4, skippedAt: null });
  });

  it("deletes goals and proof with the account", async () => {
    const me = await user("delete");
    await syncGoals(me, await saved(me, analysis([a])), db!);
    await addProof(me, a, { type: "skill_check", checkId: "c1" }, db!);
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await db!.select().from(schema.userGoals).where(eq(schema.userGoals.userId, me))).toEqual([]);
    expect(await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, me))).toEqual([]);
  });
});
