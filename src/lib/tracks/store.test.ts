import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { skills } from "@/content";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { syncGoals } from "@/lib/goals/store";
import type { GapAnalysis } from "@/lib/schemas";
import { TRACK_CHANGES_PER_DAY } from "@/lib/schemas/constants";
import { savedTrackId, setTrack, trackedCurrentAnalysis } from "./store";

vi.mock("server-only", () => ({}));

// Runs against a real Postgres with migrations applied, like the other store tests.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const gap = (skillId: string) => ({ skillId, skillName: skillId, status: "missing" as const, resumeQuote: null, requirement: "r", explanation: "e" });

// A Data Analyst analysis: SQL met; Python and statistics gaps; Power BI missing and Excel lookups shown, as nice-to-haves.
// The draft's "BI and reporting" track adds Power BI and Excel lookups and drops Python.
const analysis: GapAnalysis = {
  roleSlug: "data-analyst",
  gaps: [gap("python"), gap("statistics")],
  metSkillIds: ["sql"],
  niceToHave: [
    { skillId: "power-bi", skillName: "Power BI", status: "missing" },
    { skillId: "excel-pivot-lookup", skillName: "Excel pivot tables and lookups", status: "met" },
  ],
  readiness: { headline: "h", explanation: "e", estimatedHours: 24 },
};

describe.skipIf(!db)("tracks (database)", () => {
  const run = `tracks-${Date.now()}`;
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
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test` }).returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  }

  /** A confirmed resume for this user with one saved analysis. */
  async function saved(userId: string, result: GapAnalysis = analysis) {
    const [resume] = await db!.insert(schema.resumes).values({ userId, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    const profile = { headline: null, totalYearsExperience: null, roles: [], skills: [], education: [], certifications: [] };
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
    const [ga] = await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result, matcherVersion: MATCHER_VERSION }).returning();
    return ga.id;
  }

  const stored = async (id: string) => (await db!.select({ result: schema.gapAnalyses.result }).from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, id)))[0].result;

  it("saves a track on the person's own analysis, and their goals are worked out from it", async () => {
    const me = await user("save");
    const id = await saved(me);
    expect(await setTrack(me, "bi-reporting", { db: db!, allowUnreviewed: true })).toEqual({ ok: true, trackId: "bi-reporting" });
    expect((await stored(id)).trackId).toBe("bi-reporting");

    const tracked = (await trackedCurrentAnalysis(me, db!, true))!;
    expect(tracked.track?.id).toBe("bi-reporting");
    expect(tracked.base.gaps.map((g) => g.skillId)).toEqual(["python", "statistics"]);
    // Power BI comes first, Python leaves; Excel lookups count as met from the resume.
    expect(tracked.result.gaps.map((g) => g.skillId)).toEqual(["power-bi", "statistics"]);
    expect(tracked.result.metSkillIds).toEqual(["sql", "excel-pivot-lookup"]);

    // Goals follow: Power BI gets a goal; Python's goal from before is kept, off the line.
    await syncGoals(me, { id, result: analysis }, db!);
    const goals = await syncGoals(me, tracked, db!);
    expect(goals.map((g) => [g.skillId, g.status])).toEqual([
      ["python", "active"],
      ["statistics", "active"],
      ["power-bi", "active"],
    ]);
  });

  it("goes back to the whole role, and keeps the choice with the role across a new resume", async () => {
    const me = await user("keep");
    await saved(me);
    await setTrack(me, "product-analytics", { db: db!, allowUnreviewed: true });
    const newer = await saved(me);
    expect((await stored(newer)).trackId).toBeUndefined();
    expect(await savedTrackId(me, "data-analyst", db!)).toBe("product-analytics");
    expect((await trackedCurrentAnalysis(me, db!, true))!.track?.id).toBe("product-analytics");

    expect(await setTrack(me, null, { db: db!, allowUnreviewed: true })).toEqual({ ok: true, trackId: null });
    expect((await stored(newer)).trackId).toBeNull();
    expect(await savedTrackId(me, "data-analyst", db!)).toBeNull();
    const whole = (await trackedCurrentAnalysis(me, db!, true))!;
    expect(whole.track).toBeNull();
    expect(whole.result.gaps).toEqual(whole.base.gaps);
  });

  it("takes only a track this deployment offers for the person's role", async () => {
    const me = await user("offer");
    const id = await saved(me);
    expect(await setTrack(me, "no-such-track", { db: db!, allowUnreviewed: true })).toEqual({ ok: false, error: "invalid" });
    // A track of another role.
    expect(await setTrack(me, "seo", { db: db!, allowUnreviewed: true })).toEqual({ ok: false, error: "invalid" });
    expect(await setTrack(me, { id: "bi-reporting" }, { db: db!, allowUnreviewed: true })).toEqual({ ok: false, error: "invalid" });
    // Production: nothing is reviewed yet, so nothing is taken.
    expect(await setTrack(me, "bi-reporting", { db: db!, allowUnreviewed: false })).toEqual({ ok: false, error: "invalid" });
    expect((await stored(id)).trackId).toBeUndefined();
    // Someone with no analysis has nothing to save.
    expect(await setTrack(await user("none"), "bi-reporting", { db: db!, allowUnreviewed: true })).toEqual({ ok: false, error: "invalid" });
  });

  it("ignores a saved track in production, where the track isn't offered", async () => {
    const me = await user("production");
    await saved(me);
    await setTrack(me, "bi-reporting", { db: db!, allowUnreviewed: true });
    const live = (await trackedCurrentAnalysis(me, db!, false))!;
    expect(live.track).toBeNull();
    expect(live.tracks).toEqual([]);
    expect(live.result).toEqual(live.base);
  });

  it("never writes another person's analysis", async () => {
    const me = await user("mine");
    const other = await user("theirs");
    const theirs = await saved(other);
    await saved(me);
    await setTrack(me, "bi-reporting", { db: db!, allowUnreviewed: true });
    expect((await stored(theirs)).trackId).toBeUndefined();
    expect(await savedTrackId(other, "data-analyst", db!)).toBeNull();
  });

  it("counts every try against the day's limit", async () => {
    const me = await user("limit");
    await saved(me);
    const now = new Date();
    for (let i = 0; i < TRACK_CHANGES_PER_DAY; i++) {
      expect((await setTrack(me, i % 2 ? null : "bi-reporting", { db: db!, now, allowUnreviewed: true })).ok).toBe(true);
    }
    expect(await setTrack(me, null, { db: db!, now, allowUnreviewed: true })).toEqual({ ok: false, error: "limit" });
  });
});
