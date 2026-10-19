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
  networkLists,
  peopleCanFindFor,
  removeConnection,
  requestConnection,
  requestsWaiting,
  searchNetwork,
  setPeopleCanFind,
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

  async function person(first: string, opts: { met?: string[]; findable?: boolean; username?: string; showTargetRole?: boolean } = {}) {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: `${first} ${tag}`, username: opts.username ?? null })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    if (opts.met) {
      const [resume] = await db!.insert(schema.resumes).values({ userId: u.id, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
      const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
      await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: analysis(opts.met), matcherVersion: MATCHER_VERSION });
    }
    if (opts.findable) await setPeopleCanFind(u.id, true, deps());
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
    // Logs carry event names only: never a name, a username or what was typed.
    const all = lines.join("\n");
    for (const secret of [tag, "Asha", "asha_", run]) expect(all).not.toContain(secret);
  });

  it("sends a request, accepts it, and removes the connection from either side", async () => {
    const a = await person("Asha");
    const b = await person("Vikram");
    expect(await requestConnection(a, b, deps())).toEqual({ ok: true, state: "requested" });
    // Asking again changes nothing and isn't counted twice.
    expect(await requestConnection(a, b, deps())).toEqual({ ok: true, state: "requested" });
    expect(await connectionWith(a, b, deps())).toBe("requested");
    expect(await connectionWith(b, a, deps())).toBe("incoming");
    expect(await requestsWaiting(b, deps())).toBe(1);
    expect((await networkLists(a, deps())).sent.map((p) => p.id)).toEqual([b]);
    expect((await networkLists(b, deps())).requests.map((p) => p.name)).toEqual([`Asha ${tag}`]);
    // Only the receiver answers.
    expect(await answerRequest(a, b, "accept", deps())).toEqual({ ok: false, error: "not_found" });
    expect(await answerRequest(b, a, "maybe", deps())).toEqual({ ok: false, error: "invalid" });
    expect(await answerRequest(b, a, "accept", deps())).toEqual({ ok: true, state: "connected" });
    expect(await areConnected(a, b, db!)).toBe(true);
    expect(await requestsWaiting(b, deps())).toBe(0);
    expect((await networkLists(a, deps())).connections.map((p) => p.id)).toEqual([b]);
    expect(await removeConnection(b, a, db!)).toEqual({ ok: true });
    expect(await areConnected(a, b, db!)).toBe(false);
    expect(await removeConnection(a, b, db!)).toEqual({ ok: false, error: "not_found" });
  });

  it("connects two people who ask each other", async () => {
    const a = await person("Asha");
    const b = await person("Bina");
    await requestConnection(a, b, deps());
    expect(await requestConnection(b, a, deps())).toEqual({ ok: true, state: "connected" });
    expect(await connectionWith(a, b, deps())).toBe("connected");
  });

  it("ignores silently, lets the sender withdraw, and lapses requests after 30 days", async () => {
    const a = await person("Asha");
    const b = await person("Chitra");
    await requestConnection(a, b, deps());
    expect(await answerRequest(b, a, "ignore", deps())).toEqual({ ok: true, state: "none" });
    // The sender still reads Requested; the receiver has nothing waiting.
    expect(await connectionWith(a, b, deps())).toBe("requested");
    expect(await requestsWaiting(b, deps())).toBe(0);
    expect((await networkLists(b, deps())).requests).toEqual([]);
    // The person who ignored it can still change their mind with Connect.
    expect(await requestConnection(b, a, deps())).toEqual({ ok: true, state: "connected" });
    await removeConnection(a, b, db!);

    await requestConnection(a, b, deps());
    expect(await withdrawRequest(b, a, db!)).toEqual({ ok: false, error: "not_found" });
    expect(await withdrawRequest(a, b, db!)).toEqual({ ok: true });
    expect(await connectionWith(b, a, deps())).toBe("none");

    await requestConnection(a, b, deps());
    expect(await connectionWith(b, a, deps(31))).toBe("none");
    expect(await answerRequest(b, a, "accept", deps(31))).toEqual({ ok: false, error: "not_found" });
    // A lapsed request can be sent again, by either of them.
    expect(await requestConnection(b, a, deps(31))).toEqual({ ok: true, state: "requested" });
    expect(await connectionWith(a, b, deps(31))).toBe("incoming");
  });

  it("refuses yourself, blocked, deleted and suspended people, and a block ends a connection", async () => {
    const a = await person("Asha");
    const b = await person("Dev");
    expect(await requestConnection(a, a, deps())).toEqual({ ok: false, error: "self" });
    await requestConnection(a, b, deps());
    await answerRequest(b, a, "accept", deps());
    expect(await blockPerson(b, a, deps())).toEqual({ ok: true });
    expect(await areConnected(a, b, db!)).toBe(false);
    expect(await requestConnection(a, b, deps())).toEqual({ ok: false, error: "unavailable" });
    expect(await requestConnection(b, a, deps())).toEqual({ ok: false, error: "unavailable" });

    // Blocking from an Inbox chat ends the connection too.
    const c = await person("Esha");
    await requestConnection(a, c, deps());
    await answerRequest(c, a, "accept", deps());
    const chat = await startDirect(a, c, "Hello", { db: db! });
    if (!chat.ok) throw new Error(chat.error);
    await acceptRequest(c, chat.conversationId, { db: db! });
    expect((await blockInChat(c, chat.conversationId, { db: db! })).ok).toBe(true);
    expect(await areConnected(a, c, db!)).toBe(false);

    const gone = await person("Farah");
    const held = await person("Gita");
    await requestConnection(gone, a, deps());
    await requestConnection(held, a, deps());
    await db!.update(schema.users).set({ deletionRequestedAt: now }).where(inArray(schema.users.id, [gone]));
    await db!.update(schema.users).set({ suspendedAt: now, suspendedReason: "Test" }).where(inArray(schema.users.id, [held]));
    expect(await requestConnection(a, gone, deps())).toEqual({ ok: false, error: "unavailable" });
    expect(await requestConnection(a, held, deps())).toEqual({ ok: false, error: "unavailable" });
    // Their requests stop showing at once.
    expect(await requestsWaiting(a, deps())).toBe(0);
    expect((await networkLists(a, deps())).requests).toEqual([]);
  });

  it("caps requests a day and requests waiting", async () => {
    const a = await person("Asha");
    const others = await Promise.all(Array.from({ length: LIMITS.networkRequestsPerUser.max + 1 }, (_, i) => person(`Hari${i}`)));
    for (const o of others.slice(0, -1)) expect((await requestConnection(a, o, deps())).ok).toBe(true);
    expect(await requestConnection(a, others.at(-1)!, deps())).toEqual({ ok: false, error: "limit" });
    expect(CONNECTION_PENDING_MAX).toBe(100);
  });

  it("finds only people who turned the switch on, by name or exact username, best first", async () => {
    const me = await person("Asha", { met: ["sql", "python", "excel"] });
    const friend = await person("Kiran", { met: [], findable: true });
    const close = await person("Kavya", { met: ["sql", "python"], findable: true, showTargetRole: true });
    const far = await person("Karan", { met: ["sql"], findable: true });
    const hidden = await person("Kabir", { met: ["sql", "python", "excel"] });
    const blocker = await person("Kamal", { findable: true });
    const named = await person("Lata", { findable: true, username: `lata_${run}` });
    await requestConnection(me, friend, deps());
    await answerRequest(friend, me, "accept", deps());
    await blockPerson(blocker, me, deps());

    const all = await searchNetwork(me, tag, deps());
    if (!all.ok) throw new Error(all.error);
    // The friend first, then most skills in common; never the hidden person, a blocker or the searcher.
    const ids = all.people.map((p) => p.id);
    expect(ids.slice(0, 3)).toEqual([friend, close, far]);
    expect(ids).toContain(named);
    for (const not of [me, hidden, blocker]) expect(ids).not.toContain(not);
    expect(all.people[0].state).toBe("connected");
    expect(all.people[1]).toMatchObject({ common: 2, aim: roleProfiles[0].title, state: "none" });
    expect(all.people[2]).toMatchObject({ common: 1, aim: null });
    expect(all.people.length).toBeLessThanOrEqual(NETWORK_RESULTS_MAX);

    const byName = await searchNetwork(me, `kav ${tag.slice(0, 4)}`, deps());
    expect(byName.ok && byName.people.map((p) => p.id)).toEqual([close]);
    const byUsername = await searchNetwork(me, `@LATA_${run}`, deps());
    expect(byUsername.ok && byUsername.people.map((p) => p.id)).toEqual([named]);
    expect(await searchNetwork(me, "a.", deps())).toEqual({ ok: false, error: "invalid" });

    // Off takes the person out at once.
    await setPeopleCanFind(close, false, deps());
    expect(await peopleCanFindFor(close, db!)).toBe(false);
    const after = await searchNetwork(me, tag, deps());
    expect(after.ok && after.people.map((p) => p.id)).not.toContain(close);
  });

  it("limits searches an hour", async () => {
    const me = await person("Asha");
    for (let i = 0; i < LIMITS.networkSearchesPerUserHour.max; i++) expect((await searchNetwork(me, tag, deps())).ok).toBe(true);
    expect(await searchNetwork(me, tag, deps())).toEqual({ ok: false, error: "limit" });
  });

  it("shows a Your connections profile to connections only", async () => {
    const owner = await person("Asha");
    const friend = await person("Mira");
    const stranger = await person("Neel");
    const shown = { id: owner, settings: { ...DEFAULT_SETTINGS, visibility: "connections" as const } };
    await requestConnection(owner, friend, deps());
    expect(await canViewProfile(shown, friend, db!)).toBe(false);
    await answerRequest(friend, owner, "accept", deps());
    expect(await canViewProfile(shown, friend, db!)).toBe(true);
    expect(await canViewProfile(shown, stranger, db!)).toBe(false);
  });

  it("puts connections, requests and the switch in Download your data, and deleting the account removes them", async () => {
    const a = await person("Asha", { findable: true, username: `asha_${run}` });
    const b = await person("Om");
    const c = await person("Pia");
    await requestConnection(a, b, deps());
    await answerRequest(b, a, "accept", deps());
    await requestConnection(c, a, deps());
    await answerRequest(a, c, "ignore", deps());
    const data = await exportAccountData(a, db!);
    expect(data!.exportVersion).toBe(20);
    expect(data!.network.peopleCanFind).toBe(true);
    expect(data!.network.connections).toMatchObject([{ name: `Om ${tag}`, username: null }]);
    expect(data!.network.requestsReceived).toMatchObject([{ name: `Pia ${tag}` }]);
    expect(data!.network.requestsReceived[0].ignoredAt).not.toBeNull();
    // The sender's download never says their request was ignored.
    const theirs = await exportAccountData(c, db!);
    expect(theirs!.network.requestsSent).toEqual([{ name: `Asha ${tag}`, username: `asha_${run}`, sentAt: expect.any(Date) }]);

    await db!.delete(schema.users).where(inArray(schema.users.id, [a]));
    expect((await networkLists(b, deps())).connections).toEqual([]);
    expect((await exportAccountData(c, db!))!.network.requestsSent).toEqual([]);
  });
});
