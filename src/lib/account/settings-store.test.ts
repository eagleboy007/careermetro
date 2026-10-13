import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { DEFAULT_SETTINGS, settingsInput, type SettingsInput } from "@/lib/schemas";
import { exportAccountData } from "./export";
import { canViewProfile, checkUsername, clearExpiredUsernameRedirects, findProfile, readAccountSettings, resolveProfile, saveAccountSettings, settingsFor } from "./settings-store";

// Runs against a real Postgres with migrations applied, like the other store tests. Every user here is this run's own.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const DAY = 24 * 3600_000;

describe.skipIf(!db)("account settings store (database)", () => {
  // Usernames are global, so each run uses its own: short enough to stay within 30 characters.
  const run = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const userIds: string[] = [];
  let a = "";
  let b = "";
  let c = "";

  const makeUser = async (n: string) => {
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name: "Test Person" }).returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    [a, b, c] = await Promise.all([makeUser("a"), makeUser("b"), makeUser("c")]);
  });
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  const form = (over: Partial<Record<keyof SettingsInput, unknown>> = {}): SettingsInput =>
    settingsInput.parse({ username: "", headline: "", currentPay: "", expectedPay: "", settings: DEFAULT_SETTINGS, ...over });

  it("starts with the defaults and no pay", async () => {
    const s = await readAccountSettings(a, new Date(), db!);
    expect(s).toEqual({ username: null, usernameLockedUntil: null, headline: null, settings: DEFAULT_SETTINGS, pay: { currentLakh: null, expectedLakh: null } });
  });

  it("saves username, headline, pay and settings together", async () => {
    const now = new Date();
    const settings = { ...DEFAULT_SETTINGS, visibility: "signed_in" as const, showGaps: true, rideReminder: "21:30" as const };
    const r = await saveAccountSettings(a, form({ username: `${run}-A`, headline: " Moving into SOC ", currentPay: "4.2", expectedPay: "6", settings }), now, db!);
    expect(r).toEqual({ ok: true });
    const s = await readAccountSettings(a, now, db!);
    expect(s?.username).toBe(`${run}-a`);
    expect(s?.headline).toBe("Moving into SOC");
    expect(s?.pay).toEqual({ currentLakh: 4.2, expectedLakh: 6 });
    expect(s?.settings).toEqual(settings);
    expect(s?.usernameLockedUntil?.getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it("treats usernames as one ignoring case, for checks and saves", async () => {
    const now = new Date();
    expect(await checkUsername(b, `${run}-A`, now, db!)).toEqual({ state: "taken" });
    expect(await checkUsername(a, `${run}-a`, now, db!)).toEqual({ state: "yours" });
    expect(await checkUsername(b, `${run}-b`, now, db!)).toEqual({ state: "available" });
    expect(await checkUsername(b, "admin", now, db!)).toEqual({ state: "invalid", message: expect.stringMatching(/reserved/) });
    const r = await saveAccountSettings(b, form({ username: `${run}-A` }), now, db!);
    expect(r).toEqual({ ok: false, errors: { username: "Taken. Try another." } });
    // A refused username saves nothing else either.
    const refused = await saveAccountSettings(b, form({ username: `${run}-a`, headline: "Should not stay" }), now, db!);
    expect(refused.ok).toBe(false);
    expect((await readAccountSettings(b, now, db!))?.headline).toBeNull();
  });

  it("allows one change every 30 days, and the old link redirects for 14 days, held for its owner", async () => {
    const t0 = new Date();
    const soon = await saveAccountSettings(a, form({ username: `${run}-a2` }), new Date(t0.getTime() + 5 * DAY), db!);
    expect(soon.ok).toBe(false);
    if (!soon.ok) expect(soon.errors.username).toMatch(/^You can change your username again on /);
    // Saving the same username again isn't a change.
    expect(await saveAccountSettings(a, form({ username: `${run}-a` }), new Date(t0.getTime() + 5 * DAY), db!)).toEqual({ ok: true });

    const later = new Date(t0.getTime() + 31 * DAY);
    expect(await saveAccountSettings(a, form({ username: `${run}-a2` }), later, db!)).toEqual({ ok: true });
    expect(await findProfile(`${run}-a`, later, db!)).toMatchObject({ owner: { id: a, username: `${run}-a2` }, redirectTo: `${run}-a2` });
    expect(await findProfile(`${run}-a2`, later, db!)).toEqual({ owner: expect.objectContaining({ id: a }) });
    expect(await findProfile(`${run}-A2`, later, db!)).toMatchObject({ redirectTo: `${run}-a2` });
    // Nobody else can take the old one while it redirects; after 14 days it is free.
    expect(await saveAccountSettings(b, form({ username: `${run}-a` }), new Date(later.getTime() + DAY), db!)).toEqual({
      ok: false,
      errors: { username: "Taken. Try another." },
    });
    const after = new Date(later.getTime() + 15 * DAY);
    expect(await findProfile(`${run}-a`, after, db!)).toBeNull();
    expect(await saveAccountSettings(b, form({ username: `${run}-a` }), after, db!)).toEqual({ ok: true });
    expect(await findProfile(`${run}-a`, after, db!)).toMatchObject({ owner: { id: b } });
  });

  it("decides who may see a profile before any redirect, so old names and other spellings never show a hidden one", async () => {
    const [f, g] = await Promise.all([makeUser("f"), makeUser("g")]);
    const t0 = new Date();
    const later = new Date(t0.getTime() + 31 * DAY);
    await saveAccountSettings(f, form({ username: `${run}-f` }), t0, db!);
    await saveAccountSettings(f, form({ username: `${run}-f2` }), later, db!);
    const notFound = { kind: "not_found" };
    // Only you (the default): an old name and the wrong case answer exactly like a name nobody has.
    expect(await resolveProfile(`${run}-f`, g, later, db!)).toEqual(notFound);
    expect(await resolveProfile(`${run}-F2`, g, later, db!)).toEqual(notFound);
    expect(await resolveProfile(`${run}-f2`, g, later, db!)).toEqual(notFound);
    expect(await resolveProfile(`${run}-nobody`, g, later, db!)).toEqual(notFound);
    // The owner is sent on from either.
    expect(await resolveProfile(`${run}-f`, f, later, db!)).toEqual({ kind: "redirect", to: `${run}-f2` });
    // Open to everyone signed in: redirects, then the profile.
    const open = { ...DEFAULT_SETTINGS, visibility: "signed_in" as const };
    await saveAccountSettings(f, form({ username: `${run}-f2`, settings: open }), later, db!);
    expect(await resolveProfile(`${run}-f`, g, later, db!)).toEqual({ kind: "redirect", to: `${run}-f2` });
    expect(await resolveProfile(`${run}-F2`, g, later, db!)).toEqual({ kind: "redirect", to: `${run}-f2` });
    expect(await resolveProfile(`${run}-f2`, g, later, db!)).toMatchObject({ kind: "show", owner: { id: f } });
    // Blocked: the old name and the wrong case are not found too.
    await db!.insert(schema.blocks).values({ blockerId: f, blockedId: g });
    expect(await resolveProfile(`${run}-f`, g, later, db!)).toEqual(notFound);
    expect(await resolveProfile(`${run}-F2`, g, later, db!)).toEqual(notFound);
    expect(await resolveProfile(`${run}-f2`, g, later, db!)).toEqual(notFound);
    // The daily clean-up deletes old names once their 14 days are over.
    expect(await clearExpiredUsernameRedirects(db!, new Date(later.getTime() + 13 * DAY))).toBeGreaterThanOrEqual(0);
    expect(await db!.select().from(schema.usernameRedirects).where(eq(schema.usernameRedirects.userId, f))).toHaveLength(1);
    expect(await clearExpiredUsernameRedirects(db!, new Date(later.getTime() + 15 * DAY))).toBeGreaterThanOrEqual(1);
    expect(await db!.select().from(schema.usernameRedirects).where(eq(schema.usernameRedirects.userId, f))).toHaveLength(0);
  });

  it("deletes pay when both values are cleared", async () => {
    await saveAccountSettings(c, form({ currentPay: "3" }), new Date(), db!);
    expect(await db!.select().from(schema.userPay).where(eq(schema.userPay.userId, c))).toHaveLength(1);
    await saveAccountSettings(c, form(), new Date(), db!);
    expect(await db!.select().from(schema.userPay).where(eq(schema.userPay.userId, c))).toHaveLength(0);
  });

  it("shows a profile only as its owner chose, never to someone blocked", async () => {
    const owner = { id: c, settings: DEFAULT_SETTINGS };
    expect(await canViewProfile(owner, c, db!)).toBe(true);
    expect(await canViewProfile(owner, a, db!)).toBe(false);
    const open = { id: c, settings: { ...DEFAULT_SETTINGS, visibility: "signed_in" as const } };
    expect(await canViewProfile(open, a, db!)).toBe(true);
    await db!.insert(schema.blocks).values({ blockerId: c, blockedId: a });
    expect(await canViewProfile(open, a, db!)).toBe(false);
    expect(await canViewProfile(open, b, db!)).toBe(true);
    // People on your line: neither has a target role here, so no.
    expect(await canViewProfile({ id: c, settings: { ...DEFAULT_SETTINGS, visibility: "line" } }, b, db!)).toBe(false);
  });

  it("hides the profile of an account waiting to be deleted", async () => {
    const now = new Date();
    await saveAccountSettings(c, form({ username: `${run}-c` }), now, db!);
    expect(await findProfile(`${run}-c`, now, db!)).toMatchObject({ owner: { id: c } });
    await db!.update(schema.users).set({ deletionRequestedAt: now }).where(eq(schema.users.id, c));
    expect(await findProfile(`${run}-c`, now, db!)).toBeNull();
    expect((await saveAccountSettings(c, form(), now, db!)).ok).toBe(false);
  });

  it("puts settings, pay and old usernames in the download", async () => {
    const settings = { ...DEFAULT_SETTINGS, visibility: "signed_in" as const, showGaps: true, rideReminder: "21:30" as const };
    await saveAccountSettings(a, form({ username: `${run}-a2`, headline: "Moving into SOC", currentPay: "4.2", expectedPay: "6", settings }), new Date(), db!);
    const data = await exportAccountData(a, db!);
    expect(data?.account).toMatchObject({ username: `${run}-a2`, headline: "Moving into SOC" });
    expect(data?.settings).toMatchObject({ visibility: "signed_in", showGaps: true, rideReminder: "21:30" });
    expect(data?.pay).toMatchObject({ currentLakh: 4.2, expectedLakh: 6 });
    expect(data?.oldUsernames.map((o) => o.username)).toEqual([]);
    const e = await makeUser("e");
    const fresh = await exportAccountData(e, db!);
    expect(fresh?.pay).toBeNull();
    expect(fresh?.settings).toEqual({ ...DEFAULT_SETTINGS, savedAt: null });
    expect(await settingsFor(e, db!)).toEqual(DEFAULT_SETTINGS);
  });

  it("removes settings, pay and old usernames with the account", async () => {
    const d = await makeUser("d");
    await saveAccountSettings(d, form({ username: `${run}-d`, currentPay: "5" }), new Date(), db!);
    await saveAccountSettings(d, form({ username: `${run}-d2` }), new Date(Date.now() + 31 * DAY), db!);
    await db!.delete(schema.users).where(eq(schema.users.id, d));
    for (const t of [schema.userPay, schema.userSettings, schema.usernameRedirects])
      expect(await db!.select().from(t).where(eq(t.userId, d))).toHaveLength(0);
  });
});
