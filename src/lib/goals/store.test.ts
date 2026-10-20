import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import type { GapAnalysis } from "@/lib/schemas";
import { addProof, changeGoal, goalsOf, indiaToday, setProofStatus, syncGoals } from "./store";

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
    expect(await changeGoal(me, goal(b), { action: "skip" }, db!, members)).toBe("refused");
    expect(await changeGoal(me, goal(a), { action: "swap", skillId: b }, db!, members)).toBe("refused");
    expect(await changeGoal(me, goal(b), { action: "swap", skillId: e }, db!, members)).toBe("refused");
    // Restoring a goal that isn't skipped, or skipping one twice, leaves it as asked (T68).
    expect(await changeGoal(me, goal(a), { action: "restore" }, db!, members)).toBe("ok");
    expect(await changeGoal(me, goal(a), { action: "skip" }, db!, members)).toBe("ok");
    expect(await changeGoal(me, goal(a), { action: "skip" }, db!, members)).toBe("ok");
    expect(await changeGoal(me, goal(a), { action: "swap", skillId: b }, db!, members)).toBe("refused");
    expect(await changeGoal(me, goal(b), { action: "swap", skillId: c }, db!, members)).toBe("ok");
    // Nobody else can change them, and a bad id changes nothing.
    const other = await user("not-for-me-other");
    expect(await changeGoal(other, goal(d), { action: "skip" }, db!, members)).toBe("not_found");
    expect(await changeGoal(me, "not-a-uuid", { action: "skip" }, db!, members)).toBe("not_found");

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
    expect(await changeGoal(me, goal(b), { action: "swap", skillId: b }, db!, members)).toBe("ok");
    expect((await goalsOf(me, db!, members)).find((g) => g.skillId === b)?.swappedTo).toBeNull();

    // Bring back: active again, at the end of the order.
    expect(await changeGoal(me, goal(a), { action: "restore" }, db!, members)).toBe("ok");
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
  // A view with nothing to change skips the write transaction (docs/plans/goal-sync-skip-plan.md).
  describe("a view with nothing to change", () => {
    /** The row version (`xmin`) of each of the person's goals and path steps: any write to a row changes it. */
    async function stamps(userId: string) {
      const [goals, steps] = await Promise.all([
        db!
          .select({ id: schema.userGoals.id, x: sql<string>`${schema.userGoals}.xmin::text` })
          .from(schema.userGoals)
          .where(eq(schema.userGoals.userId, userId))
          .orderBy(schema.userGoals.id),
        db!
          .select({ id: schema.pathSteps.id, x: sql<string>`${schema.pathSteps}.xmin::text` })
          .from(schema.pathSteps)
          .innerJoin(schema.paths, eq(schema.paths.id, schema.pathSteps.pathId))
          .innerJoin(schema.gapAnalyses, eq(schema.gapAnalyses.id, schema.paths.gapAnalysisId))
          .innerJoin(schema.profiles, eq(schema.profiles.id, schema.gapAnalyses.profileId))
          .innerJoin(schema.resumes, eq(schema.resumes.id, schema.profiles.resumeId))
          .where(eq(schema.resumes.userId, userId))
          .orderBy(schema.pathSteps.id),
      ]);
      return { goals, steps };
    }

    /** Runs `view` while another connection holds the person's goal lock; "blocked" if it waited on the lock. */
    async function whileLocked<T>(userId: string, view: () => Promise<T>): Promise<T | "blocked"> {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const held = new Promise<void>((r) => (locked = r));
      const holder = sqlClient!.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`cm-goals:${userId}`}))`;
        locked();
        await gate;
      });
      await held;
      try {
        return await Promise.race([view(), new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 2000))]);
      } finally {
        release();
        await holder;
      }
    }

    /** A view after `view` has settled: the same goals, and not one row written. */
    async function expectQuiet(userId: string, view: () => Promise<unknown>) {
      const settled = await view();
      const before = await stamps(userId);
      expect(await view()).toEqual(settled);
      expect(await stamps(userId)).toEqual(before);
    }

    const acceptedProof = (userId: string, skillId: string, expiresOn: string | null = null) =>
      db!.insert(schema.gapProofs).values({
        userId,
        skillId,
        type: "skill_check",
        evidence: { type: "skill_check", checkId: `skip-${skillId}` },
        status: "accepted",
        expiresOn,
      });

    it("writes nothing and takes no lock on a second view", async () => {
      const me = await user("skip-quiet");
      const ga = await saved(me, analysis([a, b, c]), [a, b]);
      const proof = await addProof(me, b, { type: "skill_check", checkId: "skip-b" }, db!);
      await setProofStatus(proof!, me, "accepted", "app", db!);
      const first = await syncGoals(me, ga, db!);
      expect(first.map((g) => [g.skillId, g.status, g.proved])).toEqual([
        [a, "active", false],
        [b, "met", true],
        [c, "active", false],
      ]);

      const before = await stamps(me);
      expect(before.goals).toHaveLength(3);
      expect(before.steps).toHaveLength(2);
      // The person's lock is held elsewhere (a proof check mid-way, say): the view still answers at once.
      expect(await whileLocked(me, () => syncGoals(me, ga, db!))).toEqual(first);
      expect(await stamps(me)).toEqual(before);
      expect(await goalsOf(me, db!)).toEqual(first);
      // Someone else's analysis is still nothing, on the read-only path too.
      const them = await user("skip-quiet-other");
      expect(await syncGoals(them, ga, db!)).toEqual([]);
    });

    it("still syncs a new analysis, then is quiet again", async () => {
      const me = await user("skip-analysis");
      await syncGoals(me, await saved(me, analysis([a, b])), db!);
      const next = await saved(me, analysis([b, d], [a]));
      const goals = await syncGoals(me, next, db!);
      expect(goals.map((g) => [g.skillId, g.status])).toEqual([
        [a, "met"],
        [b, "active"],
        [d, "active"],
      ]);
      await expectQuiet(me, () => syncGoals(me, next, db!));
    });

    it("still syncs a track's result under the same analysis id", async () => {
      const me = await user("skip-track");
      const ga = await saved(me, analysis([a, b]));
      await syncGoals(me, ga, db!);
      // A track changes the result, not the id: a new gap gets a goal and a skill it counts as met is met.
      const tracked = { id: ga.id, result: analysis([b, e], [a]) };
      const goals = await syncGoals(me, tracked, db!);
      expect(goals.map((g) => [g.skillId, g.status])).toEqual([
        [a, "met"],
        [b, "active"],
        [e, "active"],
      ]);
      await expectQuiet(me, () => syncGoals(me, tracked, db!));
      // Back to the whole role: A is a gap again and opens.
      expect((await syncGoals(me, ga, db!)).find((g) => g.skillId === a)?.status).toBe("active");
    });

    it("still syncs after Not for me: a goal brought back is met by proof it gained while skipped", async () => {
      const me = await user("skip-restore");
      const ga = await saved(me, analysis([a, b]));
      const goals = await syncGoals(me, ga, db!);
      const goalA = goals.find((g) => g.skillId === a)!.id;
      expect(await changeGoal(me, goalA, { action: "skip" }, db!)).toBe("ok");
      expect((await syncGoals(me, ga, db!)).find((g) => g.skillId === a)?.status).toBe("skipped");
      // Proof of A while skipped leaves the goal skipped; Restore makes it active and the next view meets it.
      const proof = await addProof(me, a, { type: "skill_check", checkId: "skip-restore" }, db!);
      await setProofStatus(proof!, me, "accepted", "app", db!);
      await expectQuiet(me, () => syncGoals(me, ga, db!));
      expect(await changeGoal(me, goalA, { action: "restore" }, db!)).toBe("ok");
      expect((await syncGoals(me, ga, db!)).find((g) => g.skillId === a)).toMatchObject({ status: "met", proved: true, position: 3 });
      await expectQuiet(me, () => syncGoals(me, ga, db!));
    });

    it("still syncs proof that changed without its goals being brought in line", async () => {
      const me = await user("skip-proof");
      const ga = await saved(me, analysis([a, b]));
      await syncGoals(me, ga, db!);
      await expectQuiet(me, () => syncGoals(me, ga, db!));
      await acceptedProof(me, b);
      expect((await syncGoals(me, ga, db!)).find((g) => g.skillId === b)).toMatchObject({ status: "met", proved: true });
      await expectQuiet(me, () => syncGoals(me, ga, db!));
      // The proof goes (deleted behind the sync's back): the goal opens again.
      await db!.delete(schema.gapProofs).where(eq(schema.gapProofs.userId, me));
      expect((await syncGoals(me, ga, db!)).find((g) => g.skillId === b)).toMatchObject({ status: "active", proved: false });
    });

    it("still syncs when the clock passes a proof's expiry date, with no row changed", async () => {
      const me = await user("skip-clock");
      const ga = await saved(me, analysis([a, b]));
      await acceptedProof(me, a, indiaToday());
      await expectQuiet(me, () => syncGoals(me, ga, db!));
      expect((await goalsOf(me, db!)).find((g) => g.skillId === a)).toMatchObject({ status: "met", proved: true });
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(Date.now() + 86_400_000));
        expect((await syncGoals(me, ga, db!)).find((g) => g.skillId === a)).toMatchObject({ status: "renew", proved: false });
        await expectQuiet(me, () => syncGoals(me, ga, db!));
      } finally {
        vi.useRealTimers();
      }
    });

    it("still syncs a goal row changed by something else", async () => {
      const me = await user("skip-row");
      const ga = await saved(me, analysis([a, b], [c]));
      await syncGoals(me, ga, db!);
      await syncGoals(me, await saved(me, analysis([a, b, c])), db!);
      // The current analysis shows C again; a stray write left its goal open.
      const shown = await saved(me, analysis([a, b], [c]));
      expect((await syncGoals(me, shown, db!)).find((g) => g.skillId === c)?.status).toBe("met");
      await db!.update(schema.userGoals).set({ status: "active", metAt: null }).where(and(eq(schema.userGoals.userId, me), eq(schema.userGoals.skillId, c)));
      expect((await syncGoals(me, shown, db!)).find((g) => g.skillId === c)?.status).toBe("met");
      await expectQuiet(me, () => syncGoals(me, shown, db!));
    });

    it("still links a path built after the goals were made", async () => {
      const me = await user("skip-path");
      const ga = await saved(me, analysis([a, b]));
      const goals = await syncGoals(me, ga, db!);
      await expectQuiet(me, () => syncGoals(me, ga, db!));
      const [path] = await db!.insert(schema.paths).values({ gapAnalysisId: ga.id, weeklyHours: 5 }).returning();
      await db!.insert(schema.pathSteps).values(
        [a, b, d].map((skillId, i) => ({ pathId: path.id, position: i + 1, skillId, reason: "r", hours: 2, resourceIds: [], proofTask: "t" })),
      );
      await syncGoals(me, ga, db!);
      const steps = await db!
        .select({ skillId: schema.pathSteps.skillId, goalId: schema.pathSteps.goalId })
        .from(schema.pathSteps)
        .where(eq(schema.pathSteps.pathId, path.id))
        .orderBy(schema.pathSteps.position);
      // D has no goal, so its step stays unlinked, and that alone never makes a view write.
      expect(steps).toEqual([
        { skillId: a, goalId: goals.find((g) => g.skillId === a)!.id },
        { skillId: b, goalId: goals.find((g) => g.skillId === b)!.id },
        { skillId: d, goalId: null },
      ]);
      await expectQuiet(me, () => syncGoals(me, ga, db!));
    });

    it("still syncs when the content's skill groups change", async () => {
      const me = await user("skip-groups");
      const base = analysis([a, c]);
      const result = { ...base, gaps: base.gaps.map((g) => (g.skillId === a ? { ...g, groupId: "skip-pair" } : g)) };
      const ga = await saved(me, result);
      await acceptedProof(me, b);
      // Before the deploy the group isn't known, so only A fills the goal.
      const before = new Map<string, string[]>();
      expect((await syncGoals(me, ga, db!, before)).find((g) => g.skillId === a)).toMatchObject({ status: "active", proved: false });
      await expectQuiet(me, () => syncGoals(me, ga, db!, before));
      // After it, B is one of the group's skills and its proof meets the goal.
      const after = new Map([["skip-pair", [a, b]]]);
      expect((await syncGoals(me, ga, db!, after)).find((g) => g.skillId === a)).toMatchObject({ status: "met", proved: true });
      await expectQuiet(me, () => syncGoals(me, ga, db!, after));
    });
  });
});
