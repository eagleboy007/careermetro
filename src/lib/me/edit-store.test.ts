import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { GAP_LIMITS, getGapsForOwner } from "@/lib/gaps/store";
import { ingestResume } from "@/lib/resume/ingest";
import type { ParseClient } from "@/lib/resume/parse";
import { confirmProfile } from "@/lib/resume/store";
import { interestExport, meEducationExport, meProfile, meRoleExport, storyExport, type Profile } from "@/lib/schemas";
import { INTERESTS_MAX, ME_EDITS_PER_DAY, ME_ROLES_MAX, STORIES_MAX } from "@/lib/schemas/constants";
import { LIMITS } from "@/lib/shared-limit";
import { interestsInCommonWith } from "@/lib/network/store";
import {
  addInterest,
  deleteMeEducation,
  deleteMeRole,
  deleteStory,
  FULL_MESSAGES,
  meAdditionsFor,
  removeInterest,
  saveMeEducation,
  saveMeRole,
  SAME_JOB_MESSAGES,
  saveStory,
  storyGoalOptions,
} from "./edit-store";
import { meFor } from "./store";

vi.mock("server-only", () => ({}));

it("keeps the plan's daily limit", () => {
  expect(LIMITS.meEditsPerUserDay.max).toBe(ME_EDITS_PER_DAY);
  expect(ME_EDITS_PER_DAY).toBe(100);
});

// Me editing (docs/plans/me-editing-plan.md) against a real Postgres with migrations applied. Every person, company,
// resume and story here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const bytes = new TextEncoder().encode(readFileSync("fixtures/resumes/priya-sharma.txt", "utf8"));
const parsed: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [{ title: "Data Analyst", employer: "Example Retail Pvt Ltd", start: "2022-06", end: null, highlights: ["Wrote SQL queries for weekly sales reports across 40 stores"] }],
  skills: [{ name: "SQL", lastUsed: null, evidence: [] }],
  education: [],
  certifications: [],
};
const client = {
  beta: {
    messages: {
      create: vi.fn().mockResolvedValue({
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 3000, output_tokens: 1000 },
        content: [{ type: "text", text: JSON.stringify(parsed) }],
      }),
    },
  },
} as unknown as ParseClient;

const role = { title: "Volunteer data lead", employer: "Pune Reads Library Trust", startMonth: "2023-06", endMonth: "2023-12", isCurrent: false };
const story = {
  title: "Story text that must stay out of logs",
  where: "Konkan Co-operative Bank · 2025",
  situation: "Phishing alerts piled up.",
  task: "I owned the morning triage.",
  action: "I sorted alerts by sender domain and wrote a short checklist for the whole team to follow each day.",
  result: "Missed alerts fell from 9 a week to 1.",
  boxes: ["Problem solving", "Ownership"],
  goalId: null as string | null,
};
const missing = "00000000-0000-4000-8000-00000000dead";

describe.skipIf(!db)("Me editing (database)", () => {
  const run = `meedit-${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  const explain = GAP_LIMITS.explainedPerOwnerPerDay;
  let n = 0;
  const deps = () => ({ db: db! });

  const user = async (tag: string) => {
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${tag}-${n++}@example.test`, name: "Asha Example" }).returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  };
  const goal = async (userId: string, skillId: string) => {
    const [row] = await db!.insert(schema.userGoals).values({ userId, skillId, position: n++ }).returning({ id: schema.userGoals.id });
    return row.id;
  };

  beforeAll(async () => {
    await db!.insert(schema.skills).values(skills.map(({ id, name, category }) => ({ id, name, category }))).onConflictDoNothing();
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
    GAP_LIMITS.explainedPerOwnerPerDay = 0;
  });
  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    vi.unstubAllEnvs();
    GAP_LIMITS.explainedPerOwnerPerDay = explain;
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
    // Story text, roles and interests never reach a log.
    expect(lines.join("\n")).not.toMatch(/Story text that must stay out of logs|Pune Reads|Photography|Asha/);
  });

  it("adds, edits and deletes a role for its owner only; someone else's is not found", async () => {
    const me = await user("role");
    const other = await user("role-other");
    const added = await saveMeRole(me, null, role, deps());
    expect(added).toMatchObject({ ok: true, id: expect.any(String) });
    const id = (added as { id: string }).id;
    expect(await saveMeRole(me, id, { ...role, title: "Volunteer analyst" }, deps())).toEqual({ ok: true, id });
    expect((await meAdditionsFor(me, db!)).roles).toEqual([{ id, ...role, title: "Volunteer analyst" }]);
    // Another person can neither read, change nor delete it.
    expect((await meAdditionsFor(other, db!)).roles).toEqual([]);
    expect(await saveMeRole(other, id, role, deps())).toEqual({ ok: false, error: "not_found" });
    expect(await deleteMeRole(other, id, deps())).toEqual({ ok: false, error: "not_found" });
    expect(await deleteMeRole(me, "not-an-id", deps())).toEqual({ ok: false, error: "not_found" });
    expect((await meAdditionsFor(me, db!)).roles[0].title).toBe("Volunteer analyst");
    expect(await deleteMeRole(me, id, deps())).toEqual({ ok: true });
    expect(await deleteMeRole(me, id, deps())).toEqual({ ok: false, error: "not_found" });
    // Bad input says what to fix, on its field.
    expect(await saveMeRole(me, null, { ...role, endMonth: "2023-01" }, deps())).toMatchObject({ ok: false, error: "invalid", field: "endMonth", message: "It can't end before it started." });
  });

  it("keeps one current role: ticking it on a new one ends the old one", async () => {
    const me = await user("current");
    const first = await saveMeRole(me, null, { ...role, startMonth: "2024-02", endMonth: null, isCurrent: true }, deps());
    const second = await saveMeRole(me, null, { ...role, title: "Data analyst", employer: "Garuda Security", startMonth: "2025-03", endMonth: null, isCurrent: true }, deps());
    expect([first.ok, second.ok]).toEqual([true, true]);
    const roles = (await meAdditionsFor(me, db!)).roles;
    expect(roles.map((r) => [r.title, r.isCurrent, r.endMonth])).toEqual([
      ["Data analyst", true, null],
      ["Volunteer data lead", false, "2025-03"],
    ]);
    // The database holds the rule too.
    await expect(db!.update(schema.meRoles).set({ isCurrent: true, endMonth: null }).where(eq(schema.meRoles.userId, me))).rejects.toThrow();
  });

  it("refuses a role already on the resume, ignoring case", async () => {
    const me = await user("resume");
    const owner = { userId: me };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-resume` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, roleProfiles[0], { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);
    expect(await saveMeRole(me, null, { ...role, title: " data analyst ", employer: "EXAMPLE retail pvt ltd" }, deps())).toEqual({
      ok: false,
      error: "on_resume",
      message: "That role is already on your resume.",
      field: "title",
    });
    // Another title at the same company and start month is one job to the work-email check, so it would wear the
    // resume job's badge: refused on the start month (T76).
    expect(await saveMeRole(me, null, { ...role, title: "Head of Engineering", employer: "Example Retail", startMonth: "2022-06" }, deps())).toEqual({
      ok: false,
      error: "on_resume",
      message: SAME_JOB_MESSAGES.resume,
      field: "startMonth",
    });
    expect((await saveMeRole(me, null, role, deps())).ok).toBe(true);
    // And against the other roles added on Me, but a role's own edit is fine.
    const twin = { ...role, title: "Volunteer coordinator", employer: "Pune Reads Library Trust Ltd" };
    expect(await saveMeRole(me, null, twin, deps())).toEqual({ ok: false, error: "duplicate", message: SAME_JOB_MESSAGES.added, field: "startMonth" });
    const later = await saveMeRole(me, null, { ...twin, startMonth: "2023-07" }, deps());
    if (!later.ok) throw new Error(later.error);
    expect(await saveMeRole(me, later.id!, twin, deps())).toMatchObject({ ok: false, error: "duplicate" });
    expect(await saveMeRole(me, later.id!, { ...twin, startMonth: "2023-08" }, deps())).toEqual({ ok: true, id: later.id });
    expect(await deleteMeRole(me, later.id!, deps())).toEqual({ ok: true });
    // Me shows both, newest start first; the resume role keeps its own lines.
    const profile = await meFor(me, new Date("2026-10-10T06:00:00Z"), db!);
    expect(meProfile.safeParse(profile).success).toBe(true);
    expect(profile!.experience.map((e) => [e.title, !!e.added])).toEqual([
      ["Volunteer data lead", true],
      ["Data Analyst", false],
    ]);
    expect(profile!.experience[1].highlights).toEqual(["Wrote SQL queries for weekly sales reports across 40 stores"]);
  });

  it("adds, edits and deletes education for its owner only", async () => {
    const me = await user("edu");
    const other = await user("edu-other");
    const out = await saveMeEducation(me, null, { qualification: "Data Analytics with Python", institution: "NPTEL", year: "" }, deps());
    const id = (out as { id: string }).id;
    expect((await meAdditionsFor(me, db!)).education).toEqual([{ id, qualification: "Data Analytics with Python", institution: "NPTEL", year: null }]);
    expect(await saveMeEducation(other, id, { qualification: "x", institution: "y", year: "" }, deps())).toEqual({ ok: false, error: "not_found" });
    expect(await deleteMeEducation(other, id, deps())).toEqual({ ok: false, error: "not_found" });
    expect(await saveMeEducation(me, id, { qualification: "Data Analytics with Python", institution: "NPTEL", year: "2025" }, deps())).toEqual({ ok: true, id });
    expect((await meAdditionsFor(me, db!)).education[0].year).toBe("2025");
    expect(await deleteMeEducation(me, id, deps())).toEqual({ ok: true });
    expect((await meAdditionsFor(me, db!)).education).toEqual([]);
  });

  it("saves stories with their boxes and the person's own goal, marks Confirmed from work proof, and refuses someone else's goal", async () => {
    const me = await user("story");
    const other = await user("story-other");
    const mine = await goal(me, "sql");
    const theirs = await goal(other, "sql");
    expect(await saveStory(me, null, { ...story, goalId: theirs }, deps())).toMatchObject({ ok: false, error: "bad_goal", field: "goalId" });
    const out = await saveStory(me, null, { ...story, goalId: mine }, deps());
    const id = (out as { id: string }).id;
    let [saved] = (await meAdditionsFor(me, db!)).stories;
    expect(saved).toMatchObject({ id, boxes: ["Ownership", "Problem solving"], goalId: mine, confirmed: false });
    expect(await storyGoalOptions(me, db!)).toEqual([{ id: mine, name: skills.find((s) => s.id === "sql")!.name }]);
    // Accepted work proof on the goal's skill confirms it; the person can't set it.
    await db!.insert(schema.gapProofs).values({
      userId: me,
      skillId: "sql",
      type: "work",
      status: "accepted",
      evidence: { type: "work", profileId: "00000000-0000-4000-8000-0000000f0001", roleIndex: 0 },
    });
    [saved] = (await meAdditionsFor(me, db!)).stories;
    expect(saved.confirmed).toBe(true);
    // Editing replaces the boxes; someone else can't edit or delete it.
    expect(await saveStory(me, id, { ...story, boxes: ["Learning"], goalId: null }, deps())).toEqual({ ok: true, id });
    [saved] = (await meAdditionsFor(me, db!)).stories;
    expect(saved).toMatchObject({ boxes: ["Learning"], goalId: null, confirmed: false });
    expect(await saveStory(other, id, story, deps())).toEqual({ ok: false, error: "not_found" });
    expect(await deleteStory(other, id, deps())).toEqual({ ok: false, error: "not_found" });
    expect((await meAdditionsFor(other, db!)).stories).toEqual([]);
    expect(await deleteStory(me, id, deps())).toEqual({ ok: true });
    expect(await db!.select().from(schema.storyBoxes).where(eq(schema.storyBoxes.storyId, id))).toEqual([]);
  });

  it("leaves a story with no goal when its goal goes", async () => {
    const me = await user("story-goal");
    const mine = await goal(me, "excel");
    const out = await saveStory(me, null, { ...story, goalId: mine }, deps());
    await db!.delete(schema.userGoals).where(eq(schema.userGoals.id, mine));
    const [row] = await db!.select({ goalId: schema.stories.goalId }).from(schema.stories).where(eq(schema.stories.id, (out as { id: string }).id));
    expect(row.goalId).toBeNull();
    expect((await meAdditionsFor(me, db!)).stories[0]).toMatchObject({ goalId: null, confirmed: false });
  });

  it("keeps interests once per key, and removes them by name", async () => {
    const me = await user("interests");
    const other = await user("interests-other");
    expect(await addInterest(me, { name: "Photography" }, deps())).toEqual({ ok: true });
    expect(await addInterest(me, { name: "  photography " }, deps())).toMatchObject({ ok: false, error: "duplicate" });
    expect(await addInterest(me, { name: "Public  speaking" }, deps())).toEqual({ ok: true });
    expect((await meAdditionsFor(me, db!)).interests).toEqual(["Photography", "Public speaking"]);
    // Interests in common: matched by key, named as the owner wrote them.
    await addInterest(other, { name: "public speaking" }, deps());
    await addInterest(other, { name: "Chess" }, deps());
    expect(await interestsInCommonWith(other, me, db!)).toEqual({ shared: ["Public speaking"], yours: 2, theirOthers: ["Photography"] });
    expect(await interestsInCommonWith(me, me, db!)).toBeNull();
    // Removing someone else's never touches mine.
    expect(await removeInterest(other, { name: "Photography" }, deps())).toEqual({ ok: true });
    expect(await removeInterest(me, { name: "PHOTOGRAPHY" }, deps())).toEqual({ ok: true });
    expect((await meAdditionsFor(me, db!)).interests).toEqual(["Public speaking"]);
  });

  it("holds the caps: 20 roles, 50 stories and 30 interests", async () => {
    const me = await user("caps");
    await db!.insert(schema.meRoles).values(Array.from({ length: ME_ROLES_MAX }, (_, i) => ({ userId: me, title: `Role ${i}`, employer: "Example Co", startMonth: "2020-01", endMonth: "2020-02" })));
    expect(await saveMeRole(me, null, role, deps())).toEqual({ ok: false, error: "full", message: FULL_MESSAGES.roles });
    await db!.insert(schema.stories).values(Array.from({ length: STORIES_MAX }, (_, i) => ({ userId: me, title: `Story ${i}` })));
    expect(await saveStory(me, null, story, deps())).toEqual({ ok: false, error: "full", message: FULL_MESSAGES.stories });
    await db!.insert(schema.userInterests).values(Array.from({ length: INTERESTS_MAX }, (_, i) => ({ userId: me, name: `Interest ${i}`, nameKey: `interest ${i}` })));
    expect(await addInterest(me, { name: "Chess" }, deps())).toEqual({ ok: false, error: "full", message: FULL_MESSAGES.interests });
  });

  it("counts every change against the day's limit", async () => {
    const me = await user("limit");
    const limit = LIMITS.meEditsPerUserDay.max;
    LIMITS.meEditsPerUserDay.max = 2;
    const now = new Date("2026-11-02T09:00:00Z");
    try {
      expect((await addInterest(me, { name: "Chess" }, { db: db!, now })).ok).toBe(true);
      expect((await removeInterest(me, { name: "Chess" }, { db: db!, now })).ok).toBe(true);
      expect(await addInterest(me, { name: "Chess" }, { db: db!, now })).toEqual({ ok: false, error: "limit" });
    } finally {
      LIMITS.meEditsPerUserDay.max = limit;
    }
  });

  it("exports all of it (version 32), and the account's deletion takes all of it", async () => {
    const me = await user("export");
    const g = await goal(me, "sql");
    await saveMeRole(me, null, role, deps());
    await saveMeEducation(me, null, { qualification: "Data Analytics with Python", institution: "NPTEL", year: "2025" }, deps());
    await saveStory(me, null, { ...story, goalId: g }, deps());
    await addInterest(me, { name: "Photography" }, deps());
    const data = await exportAccountData(me, db! as never);
    expect(EXPORT_VERSION).toBe(34);
    expect(data!.exportVersion).toBe(34);
    expect(data!.meRoles.map((r) => meRoleExport.parse(r))).toMatchObject([{ title: role.title, employer: role.employer, startMonth: "2023-06" }]);
    expect(meEducationExport.parse(data!.meEducation[0])).toMatchObject({ institution: "NPTEL", year: "2025" });
    expect(storyExport.parse(data!.stories[0])).toMatchObject({ boxes: ["Ownership", "Problem solving"], goalSkill: skills.find((s) => s.id === "sql")!.name, source: "user" });
    expect(interestExport.parse(data!.interests[0])).toMatchObject({ name: "Photography" });
    expect(JSON.stringify(data!.stories)).not.toContain(g);

    await db!.delete(schema.users).where(eq(schema.users.id, me));
    const left = await Promise.all([
      db!.select().from(schema.meRoles).where(eq(schema.meRoles.userId, me)),
      db!.select().from(schema.meEducation).where(eq(schema.meEducation.userId, me)),
      db!.select().from(schema.stories).where(eq(schema.stories.userId, me)),
      db!.select().from(schema.userInterests).where(and(eq(schema.userInterests.userId, me))),
    ]);
    expect(left.map((rows) => rows.length)).toEqual([0, 0, 0, 0]);
  });
});
