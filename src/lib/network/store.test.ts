import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles } from "@/content";
import * as schema from "@/db/schema";
import { exportAccountData } from "@/lib/account/export";
import { canViewProfile } from "@/lib/account/settings-store";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { acceptRequest, blockInChat, startDirect } from "@/lib/inbox/store";
import { DEFAULT_SETTINGS, type GapAnalysis, type Profile } from "@/lib/schemas";
import { CONNECTION_PENDING_MAX, NETWORK_RESULTS_MAX } from "@/lib/schemas/network";
import { LIMITS } from "@/lib/shared-limit";
import {
  answerRequest,
  areConnected,
  blockPerson,
  connectionWith,
  exportNetwork,
  mutualConnections,
  networkLists,
  networkSettingsFor,
  removeConnection,
  requestConnection as ask,
  requestsWaiting,
  saveNetworkSettings,
  searchNetwork as search,
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
const analysis = (met: string[]): GapAnalysis => ({
  roleSlug: roleProfiles[0].slug,
  gaps: [],
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

  async function person(first: string, opts: { met?: string[]; findable?: boolean; closed?: boolean; username?: string; showTargetRole?: boolean; city?: string } = {}) {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: `${first} ${tag}`, username: opts.username ?? null, city: opts.city ?? null })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    if (opts.met) {
      const [resume] = await db!.insert(schema.resumes).values({ userId: u.id, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
      const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
      await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: analysis(opts.met), matcherVersion: MATCHER_VERSION });
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
    // It reads Requested until it would have ended; then, 30 days after the ignore, they can ask again.
    expect(await connectionWith(a, b, deps(31))).toBe("none");
    expect(await ask(a, b, "other", deps(31))).toEqual(ok("requested"));
    // Withdraw needs no wait.
    expect(await withdrawRequest(b, a, deps(31))).toEqual({ ok: false, error: "not_found" });
    expect(await withdrawRequest(a, b, deps(31))).toEqual({ ok: true });
    expect(await connectionWith(b, a, deps(31))).toBe("none");
    expect(await ask(a, b, "other", deps(31))).toEqual(ok("requested"));
    // Unanswered, it ends after 30 days; then the sender waits 30 more, and the receiver can ask at once.
    expect(await answerRequest(b, a, "accept", deps(62))).toEqual({ ok: false, error: "not_found" });
    expect(await ask(a, b, "other", deps(62))).toEqual({ ok: false, error: "wait" });
    expect(await ask(b, a, "other", deps(62))).toEqual(ok("requested"));
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

  it("caps requests a day", async () => {
    const a = await person("Asha");
    const others = await Promise.all(Array.from({ length: LIMITS.networkRequestsPerUser.max + 1 }, (_, i) => person(`Hari${i}`)));
    for (const o of others.slice(0, -1)) expect((await ask(a, o, "other", deps())).ok).toBe(true);
    expect(await ask(a, others.at(-1)!, "other", deps())).toEqual({ ok: false, error: "limit" });
    expect(CONNECTION_PENDING_MAX).toBe(100);
  });

  it("finds connections, open requests and people who turned the switch on, best first, with filters", async () => {
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
    // The friend first, then most skills in common; never the hidden person, a blocker or the searcher.
    const ids = all.people.map((p) => p.id);
    expect(ids.slice(0, 3)).toEqual([friend, close, far]);
    expect(ids).toEqual(expect.arrayContaining([asked, named]));
    for (const not of [me, hidden, blocker]) expect(ids).not.toContain(not);
    expect(all.people[0].state).toBe("connected");
    expect(all.people[1]).toMatchObject({ common: 2, mutual: 1, aim: roleProfiles[0].title, city: "Pune", state: "none" });
    expect(all.people[2]).toMatchObject({ common: 1, aim: null });
    expect(all.people.find((p) => p.id === asked)?.state).toBe("incoming");
    expect(all.people.length).toBeLessThanOrEqual(NETWORK_RESULTS_MAX);

    const byName = await search(me, { q: `kav ${tag.slice(0, 4)}` }, deps());
    expect(byName.ok && byName.people.map((p) => p.id)).toEqual([close]);
    const byHandle = await search(me, { q: `@LATA_${run.slice(0, 4)}` }, deps());
    expect(byHandle.ok && byHandle.people.map((p) => p.id)).toContain(named);
    const inMyCity = await search(me, { q: tag, sameCity: true }, deps());
    expect(inMyCity.ok && inMyCity.people.map((p) => p.id)).toEqual([close]);
    const onMyRole = await search(me, { q: tag, sameRole: true }, deps());
    expect(onMyRole.ok && onMyRole.people.map((p) => p.id)).toEqual([friend, close, far]);
    // Nobody here has proved a skill.
    const verified = await search(me, { q: tag, verified: true }, deps());
    expect(verified.ok && verified.people).toEqual([]);
    expect(await search(me, { q: "a." }, deps())).toEqual({ ok: false, error: "invalid" });

    expect((await mutualConnections(me, close, db!)).map((p) => p.id)).toEqual([friend]);

    // Off takes the person out at once.
    await saveNetworkSettings(close, { peopleCanFind: false, gapsVisibleTo: "connections", requestsFrom: "anyone" }, deps());
    expect((await networkSettingsFor(close, db!)).peopleCanFind).toBe(false);
    const after = await search(me, { q: tag }, deps());
    expect(after.ok && after.people.map((p) => p.id)).not.toContain(close);
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

  it("puts connections, requests and the choices in Download your data, and deleting an account removes them", async () => {
    const a = await person("Asha", { findable: true, username: `asha_${run}` });
    const b = await person("Om");
    const c = await person("Pia");
    await ask(a, b, "same_line", deps());
    await answerRequest(b, a, "accept", deps());
    await ask(c, a, "event", deps());
    await answerRequest(a, c, "ignore", deps());
    const data = await exportAccountData(a, db!);
    expect(data!.exportVersion).toBe(20);
    expect(data!.network).toMatchObject({ peopleCanFind: true, gapsVisibleTo: "connections", requestsFrom: "anyone" });
    expect(data!.network.connections).toMatchObject([{ name: `Om ${tag}`, username: null, how: "same_line" }]);
    expect(data!.network.requestsReceived).toMatchObject([{ name: `Pia ${tag}`, how: "event", status: "ignored" }]);

    await db!.delete(schema.users).where(inArray(schema.users.id, [a]));
    expect((await networkLists(b, deps())).connections).toEqual([]);
    expect((await exportNetwork(c, db!)).requestsSent).toEqual([]);
  });
});
