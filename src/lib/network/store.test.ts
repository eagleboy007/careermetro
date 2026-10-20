import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles, skills } from "@/content";
import { networkPairLock } from "@/db/lock";
import * as schema from "@/db/schema";
import { exportAccountData } from "@/lib/account/export";
import { canViewProfile } from "@/lib/account/settings-store";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { acceptRequest, blockInChat, sendMessage, startDirect } from "@/lib/inbox/store";
import { DEFAULT_SETTINGS, type GapAnalysis, type Profile } from "@/lib/schemas";
import { CONNECTION_PENDING_MAX, NETWORK_RESULTS_MAX } from "@/lib/schemas/network";
import { LIMITS } from "@/lib/shared-limit";
import {
  answerRequest,
  areConnected,
  blockPerson,
  blockedPeople,
  connectionWith,
  exportNetwork,
  inCommonWith,
  mutualConnections,
  networkFiltersFor,
  networkLists,
  networkSettingsFor,
  pathTogetherWith,
  removeConnection,
  reportPerson,
  requestConnection as ask,
  requestsWaiting,
  saveNetworkSettings,
  searchNetwork as search,
  unblockPerson,
  withdrawRequest,
} from "./store";

vi.mock("server-only", () => ({}));

// Network part 1 (FR-49) against a real Postgres with migrations applied, like the other store tests. Every person here
// is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const DAY = 86_400_000;

const profile: Profile = {
  headline: null,
  totalYearsExperience: 2,
  roles: [{ title: "Analyst", employer: "Example Co", start: "2024-01", end: null, highlights: [] }],
  skills: [{ name: "SQL", lastUsed: "2026", evidence: [] }],
  education: [],
  certifications: [],
};
const analysis = (met: string[], gaps: string[] = [], roleSlug = roleProfiles[0].slug): GapAnalysis => ({
  roleSlug,
  gaps: gaps.map((skillId) => ({ skillId, skillName: skillId, status: "missing" as const, resumeQuote: null, requirement: "r", explanation: "e" })),
  metSkillIds: met,
  niceToHave: [],
  readiness: { headline: "h", explanation: "e", estimatedHours: 0 },
});

describe.skipIf(!db)("network store (database)", () => {
  const run = `net${Date.now()}`;
  // A word no one else's name has, so searches here find only these people.
  const tag = `Zq${run.slice(-6)}`;
  const userIds: string[] = [];
  let n = 0;
  // The real clock: the daily clean-up in other test files deletes rate-limit windows by it.
  const now = new Date();
  const deps = (days = 0) => ({ db: db!, now: new Date(now.getTime() + days * DAY) });
  const lines: string[] = [];

  async function person(
    first: string,
    opts: { met?: string[]; gaps?: string[]; role?: string; findable?: boolean; closed?: boolean; username?: string; showTargetRole?: boolean; city?: string } = {},
  ) {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: `${first} ${tag}`, username: opts.username ?? null, city: opts.city ?? null })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    if (opts.met) {
      const [resume] = await db!.insert(schema.resumes).values({ userId: u.id, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
      const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
      await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: analysis(opts.met, opts.gaps, opts.role), matcherVersion: MATCHER_VERSION });
    }
    if (opts.findable) await saveNetworkSettings(u.id, { peopleCanFind: true, gapsVisibleTo: "connections", requestsFrom: opts.closed ? "nobody" : "anyone" }, deps());
    else if (opts.closed) await saveNetworkSettings(u.id, { peopleCanFind: false, gapsVisibleTo: "connections", requestsFrom: "nobody" }, deps());
    if (opts.showTargetRole) await db!.update(schema.userSettings).set({ showTargetRole: true }).where(inArray(schema.userSettings.userId, [u.id]));
    return u.id;
  }

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
    // Logs carry event names only: never a name, a handle or what was typed.
    const all = lines.join("\n");
    for (const secret of [tag, "Asha", "lata_", run]) expect(all).not.toContain(secret);
  });

  const ok = (state: string) => ({ ok: true, state });

  it("sends a request with how you know them, accepts it, and removes the connection from either side", async () => {
    const a = await person("Asha");
    const b = await person("Vikram");
    expect(await ask(a, b, "typed note", deps())).toEqual({ ok: false, error: "invalid" });
    expect(await ask(a, b, "worked_together", deps())).toEqual(ok("requested"));
    // Asking again changes nothing: one open request per pair.
    expect(await ask(a, b, "other", deps())).toEqual(ok("requested"));
    expect(await connectionWith(a, b, deps())).toBe("requested");
    expect(await connectionWith(b, a, deps())).toBe("incoming");
    expect(await requestsWaiting(b, deps())).toBe(1);
    expect((await networkLists(a, deps())).sent).toMatchObject([{ id: b, how: "worked_together", state: "requested", endsAt: expect.any(Date) }]);
    expect((await networkLists(b, deps())).requests).toMatchObject([{ name: `Asha ${tag}`, how: "worked_together" }]);
    // Only the receiver answers.
    expect(await answerRequest(a, b, "accept", deps())).toEqual({ ok: false, error: "not_found" });
    expect(await answerRequest(b, a, "maybe", deps())).toEqual({ ok: false, error: "invalid" });
    expect(await answerRequest(b, a, "accept", deps())).toEqual(ok("connected"));
    expect(await areConnected(a, b, db!)).toBe(true);
    expect(await requestsWaiting(b, deps())).toBe(0);
    expect((await networkLists(a, deps())).connections).toMatchObject([{ id: b, how: "worked_together", state: "connected" }]);
    expect(await removeConnection(b, a, db!)).toEqual({ ok: true });
    expect(await areConnected(a, b, db!)).toBe(false);
    expect(await removeConnection(a, b, db!)).toEqual({ ok: false, error: "not_found" });
    // Either person can connect again.
    expect(await ask(b, a, "same_line", deps())).toEqual(ok("requested"));
  });

  it("connects two people who ask each other", async () => {
    const a = await person("Asha");
    const b = await person("Bina");
    await ask(a, b, "event", deps());
    expect(await ask(b, a, "other", deps())).toEqual(ok("connected"));
    expect((await networkLists(b, deps())).connections).toMatchObject([{ id: a, how: "event" }]);
  });

  it("ignores silently, lets the sender withdraw, ends requests after 30 days and makes the sender wait", async () => {
    const a = await person("Asha");
    const b = await person("Chitra");
    await ask(a, b, "studied_together", deps());
    expect(await answerRequest(b, a, "ignore", deps())).toEqual(ok("none"));
    // The sender still reads Requested; the receiver has nothing waiting.
    expect(await connectionWith(a, b, deps())).toBe("requested");
    expect((await networkLists(a, deps())).sent.map((p) => p.id)).toEqual([b]);
    expect(await requestsWaiting(b, deps())).toBe(0);
    expect((await networkLists(b, deps())).requests).toEqual([]);
    // The sender's download doesn't say it was ignored.
    expect((await exportNetwork(a, db!, deps().now)).requestsSent).toMatchObject([{ status: "pending", decidedAt: null }]);
    // It reads Requested until it would have ended; then they can ask again, as after no answer.
    expect(await ask(a, b, "other", deps(29))).toEqual(ok("requested"));
    expect(await connectionWith(a, b, deps(31))).toBe("none");
    expect(await ask(a, b, "other", deps(31))).toEqual(ok("requested"));
    // Withdraw is silent, but the withdrawn request still holds the sender until it would have ended.
    expect(await withdrawRequest(b, a, deps(31))).toEqual({ ok: false, error: "not_found" });
    expect(await withdrawRequest(a, b, deps(31))).toEqual({ ok: true });
    expect(await connectionWith(b, a, deps(31))).toBe("none");
    expect(await ask(a, b, "other", deps(31))).toEqual({ ok: false, error: "wait" });
    expect(await ask(a, b, "other", deps(62))).toEqual(ok("requested"));
    // Unanswered, it ends after 30 days: the sender's download says expired, and either side can ask again.
    expect(await answerRequest(b, a, "accept", deps(93))).toEqual({ ok: false, error: "not_found" });
    expect((await exportNetwork(a, db!, deps(93).now)).requestsSent.at(-1)).toMatchObject({ status: "expired" });
    expect(await withdrawRequest(a, b, deps(93))).toEqual({ ok: false, error: "not_found" });
    expect(await ask(b, a, "other", deps(93))).toEqual(ok("requested"));
  });

  it("lets the person who ignored change their mind with Connect", async () => {
    const a = await person("Asha");
    const b = await person("Diya");
    await ask(a, b, "other", deps());
    await answerRequest(b, a, "ignore", deps());
    expect(await ask(b, a, "other", deps())).toEqual(ok("connected"));
  });

  it("refuses yourself, blocked, deleted, suspended and closed people, and a block ends a connection", async () => {
    const a = await person("Asha");
    const b = await person("Dev");
    expect(await ask(a, a, "other", deps())).toEqual({ ok: false, error: "self" });
    await ask(a, b, "other", deps());
    await answerRequest(b, a, "accept", deps());
    expect(await blockPerson(b, a, deps())).toEqual({ ok: true });
    expect(await areConnected(a, b, db!)).toBe(false);
    expect(await ask(a, b, "other", deps())).toEqual({ ok: false, error: "unavailable" });
    expect(await ask(b, a, "other", deps())).toEqual({ ok: false, error: "unavailable" });
    // A block hides profiles both ways.
    const open = { ...DEFAULT_SETTINGS, visibility: "signed_in" as const };
    expect(await canViewProfile({ id: a, settings: open }, b, db!)).toBe(false);
    expect(await canViewProfile({ id: b, settings: open }, a, db!)).toBe(false);

    // Blocking from an Inbox chat ends the connection too.
    const c = await person("Esha");
    await ask(a, c, "other", deps());
    await answerRequest(c, a, "accept", deps());
    const chat = await startDirect(a, c, "Hello", { db: db! });
    if (!chat.ok) throw new Error(chat.error);
    await acceptRequest(c, chat.conversationId, { db: db! });
    expect((await blockInChat(c, chat.conversationId, { db: db! })).ok).toBe(true);
    expect(await areConnected(a, c, db!)).toBe(false);

    const gone = await person("Farah");
    const held = await person("Gita");
    await ask(gone, a, "other", deps());
    await ask(held, a, "other", deps());
    await db!.update(schema.users).set({ deletionRequestedAt: now }).where(inArray(schema.users.id, [gone]));
    await db!.update(schema.users).set({ suspendedAt: now, suspendedReason: "Test" }).where(inArray(schema.users.id, [held]));
    expect(await ask(a, gone, "other", deps())).toEqual({ ok: false, error: "unavailable" });
    expect(await ask(a, held, "other", deps())).toEqual({ ok: false, error: "unavailable" });
    // Their requests stop showing at once.
    expect(await requestsWaiting(a, deps())).toBe(0);
    expect((await networkLists(a, deps())).requests).toEqual([]);

    // "Connection requests from: Nobody".
    const closed = await person("Ira", { closed: true });
    expect(await ask(a, closed, "other", deps())).toEqual({ ok: false, error: "closed" });
  });

  it("refuses to block an id that names nobody, without touching the foreign key (Testing Run 5, T84)", async () => {
    const a = await person("Asha");
    expect(await blockPerson(a, "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69", deps())).toEqual({ ok: false, error: "not_found" });
    expect(await blockedPeople(a, db!)).toEqual([]);
  });

  it("a block from the Inbox waits for Network's pair lock, so an accept at the same moment can't keep the connection (T83)", async () => {
    const a = await person("Asha");
    const c = await person("Esha");
    await ask(a, c, "other", deps());
    await answerRequest(c, a, "accept", deps());
    const chat = await startDirect(a, c, "Hello", { db: db! });
    if (!chat.ok) throw new Error(chat.error);
    // Another transaction holds the pair's lock, as an accept would.
    let release = () => {};
    let locked = () => {};
    const held = new Promise<void>((r) => (locked = r));
    const holder = db!.transaction(async (tx) => {
      await networkPairLock(a, c, tx);
      locked();
      await new Promise<void>((r) => (release = r));
    });
    await held;
    let done = false;
    const blocking = blockInChat(c, chat.conversationId, { db: db! }).then((r) => ((done = true), r));
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false);
    release();
    await holder;
    expect((await blocking).ok).toBe(true);
    expect(await areConnected(a, c, db!)).toBe(false);
  });

  it("lists the people you blocked, newest first, and Unblock lifts only your own block (gap list item 34)", async () => {
    const a = await person("Asha");
    const b = await person("Dev");
    const c = await person("Esha");
    const gone = await person("Farah");
    await ask(a, b, "other", deps());
    await answerRequest(b, a, "accept", deps());
    await blockPerson(a, b, deps());
    await blockPerson(a, c, deps(1));
    await blockPerson(a, gone, deps(2));
    await blockPerson(c, a, deps());
    await db!.update(schema.users).set({ deletionRequestedAt: now }).where(inArray(schema.users.id, [gone]));
    // Newest first; a deleted account is left out; a block on you never shows.
    expect((await blockedPeople(a, db!)).map((p) => p.id)).toEqual([c, b]);
    expect((await blockedPeople(a, db!))[1]).toMatchObject({ name: `Dev ${tag}` });
    expect((await blockedPeople(b, db!)).length).toBe(0);
    expect(await unblockPerson(a, a, db!)).toEqual({ ok: false, error: "self" });
    // Only the blocker can lift a block.
    expect(await unblockPerson(b, a, db!)).toEqual({ ok: false, error: "not_found" });
    expect(await unblockPerson(a, b, db!)).toEqual({ ok: true });
    expect((await blockedPeople(a, db!)).map((p) => p.id)).toEqual([c]);
    // The connection the block ended stays ended, and either can ask again.
    expect(await areConnected(a, b, db!)).toBe(false);
    expect(await ask(b, a, "other", deps())).toEqual(ok("requested"));
    // Lifting your block leaves theirs: c blocked a too.
    expect(await unblockPerson(a, c, db!)).toEqual({ ok: true });
    expect(await ask(a, c, "other", deps())).toEqual({ ok: false, error: "unavailable" });
    expect(await unblockPerson(a, c, db!)).toEqual({ ok: false, error: "not_found" });
  });

  it("caps unblocks a day, each try counted, and a refused one leaves the block in place (launch-readiness pass)", async () => {
    const a = await person("Asha");
    const b = await person("Gita");
    await blockPerson(a, b, deps());
    const stranger = await person("Hema");
    for (let i = 0; i < LIMITS.unblocksPerUserDay.max; i++) expect(await unblockPerson(a, stranger, db!, now)).toEqual({ ok: false, error: "not_found" });
    expect(await unblockPerson(a, b, db!, now)).toEqual({ ok: false, error: "limit" });
    expect((await blockedPeople(a, db!)).map((p) => p.id)).toEqual([b]);
    // Someone else's count is their own.
    expect(await unblockPerson(b, a, db!, now)).toEqual({ ok: false, error: "not_found" });
  });

  it("caps requests a day", async () => {
    const a = await person("Asha");
    const others = await Promise.all(Array.from({ length: LIMITS.networkRequestsPerUser.max + 1 }, (_, i) => person(`Hari${i}`)));
    for (const o of others.slice(0, -1)) expect((await ask(a, o, "other", deps())).ok).toBe(true);
    expect(await ask(a, others.at(-1)!, "other", deps())).toEqual({ ok: false, error: "limit" });
    expect(CONNECTION_PENDING_MAX).toBe(100);
  });

  it("finds connections and people who turned the switch on, best first, with filters", async () => {
    const me = await person("Asha", { met: ["sql", "python", "excel"], city: "Pune" });
    const friend = await person("Kiran", { met: [] });
    const asked = await person("Kunal");
    const close = await person("Kavya", { met: ["sql", "python"], findable: true, showTargetRole: true, city: "Pune" });
    const far = await person("Karan", { met: ["sql"], findable: true });
    const hidden = await person("Kabir", { met: ["sql", "python", "excel"] });
    const blocker = await person("Kamal", { findable: true });
    const named = await person("Lata", { findable: true, username: `lata_${run}` });
    await ask(me, friend, "worked_together", deps());
    await answerRequest(friend, me, "accept", deps());
    await ask(asked, me, "other", deps());
    await blockPerson(blocker, me, deps());
    // Kavya and Asha both know Kiran.
    await ask(close, friend, "other", deps());
    await answerRequest(friend, close, "accept", deps());

    const all = await search(me, { q: tag }, deps());
    if (!all.ok) throw new Error(all.error);
    // The friend first, then most skills in common; never the hidden person, someone switched off who sent a
    // request (it waits under Requests instead), a blocker or the searcher.
    const ids = all.people.map((p) => p.id);
    expect(ids.slice(0, 3)).toEqual([friend, close, far]);
    expect(ids).toContain(named);
    for (const not of [me, hidden, asked, blocker]) expect(ids).not.toContain(not);
    expect(all.people[0].state).toBe("connected");
    expect(all.people[1]).toMatchObject({ common: 2, mutual: 1, aim: roleProfiles[0].title, state: "none" });
    // A city is for companies only (T74): never on a member's row, though "In <city>" filters by it on the server.
    for (const p of all.people) expect(p).not.toHaveProperty("city");
    expect(JSON.stringify(all)).not.toContain("Pune");
    expect(all.people[2]).toMatchObject({ common: 1, aim: null });
    expect(all.people.length).toBeLessThanOrEqual(NETWORK_RESULTS_MAX);

    const byName = await search(me, { q: `kav ${tag.slice(0, 4)}` }, deps());
    expect(byName.ok && byName.people.map((p) => p.id)).toEqual([close]);
    const byHandle = await search(me, { q: `@LATA_${run.slice(0, 4)}` }, deps());
    expect(byHandle.ok && byHandle.people.map((p) => p.id)).toContain(named);
    const inMyCity = await search(me, { q: tag, sameCity: true }, deps());
    expect(inMyCity.ok && inMyCity.people.map((p) => p.id)).toEqual([close]);
    // Only people who show their target role: the filter never reveals one that is hidden (Kiran and Karan hide theirs).
    const onMyRole = await search(me, { q: tag, sameRole: true }, deps());
    expect(onMyRole.ok && onMyRole.people.map((p) => p.id)).toEqual([close]);
    expect(await networkFiltersFor(me, db!)).toEqual({ role: roleProfiles[0].title, city: "Pune" });
    expect(await networkFiltersFor(asked, db!)).toEqual({ role: null, city: null });
    // Nobody here has proved a skill yet; then Karan has one.
    const verified = await search(me, { q: tag, verified: true }, deps());
    expect(verified.ok && verified.people).toEqual([]);
    await db!.insert(schema.gapProofs).values({ userId: far, skillId: "sql", type: "skill_check", status: "accepted", evidence: { type: "skill_check", checkId: "sql-basics" } });
    const proved = await search(me, { q: tag, verified: true }, deps());
    expect(proved.ok && proved.people.map((p) => ({ id: p.id, verified: p.verified }))).toEqual([{ id: far, verified: true }]);
    const lists = await networkLists(me, deps());
    for (const p of [...lists.connections, ...lists.requests, ...lists.sent]) expect(p).not.toHaveProperty("city");
    expect(await search(me, { q: "a." }, deps())).toEqual({ ok: false, error: "invalid" });

    expect((await mutualConnections(me, close, db!)).map((p) => p.id)).toEqual([friend]);

    // Off takes the person out at once.
    await saveNetworkSettings(close, { peopleCanFind: false, gapsVisibleTo: "connections", requestsFrom: "anyone" }, deps());
    expect((await networkSettingsFor(close, db!)).peopleCanFind).toBe(false);
    const after = await search(me, { q: tag }, deps());
    expect(after.ok && after.people.map((p) => p.id)).not.toContain(close);
  });

  it("finds a match however many findable people there are, and returns one page, connections first (T77)", async () => {
    const me = await person("Asha");
    const friend = await person("Zubin");
    await ask(me, friend, "other", deps());
    await answerRequest(friend, me, "accept", deps());
    // Saved settings longest ago, behind more findable people than the old 2,000-person scan read.
    const old = await person("Yohan", { findable: true });
    await db!.update(schema.userSettings).set({ updatedAt: new Date(now.getTime() - 400 * DAY) }).where(eq(schema.userSettings.userId, old));
    const filler = `Fx${run.slice(-6)}`;
    const fillers = await db!
      .insert(schema.users)
      .values(Array.from({ length: 2001 }, (_, i) => ({ email: `${run}-f${i}@example.com`, authSubject: `${run}-f${i}`, name: `Filler${i} ${filler}` })))
      .returning({ id: schema.users.id });
    userIds.push(...fillers.map((f) => f.id));
    const { visibility, ...rest } = DEFAULT_SETTINGS;
    for (let i = 0; i < fillers.length; i += 500)
      await db!.insert(schema.userSettings).values(fillers.slice(i, i + 500).map((f) => ({ userId: f.id, profileVisibility: visibility, ...rest, peopleCanFind: true, updatedAt: now })));
    const found = await search(me, { q: `yoh ${tag}` }, deps());
    expect(found.ok && found.people.map((p) => p.id)).toEqual([old]);
    // Many matches: one page, with the connection first even though its name sorts last.
    const many = await search(me, { q: filler }, deps());
    expect(many.ok && many.people.length).toBe(NETWORK_RESULTS_MAX);
    const withFriend = await search(me, { q: `${tag}` }, deps());
    expect(withFriend.ok && withFriend.people[0]).toMatchObject({ id: friend, state: "connected" });
  });

  it("limits searches an hour", async () => {
    const me = await person("Asha");
    for (let i = 0; i < LIMITS.networkSearchesPerUserHour.max; i++) expect((await search(me, { q: tag }, deps())).ok).toBe(true);
    expect(await search(me, { q: tag }, deps())).toEqual({ ok: false, error: "limit" });
  });

  it("shows a Your connections profile to connections only, and gives a new user the new defaults", async () => {
    const owner = await person("Asha");
    const friend = await person("Mira");
    const stranger = await person("Neel");
    const shown = { id: owner, settings: { ...DEFAULT_SETTINGS, visibility: "connections" as const } };
    await ask(owner, friend, "other", deps());
    expect(await canViewProfile(shown, friend, db!)).toBe(false);
    await answerRequest(friend, owner, "accept", deps());
    expect(await canViewProfile(shown, friend, db!)).toBe(true);
    expect(await canViewProfile(shown, stranger, db!)).toBe(false);
    // Ruling 3 and 4: a first save of the Network choices keeps a new user's defaults for everything else.
    await saveNetworkSettings(stranger, { peopleCanFind: true, gapsVisibleTo: "connections", requestsFrom: "anyone" }, deps());
    const [row] = await db!.select().from(schema.userSettings).where(inArray(schema.userSettings.userId, [stranger]));
    expect(row).toMatchObject({ profileVisibility: "connections", gapsVisibleTo: "connections", showGaps: false, peopleCanFind: true });
  });

  it("lets a connection open any profile but Only you, and shows what the two have in common", async () => {
    const owner = await person("Ira", { met: ["sql", "linux"] });
    const friend = await person("Jai", { met: ["linux"] });
    // No analysis, so not on anyone's line.
    const plain = await person("Kavi");
    const stranger = await person("Leela");
    await ask(owner, friend, "same_line", deps());
    await answerRequest(friend, owner, "accept", deps());
    await ask(plain, owner, "event", deps());
    await answerRequest(owner, plain, "accept", deps());
    // People on your line: a connection off the line still opens it; a stranger off the line doesn't.
    const line = { id: owner, settings: { ...DEFAULT_SETTINGS, visibility: "line" as const } };
    expect(await canViewProfile(line, plain, db!)).toBe(true);
    expect(await canViewProfile(line, stranger, db!)).toBe(false);
    const hidden = { id: owner, settings: { ...DEFAULT_SETTINGS, visibility: "only_me" as const } };
    expect(await canViewProfile(hidden, plain, db!)).toBe(false);
    // In common: skills only when the owner shows skills; the role only when they show it and both aim at it.
    const parts = { showSkills: true, showTargetRole: true };
    const both = await inCommonWith(friend, { id: owner, settings: parts }, db!);
    expect(both.skills).toHaveLength(1);
    expect(both.role).toBe(roleProfiles[0].title);
    expect(await inCommonWith(friend, { id: owner, settings: { showSkills: false, showTargetRole: false } }, db!)).toEqual({ skills: [], role: null });
    expect(await inCommonWith(owner, { id: owner, settings: parts }, db!)).toEqual({ skills: [], role: null });
  });

  it("shows Gaps and path for two people on the same line: the gaps both have and each one's current goal", async () => {
    const [s1, s2, s3] = skills.map((x) => x.id);
    const name = (id: string) => skills.find((x) => x.id === id)!.name;
    const me = await person("Uma", { met: [], gaps: [s1, s2, s3] });
    const them = await person("Varun", { met: [], gaps: [s2, s3] });
    const elsewhere = await person("Wasim", { met: [], gaps: [s2], role: roleProfiles[1].slug });
    expect(await pathTogetherWith(me, them, "connections", db!)).toEqual({
      gaps: [name(s2), name(s3)].sort((a, b) => a.localeCompare(b, "en")),
      you: { step: 1, name: name(s1) },
      them: { step: 1, name: name(s2) },
      apart: 0,
      sharedWith: "connections",
    });
    // Different lines can't be compared, and your own profile has no "in common".
    expect(await pathTogetherWith(me, elsewhere, "profile", db!)).toBeNull();
    expect(await pathTogetherWith(me, me, "profile", db!)).toBeNull();
  });

  it("reports a person into the review queue once, never themselves, and logs the reason only", async () => {
    const me = await person("Xena");
    const other = await person("Yash");
    expect(await reportPerson(me, { personId: me, reason: "harassment" }, deps())).toEqual({ ok: false, error: "self_report" });
    expect(await reportPerson(me, { personId: other, reason: "not a reason" }, deps())).toEqual({ ok: false, error: "invalid" });
    expect(await reportPerson(me, { personId: "00000000-0000-4000-8000-000000000000", reason: "other" }, deps())).toEqual({ ok: false, error: "invalid" });
    expect(await reportPerson(me, { personId: other, reason: "fake_or_spam", note: "  Asked for a fee  " }, deps())).toEqual({ ok: true });
    // Asking again while it is open is the same report.
    expect(await reportPerson(me, { personId: other, reason: "harassment" }, deps())).toEqual({ ok: true });
    const filed = await db!.select().from(schema.reports).where(eq(schema.reports.reporterId, me));
    expect(filed).toMatchObject([{ target: "person", targetId: other, reason: "fake_or_spam", note: "Asked for a fee", status: "open" }]);
    expect(lines.join("\n")).not.toContain("Asked for a fee");
    await db!.delete(schema.reports).where(eq(schema.reports.reporterId, me));
  });

  it("opens Inbox chats between connections, and a removal turns the chat back into a request", async () => {
    const a = await person("Lina");
    const b = await person("Manu");
    const status = async (id: string) => (await db!.select({ s: schema.conversations.status }).from(schema.conversations).where(eq(schema.conversations.id, id)))[0]?.s;

    // A message request waiting between two people opens when they connect.
    const asked = await startDirect(a, b, "Hello", { db: db! });
    if (!asked.ok) throw new Error(asked.error);
    expect(await status(asked.conversationId)).toBe("request");
    await ask(b, a, "worked_together", deps());
    await answerRequest(a, b, "accept", deps());
    expect(await status(asked.conversationId)).toBe("open");
    expect((await sendMessage(a, asked.conversationId, "Again", { db: db! })).ok).toBe(true);

    // Removing ends free chat: the chat waits as a request to the person who removed.
    expect((await removeConnection(a, b, db!)).ok).toBe(true);
    expect(await status(asked.conversationId)).toBe("request");
    expect(await sendMessage(b, asked.conversationId, "Still there?", { db: db! })).toEqual({ ok: false, error: "waiting" });
    expect(await sendMessage(a, asked.conversationId, "Yes", { db: db! })).toEqual({ ok: false, error: "accept_first" });

    // A first message between connections opens the chat straight away.
    const c = await person("Nita");
    await ask(a, c, "studied_together", deps());
    await answerRequest(c, a, "accept", deps());
    const direct = await startDirect(c, a, "Hi", { db: db! });
    if (!direct.ok) throw new Error(direct.error);
    expect(await status(direct.conversationId)).toBe("open");
    expect((await sendMessage(a, direct.conversationId, "Hi back", { db: db! })).ok).toBe(true);
  });

  it("puts connections, requests and the choices in Download your data, and deleting an account removes them", async () => {
    const a = await person("Asha", { findable: true, username: `asha_${run}` });
    const b = await person("Om");
    const c = await person("Pia");
    await ask(a, b, "same_line", deps());
    await answerRequest(b, a, "accept", deps());
    await ask(c, a, "event", deps());
    await answerRequest(a, c, "ignore", deps());
    const data = await exportAccountData(a, db!);
    expect(data!.exportVersion).toBe(31);
    expect(data!.network).toMatchObject({ peopleCanFind: true, gapsVisibleTo: "connections", requestsFrom: "anyone" });
    expect(data!.network.connections).toMatchObject([{ name: `Om ${tag}`, username: null, how: "same_line" }]);
    expect(data!.network.requestsReceived).toMatchObject([{ name: `Pia ${tag}`, how: "event", status: "ignored" }]);

    await db!.delete(schema.users).where(inArray(schema.users.id, [a]));
    expect((await networkLists(b, deps())).connections).toEqual([]);
    expect((await exportNetwork(c, db!)).requestsSent).toEqual([]);
  });
});
