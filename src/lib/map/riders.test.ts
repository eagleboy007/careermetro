import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { pairOf } from "@/lib/network/rules";
import type { GapAnalysis } from "@/lib/schemas";
import { MAP_SHARE_CHANGES_PER_DAY } from "@/lib/schemas/constants";
import { MAP_SHARE_MESSAGES, pitstopRidersFor, setShowOnMap, showOnMapFor } from "./riders";

vi.mock("server-only", () => ({}));

// On your line (C13, docs/plans/on-your-line-plan.md): "Show my pitstop on the map" and the people on a viewer's
// pitstops, against a real Postgres with migrations applied. Every person here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("On your line store (database)", () => {
  const run = `riders${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  const now = new Date("2026-10-31T09:00:00Z");
  let n = 0;
  let skillN = 0;
  const testSkills: string[] = [];
  const newSkill = async () => {
    const id = `t-riders-${Date.now()}-${skillN++}`;
    await db!.insert(schema.skills).values({ id, name: `Riders skill ${skillN}`, category: "test" });
    testSkills.push(id);
    return id;
  };

  type Who = {
    name?: string | null;
    on?: boolean | null;
    settings?: Partial<typeof schema.userSettings.$inferInsert>;
    status?: "active" | "met" | "skipped";
    user?: Partial<typeof schema.users.$inferInsert>;
  };
  const person = async (name: string | null = "Rider Person", u: Partial<typeof schema.users.$inferInsert> = {}) => {
    const [row] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.test`, authSubject: `${run}-${n++}`, name, ...u })
      .returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  };
  /** Someone with an active goal on `skill`; `on: null` leaves them with no settings row. */
  const rider = async (skill: string, { name = "Rider Person", on = true, settings = {}, status = "active", user: u = {} }: Who = {}) => {
    const id = await person(name, u);
    if (on !== null) await db!.insert(schema.userSettings).values({ userId: id, showOnMap: on, profileVisibility: "connections", ...settings });
    await db!.insert(schema.userGoals).values({ userId: id, skillId: skill, status, position: 0 });
    return id;
  };
  const connect = (a: string, b: string) => db!.insert(schema.connections).values({ ...pairOf(a, b), how: "worked_together" });

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    if (testSkills.length) await db!.delete(schema.skills).where(inArray(schema.skills.id, testSkills));
    await sqlClient?.end();
    // Names, handles and skills never reach a log.
    expect(lines.join("\n")).not.toMatch(/Asha|Ravi|Neha|t-riders/);
  });

  it("starts everyone off the map, with no row, and the switch changes that person only", async () => {
    const me = await person();
    const other = await person();
    expect(await showOnMapFor(me, db!)).toBe(false);
    expect(await setShowOnMap(me, true, { db: db!, now })).toEqual({ ok: true, on: true });
    expect(await showOnMapFor(me, db!)).toBe(true);
    expect(await showOnMapFor(other, db!)).toBe(false);
    // A first save keeps a new user's other defaults.
    const [row] = await db!.select().from(schema.userSettings).where(eq(schema.userSettings.userId, me));
    expect(row).toMatchObject({ showOnMap: true, profileVisibility: "connections", gapsVisibleTo: "connections", companiesCanFind: false, peopleCanFind: false });
    expect(await setShowOnMap(me, false, { db: db!, now })).toEqual({ ok: true, on: false });
    expect(await showOnMapFor(me, db!)).toBe(false);
  });

  it("keeps the person's other settings, refuses anything but on or off, and the 21st change in a day", async () => {
    const me = await person();
    await db!.insert(schema.userSettings).values({ userId: me, profileVisibility: "signed_in", companiesCanFind: true });
    expect(await setShowOnMap(me, "on", { db: db!, now })).toEqual({ ok: false, error: "invalid" });
    await setShowOnMap(me, true, { db: db!, now });
    const [row] = await db!.select().from(schema.userSettings).where(eq(schema.userSettings.userId, me));
    expect(row).toMatchObject({ showOnMap: true, profileVisibility: "signed_in", companiesCanFind: true });
    for (let i = 1; i < MAP_SHARE_CHANGES_PER_DAY; i++) expect((await setShowOnMap(me, i % 2 === 0, { db: db!, now })).ok).toBe(true);
    expect(await setShowOnMap(me, true, { db: db!, now })).toEqual({ ok: false, error: "limit" });
    expect(MAP_SHARE_MESSAGES.limit).toMatch(/tomorrow/);
  });

  it("counts only opted-in people, from 3, never anyone who hasn't opted in", async () => {
    const skill = await newSkill();
    const viewer = await rider(skill, { name: "Viewer Person", on: false });
    expect(await pitstopRidersFor(viewer, [skill], db!)).toEqual([]);
    // Not opted in, or no settings at all: never counted, not even anonymously.
    for (let i = 0; i < 4; i++) await rider(skill, { on: false });
    await rider(skill, { on: null });
    await rider(skill);
    const second = await rider(skill);
    expect(await pitstopRidersFor(viewer, [skill], db!)).toEqual([]);
    const third = await rider(skill);
    expect(await pitstopRidersFor(viewer, [skill], db!)).toEqual([{ skillId: skill, count: 3, names: [], more: 0 }]);
    // Off takes the person out on the next read.
    await setShowOnMap(third, false, { db: db!, now });
    expect(await pitstopRidersFor(viewer, [skill], db!)).toEqual([]);
    await setShowOnMap(third, true, { db: db!, now });
    // The viewer is never counted on their own pitstop, switch on or not.
    await setShowOnMap(viewer, true, { db: db!, now });
    expect((await pitstopRidersFor(viewer, [skill], db!))[0]?.count).toBe(3);
    expect((await pitstopRidersFor(second, [skill], db!))[0]?.count).toBe(3);
  });

  it("leaves out blocks either way, suspended, deleting and nameless accounts, and goals not active", async () => {
    const skill = await newSkill();
    const viewer = await person("Viewer Person");
    for (let i = 0; i < 3; i++) await rider(skill);
    const blocked = await rider(skill);
    await db!.insert(schema.blocks).values({ blockerId: viewer, blockedId: blocked });
    const blocker = await rider(skill);
    await db!.insert(schema.blocks).values({ blockerId: blocker, blockedId: viewer });
    await rider(skill, { user: { suspendedAt: now } });
    await rider(skill, { user: { deletionRequestedAt: now } });
    await rider(skill, { name: null });
    await rider(skill, { name: "   " });
    await rider(skill, { status: "met" });
    await rider(skill, { status: "skipped" });
    expect(await pitstopRidersFor(viewer, [skill], db!)).toEqual([{ skillId: skill, count: 3, names: [], more: 0 }]);
  });

  it("doesn't count a goal left on someone's earlier line after a change of destination", async () => {
    const skill = await newSkill();
    const viewer = await person("Viewer Person");
    for (let i = 0; i < 2; i++) await rider(skill);
    const switched = await rider(skill);
    expect((await pitstopRidersFor(viewer, [skill], db!))[0]?.count).toBe(3);
    // Their current destination's gaps don't include the skill: the gap goal waits on the earlier line.
    const [resume] = await db!.insert(schema.resumes).values({ userId: switched, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    const data = { headline: null, totalYearsExperience: null, roles: [], skills: [], education: [], certifications: [] };
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data, confirmedByUser: true }).returning();
    const result = { roleSlug: "data-analyst", gaps: [{ skillId: "some-other-skill" }], metSkillIds: [] } as unknown as GapAnalysis;
    await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result, matcherVersion: MATCHER_VERSION });
    expect(await pitstopRidersFor(viewer, [skill], db!)).toEqual([]);
  });

  it("names only connections whose profile isn't Only you and whose gaps aren't for nobody, three at most", async () => {
    const skill = await newSkill();
    const other = await newSkill();
    const viewer = await person("Viewer Person");
    // Not a connection: counted, never named.
    await rider(skill, { name: "Stranger Example", settings: { profileVisibility: "signed_in", gapsVisibleTo: "profile" } });
    const asha = await rider(skill, { name: "Asha Kulkarni" });
    await db!.update(schema.users).set({ username: `${run}-asha` }).where(eq(schema.users.id, asha));
    const ravi = await rider(skill, { name: "Ravi Menon" });
    const hidden = await rider(skill, { name: "Hidden Example", settings: { profileVisibility: "only_me" } });
    const nobody = await rider(skill, { name: "Nobody Example", settings: { gapsVisibleTo: "nobody" } });
    const off = await rider(skill, { name: "Off Example", on: false });
    for (const id of [asha, ravi, hidden, nobody, off]) await connect(viewer, id);
    const [first] = await pitstopRidersFor(viewer, [skill, other], db!);
    // Five opted in (Off isn't); Asha and Ravi named, by name; Hidden and Nobody only in the count.
    expect(first).toEqual({
      skillId: skill,
      count: 5,
      names: [
        { name: "Asha K.", handle: `${run}-asha` },
        { name: "Ravi M.", handle: null },
      ],
      more: 0,
    });
    // Gaps to Nobody drops Ravi from the names; the count stays.
    await db!.update(schema.userSettings).set({ gapsVisibleTo: "nobody" }).where(eq(schema.userSettings.userId, ravi));
    expect((await pitstopRidersFor(viewer, [skill], db!))[0]).toMatchObject({ count: 5, names: [{ name: "Asha K." }] });
    // More than three connections: three names, then how many more.
    for (const name of ["Neha Shah", "Bina Rao", "Chetan Das", "Dev Iyer"]) await connect(viewer, await rider(skill, { name }));
    const many = (await pitstopRidersFor(viewer, [skill], db!))[0];
    expect(many.count).toBe(9);
    expect(many.names.map((x) => x.name)).toEqual(["Asha K.", "Bina R.", "Chetan D."]);
    expect(many.more).toBe(2);
  });

  it("puts the switch in Download your data, version 39, and nobody else's counts or names", async () => {
    const skill = await newSkill();
    const me = await rider(skill, { name: "Export Person" });
    for (let i = 0; i < 3; i++) await rider(skill, { name: "Neha Shah" });
    const data = await exportAccountData(me, db!);
    expect(EXPORT_VERSION).toBe(40);
    expect(data!.exportVersion).toBe(40);
    expect(data!.settings).toMatchObject({ showOnMap: true });
    expect(JSON.stringify(data)).not.toMatch(/Neha/);
    const fresh = await exportAccountData(await person("Fresh Person"), db!);
    expect(fresh!.settings).toMatchObject({ showOnMap: false });
  });
});
