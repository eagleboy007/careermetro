import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { exportAccountData } from "@/lib/account/export";
import {
  activeMembership,
  answerRequest,
  cancelInvite,
  clearExpiredCodes,
  corporateHome,
  exportCorporate,
  finishCompanySignup,
  finishJoin,
  finishRecheck,
  inviteMember,
  removeMember,
  requestAccess,
  saveCompanyPage,
  startCompanySignup,
  startJoin,
  startRecheck,
  recheckDue,
  type CorporateDeps,
} from "./store";
import { RECHECK_CLOSED_TEXT } from "@/lib/schemas/constants";

vi.mock("server-only", () => ({}));

// Company sign-up, codes, team and access (dev/corporate-plan.md) against a real Postgres with migrations applied.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key" };
const MIN = 60_000;
const DAY = 86_400_000;

describe.skipIf(!db)("corporate store (database)", () => {
  const run = `corp${Date.now()}`;
  const userIds: string[] = [];
  const clock = new Date("2026-10-12T10:00:00Z");
  const deps = (over: Partial<CorporateDeps> = {}): CorporateDeps => ({ db: db!, env, now: clock, delivery: "test", ...over });
  const lines: string[] = [];

  beforeEach(() => {
    // Every log line the store writes, to check no address or code ever reaches the logs.
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.organizations).where(like(schema.organizations.emailDomain, `%${run}%`));
    await sqlClient!.end();
  });

  async function person(n: string, name = "Meera Iyer") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }
  /** A fresh company domain per test, so tests don't share limits or companies. */
  let n = 0;
  const domain = () => `${run}-${++n}.example-labs.test`;
  const details = (d: string, local = "meera.iyer") => ({
    type: "company",
    legalName: "Example Labs Private Limited",
    name: "Example Labs",
    website: `https://${d}`,
    workEmail: `${local}@${d}`,
    size: "51 to 200",
    city: "Pune",
  });
  const codeRows = (userId: string) => db!.select().from(schema.workEmailCodes).where(eq(schema.workEmailCodes.userId, userId));

  /** Signs a person up as the first admin of a new company and returns its id. */
  async function company(userId: string, d = domain()) {
    const started = await startCompanySignup(userId, details(d), deps());
    if (!started.ok || !started.testCode) throw new Error("no code");
    const done = await finishCompanySignup(userId, { details: details(d), code: started.testCode }, deps());
    if (!done.ok) throw new Error(done.error);
    return { orgId: done.orgId, domain: d };
  }

  /** Gives `userId` a role at the company through an admin's invite, as a colleague would accept it. */
  async function join(adminId: string, userId: string, d: string, role: "admin" | "hiring" | "interviewer", local: string) {
    expect(await inviteMember(adminId, { workEmail: `${local}@${d}`, role }, deps())).toEqual({ ok: true });
    const started = await startJoin(userId, { workEmail: `${local}@${d}` }, deps());
    if (!started.ok || !started.testCode) throw new Error(`no join code: ${!started.ok && started.error}`);
    expect(await finishJoin(userId, { workEmail: `${local}@${d}`, code: started.testCode }, deps())).toMatchObject({ ok: true });
  }

  it("signs a company up as pending, with the person as its first Recruiter admin, and forgets the address", async () => {
    const me = await person("signup");
    const d = domain();
    const started = await startCompanySignup(me, details(d), deps());
    expect(started).toMatchObject({ ok: true, testCode: expect.stringMatching(/^\d{6}$/) });
    const code = (started as { testCode: string }).testCode;
    const [pending] = await codeRows(me);
    expect(pending.email).toBe(`meera.iyer@${d}`);
    expect(pending.codeHash).not.toContain(code);

    const done = await finishCompanySignup(me, { details: details(d), code }, deps());
    expect(done).toMatchObject({ ok: true });
    const [org] = await db!.select().from(schema.organizations).where(eq(schema.organizations.emailDomain, d));
    expect(org).toMatchObject({ name: "Example Labs", reviewStatus: "pending", website: `https://${d}`, domainVerifiedAt: clock });
    expect(org.secondAdminDueAt).toEqual(new Date(clock.getTime() + 14 * 86_400_000));
    const member = await activeMembership(me, db!);
    expect(member).toMatchObject({ orgId: org.id, role: "admin" });
    const [row] = await db!.select().from(schema.orgMembers).where(eq(schema.orgMembers.userId, me));
    expect(row).toMatchObject({ workEmailDomain: d, grantedBy: null });
    // The work email is gone: only the domain and the date are kept.
    const [used] = await codeRows(me);
    expect(used).toMatchObject({ email: null, codeHash: null, usedAt: clock });
    expect(JSON.stringify(await db!.select().from(schema.orgMembers).where(eq(schema.orgMembers.userId, me)))).not.toContain("meera.iyer");

    const home = await corporateHome(me, { db: db!, now: clock });
    expect(home).toMatchObject({ org: { name: "Example Labs", status: "pending", domain: d }, me: { role: "admin" }, adminCount: 1, secondAdminDaysLeft: 14, canOpenJobs: false });
    expect(home!.team!.members).toEqual([expect.objectContaining({ name: "Meera Iyer", role: "admin", isYou: true, workEmailVerifiedOn: "2026-10-12" })]);
    expect(JSON.stringify(home)).not.toContain("@");
  });

  it("refuses free mail, and makes no code", async () => {
    const me = await person("free");
    const r = await startCompanySignup(me, { ...details(domain()), workEmail: "meera@gmail.com" }, deps());
    expect(r).toMatchObject({ ok: false, error: "invalid", message: expect.stringMatching(/Gmail/) });
    expect(await codeRows(me)).toHaveLength(0);
  });

  it("refuses a domain another company has, or a subdomain of it, without naming anyone", async () => {
    const first = await person("dup-a");
    const { domain: d } = await company(first);
    const second = await person("dup-b");
    expect(await startCompanySignup(second, details(d, "rahul"), deps())).toEqual({ ok: false, error: "taken" });
    expect(await startCompanySignup(second, details(`hr.${d}`, "rahul"), deps())).toEqual({ ok: false, error: "taken" });
    expect(await codeRows(second)).toHaveLength(0);
    // Asking for access instead reaches the company's admins as a request.
    expect(await requestAccess(second, { workEmail: `rahul@${d}` }, deps())).toEqual({ ok: true });
    expect(await requestAccess(second, { workEmail: `rahul@${d}` }, deps())).toEqual({ ok: true });
    const home = await corporateHome(first, { db: db!, now: clock });
    expect(home!.team!.requests).toEqual([expect.objectContaining({ name: "Meera Iyer", domain: d })]);
    // One audit line for the one request, naming the request only (security review 2026-10-13).
    const [org] = await db!.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.emailDomain, d));
    const [request] = await db!.select({ id: schema.orgInvites.id }).from(schema.orgInvites).where(eq(schema.orgInvites.userId, second));
    const asked = (await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, org.id))).filter((a) => a.action === "access_requested");
    expect(asked.map((a) => [a.actor, a.target])).toEqual([["requester", `invite:${request.id}`]]);
  });

  it("refuses a second company while the code is out: the domain is checked again when the code comes back", async () => {
    const a = await person("race-a");
    const b = await person("race-b");
    const d = domain();
    const ca = await startCompanySignup(a, details(d), deps());
    const cb = await startCompanySignup(b, details(d, "rahul"), deps());
    expect(await finishCompanySignup(a, { details: details(d), code: (ca as { testCode: string }).testCode }, deps())).toMatchObject({ ok: true });
    expect(await finishCompanySignup(b, { details: details(d, "rahul"), code: (cb as { testCode: string }).testCode }, deps())).toEqual({ ok: false, error: "taken" });
  });

  it("expires a code after 10 minutes and forgets the address", async () => {
    const me = await person("expiry");
    const d = domain();
    const started = (await startCompanySignup(me, details(d), deps())) as { testCode: string };
    const later = new Date(clock.getTime() + 10 * MIN);
    expect(await finishCompanySignup(me, { details: details(d), code: started.testCode }, deps({ now: later }))).toEqual({ ok: false, error: "expired" });
    expect((await codeRows(me))[0]).toMatchObject({ email: null, codeHash: null, usedAt: null });
    expect(await activeMembership(me, db!)).toBeNull();
  });

  it("allows 5 wrong tries, then locks for 15 minutes, even for a new code", async () => {
    const me = await person("lock");
    const d = domain();
    const started = (await startCompanySignup(me, details(d), deps())) as { testCode: string };
    const wrong = started.testCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect(await finishCompanySignup(me, { details: details(d), code: wrong }, deps())).toEqual({ ok: false, error: "wrong" });
    expect(await finishCompanySignup(me, { details: details(d), code: wrong }, deps())).toEqual({ ok: false, error: "locked" });
    // The right code no longer works, the address is gone, and no new code can be sent while locked.
    expect(await finishCompanySignup(me, { details: details(d), code: started.testCode }, deps())).toEqual({ ok: false, error: "locked" });
    expect((await codeRows(me))[0]).toMatchObject({ attempts: 5, email: null, codeHash: null });
    expect(await startCompanySignup(me, details(d), deps())).toEqual({ ok: false, error: "locked" });
    // After 15 minutes a new code works.
    const after = new Date(clock.getTime() + 15 * MIN);
    const again = (await startCompanySignup(me, details(d), deps({ now: after }))) as { testCode: string };
    expect(await finishCompanySignup(me, { details: details(d), code: again.testCode }, deps({ now: after }))).toMatchObject({ ok: true });
  });

  it("refuses a code sent to another address", async () => {
    const me = await person("swap");
    const d = domain();
    const started = (await startCompanySignup(me, details(d), deps())) as { testCode: string };
    expect(await finishCompanySignup(me, { details: details(d, "someone.else"), code: started.testCode }, deps())).toEqual({ ok: false, error: "none" });
  });

  it("sends at most 3 codes an hour per person", async () => {
    const me = await person("limit");
    const d = domain();
    const hour = new Date("2026-10-13T05:00:00Z");
    for (let i = 0; i < 3; i++) expect(await startCompanySignup(me, details(d), deps({ now: hour }))).toMatchObject({ ok: true });
    expect(await startCompanySignup(me, details(d), deps({ now: hour }))).toEqual({ ok: false, error: "limit" });
  });

  it("refuses every work-email step in production without NAME_HASH_KEY, whatever CRON_SECRET is (security review 2026-10-13)", async () => {
    const admin = await person("nokey-admin");
    const { domain: d } = await company(admin);
    const me = await person("nokey");
    const noKey = deps({ env: { NODE_ENV: "production", VERCEL_ENV: "production", CRON_SECRET: "c" } });
    const notSetUp = { ok: false, error: "not_set_up" };
    expect(await startCompanySignup(me, details(domain()), noKey)).toEqual(notSetUp);
    expect(await finishCompanySignup(me, { details: details(domain()), code: "123456" }, noKey)).toEqual(notSetUp);
    expect(await inviteMember(admin, { workEmail: `rahul@${d}`, role: "hiring" }, noKey)).toEqual(notSetUp);
    expect(await startJoin(me, { workEmail: `rahul@${d}` }, noKey)).toEqual(notSetUp);
    expect(await finishJoin(me, { workEmail: `rahul@${d}`, code: "123456" }, noKey)).toEqual(notSetUp);
    expect(await startRecheck(admin, { workEmail: `meera@${d}` }, noKey)).toEqual(notSetUp);
    expect(await finishRecheck(admin, { workEmail: `meera@${d}`, code: "123456" }, noKey)).toEqual(notSetUp);
    expect(await codeRows(me)).toHaveLength(0);
  });

  it("sends nothing while delivery is off (production without an email sender)", async () => {
    const me = await person("off");
    expect(await startCompanySignup(me, details(domain()), deps({ delivery: "off" }))).toEqual({ ok: false, error: "closed" });
    expect(await codeRows(me)).toHaveLength(0);
  });

  it("sends the code by email where the sender is set up, and spends it when the email doesn't go out", async () => {
    const me = await person("mail");
    const mail = { ...env, RESEND_API_KEY: "re_test", EMAIL_FROM: "CareerMetro <codes@example.test>" };
    const sent = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", sent);
    try {
      const d = domain();
      const ok = await startCompanySignup(me, details(d), deps({ env: mail, delivery: "email" }));
      expect(ok).toMatchObject({ ok: true });
      expect(ok).not.toHaveProperty("testCode");
      const [url, init] = sent.mock.calls[0]!;
      expect(String(url)).toBe("https://api.resend.com/emails");
      expect(new Headers(init!.headers).get("authorization")).toBe("Bearer re_test");
      const body = JSON.parse(String(init!.body));
      expect(body).toMatchObject({ from: "CareerMetro <codes@example.test>", to: [`meera.iyer@${d}`] });
      expect(body.text).toMatch(/Your code is \d{6}\. It works for 10 minutes\./);
      // Resend refuses the next one: the person is told plainly, and that code can never be used.
      sent.mockResolvedValueOnce(new Response("{}", { status: 500 }));
      expect(await startCompanySignup(me, details(d), deps({ env: mail, delivery: "email" }))).toEqual({ ok: false, error: "not_sent" });
      const rows = await codeRows(me);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.codeHash === null && r.email === null)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives a role by work email: the colleague confirms it with a code, and the invite keeps no address", async () => {
    const admin = await person("inv-admin");
    const { domain: d } = await company(admin);
    const colleague = await person("inv-hr", "Rahul Menon");
    expect(await inviteMember(admin, { workEmail: `rahul@gmail.com`, role: "hiring" }, deps())).toMatchObject({ ok: false, error: "invalid" });
    expect(await inviteMember(admin, { workEmail: `rahul@other.test`, role: "hiring" }, deps())).toMatchObject({ ok: false, error: "invalid", message: expect.stringContaining(d) });
    expect(await inviteMember(admin, { workEmail: `Rahul@${d}`, role: "hiring" }, deps())).toEqual({ ok: true });
    expect(await inviteMember(admin, { workEmail: `rahul@${d}`, role: "hiring" }, deps())).toEqual({ ok: false, error: "already_invited" });
    const [invite] = await db!.select().from(schema.orgInvites).where(eq(schema.orgInvites.emailDomain, d));
    expect(JSON.stringify(invite)).not.toContain("rahul");

    // Someone else's address finds nothing; the invited one gets a code.
    expect(await startJoin(colleague, { workEmail: `someone@${d}` }, deps())).toEqual({ ok: false, error: "no_invite" });
    const started = (await startJoin(colleague, { workEmail: `rahul@${d}` }, deps())) as { testCode: string };
    expect(await finishJoin(colleague, { workEmail: `rahul@${d}`, code: started.testCode }, deps())).toMatchObject({ ok: true });
    expect(await activeMembership(colleague, db!)).toMatchObject({ role: "hiring" });
    const [row] = await db!.select().from(schema.orgMembers).where(eq(schema.orgMembers.userId, colleague));
    expect(row.grantedBy).toBe(admin);
    expect((await codeRows(colleague))[0]).toMatchObject({ email: null, codeHash: null });
    // Hiring HR can't manage the team, and sees no team list.
    expect(await inviteMember(colleague, { workEmail: `x@${d}`, role: "admin" }, deps())).toEqual({ ok: false, error: "not_admin" });
    expect((await corporateHome(colleague, { db: db!, now: clock }))!.team).toBeNull();
    // The admin's list shows the person with the date only, never an address.
    const home = await corporateHome(admin, { db: db!, now: clock });
    // Oldest first; two added in the same instant fall back to member id order, so only the set is fixed here.
    expect(home!.team!.members.map((m) => m.name).sort()).toEqual(["Meera Iyer", "Rahul Menon"]);
    expect(home!.team!.invites).toEqual([]);
    expect(JSON.stringify(home)).not.toContain("@");
  });

  it("lets only one account use an invite, even when two hold codes for the same mailbox", async () => {
    const admin = await person("dup-admin");
    const { domain: d } = await company(admin);
    await inviteMember(admin, { workEmail: `shared@${d}`, role: "hiring" }, deps());
    const tag = `dup${Math.random().toString(36).slice(2, 8)}`;
    const [a, b] = [await person(`${tag}-a`), await person(`${tag}-b`)];
    const codeA = (await startJoin(a, { workEmail: `shared@${d}` }, deps())) as { testCode: string };
    const codeB = (await startJoin(b, { workEmail: `shared@${d}` }, deps())) as { testCode: string };
    const results = await Promise.all([
      finishJoin(a, { workEmail: `shared@${d}`, code: codeA.testCode }, deps()),
      finishJoin(b, { workEmail: `shared@${d}`, code: codeB.testCode }, deps()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "no_invite" }]);
    const members = await db!.select().from(schema.orgMembers).where(inArray(schema.orgMembers.userId, [a, b]));
    expect(members).toHaveLength(1);
  });

  it("can cancel an invite before it is used", async () => {
    const admin = await person("cancel");
    const { domain: d } = await company(admin);
    await inviteMember(admin, { workEmail: `x@${d}`, role: "interviewer" }, deps());
    const home = await corporateHome(admin, { db: db!, now: clock });
    const [invite] = home!.team!.invites;
    expect(invite).toMatchObject({ role: "interviewer", domain: d });
    expect(await cancelInvite(admin, { inviteId: invite.id }, deps())).toEqual({ ok: true });
    const someone = await person("cancel-b");
    expect(await startJoin(someone, { workEmail: `x@${d}` }, deps())).toEqual({ ok: false, error: "no_invite" });
  });

  it("answers an access request with a role, which the person then confirms with a work email", async () => {
    const admin = await person("req-admin");
    const { domain: d } = await company(admin);
    const asker = await person("req-asker", "Farhan Shaikh");
    await requestAccess(asker, { workEmail: `farhan@${d}` }, deps());
    // Not answered yet: nothing to confirm.
    expect(await startJoin(asker, { workEmail: `farhan@${d}` }, deps())).toEqual({ ok: false, error: "no_invite" });
    const [req] = (await corporateHome(admin, { db: db!, now: clock }))!.team!.requests;
    expect(await answerRequest(admin, { requestId: req.id, answer: "interviewer" }, deps())).toEqual({ ok: true });
    // Any address on the company's domain works for the person who asked; another domain doesn't.
    expect(await startJoin(asker, { workEmail: `farhan@other-${d}` }, deps())).toEqual({ ok: false, error: "no_invite" });
    const started = (await startJoin(asker, { workEmail: `f.shaikh@${d}` }, deps())) as { testCode: string };
    expect(await finishJoin(asker, { workEmail: `f.shaikh@${d}`, code: started.testCode }, deps())).toMatchObject({ ok: true });
    expect(await activeMembership(asker, db!)).toMatchObject({ role: "interviewer" });
  });

  it("removing a role ends access at once, and keeps at least two admins once there are two", async () => {
    const a = await person("rm-a");
    const { orgId, domain: d } = await company(a);
    const b = await person("rm-b", "Karan Bhatt");
    const c = await person("rm-c", "Anita Rao");
    const hr = await person("rm-hr", "Rahul Menon");
    const memberId = async (u: string) => (await activeMembership(u, db!))!.memberId;

    // One admin: can't remove themselves, and is told why in those words.
    expect(await removeMember(a, { memberId: await memberId(a) }, deps())).toEqual({ ok: false, error: "self_removal" });
    await join(a, b, d, "admin", "karan");
    expect((await corporateHome(a, { db: db!, now: clock }))!.secondAdminDaysLeft).toBeNull();
    // Two admins removing themselves are told it's self-removal, not to add a third admin.
    expect(await removeMember(a, { memberId: await memberId(a) }, deps())).toEqual({ ok: false, error: "self_removal" });
    // Two admins: neither can go.
    expect(await removeMember(a, { memberId: await memberId(b) }, deps())).toEqual({ ok: false, error: "keep_two_admins" });
    expect(await removeMember(b, { memberId: await memberId(a) }, deps())).toEqual({ ok: false, error: "keep_two_admins" });
    await join(a, c, d, "admin", "anita");
    await join(a, hr, d, "hiring", "rahul");
    // Three admins: an admin still can't remove themselves, so the jobs they own always pass to someone.
    expect(await removeMember(a, { memberId: await memberId(a) }, deps())).toEqual({ ok: false, error: "self_removal" });
    expect(await activeMembership(a, db!)).not.toBeNull();
    // Three admins: one can go, then the rule holds again.
    expect(await removeMember(c, { memberId: await memberId(a) }, deps())).toEqual({ ok: true });
    expect(await activeMembership(a, db!)).toBeNull();
    expect(await corporateHome(a, { db: db!, now: clock })).toBeNull();
    expect(await inviteMember(a, { workEmail: `x@${d}`, role: "hiring" }, deps())).toEqual({ ok: false, error: "not_member" });
    expect(await removeMember(c, { memberId: await memberId(b) }, deps())).toEqual({ ok: false, error: "keep_two_admins" });
    // Hiring HR can always be removed, and can't remove anyone.
    expect(await removeMember(hr, { memberId: await memberId(b) }, deps())).toEqual({ ok: false, error: "not_admin" });
    expect(await removeMember(b, { memberId: await memberId(hr) }, deps())).toEqual({ ok: true });
    const [row] = await db!.select().from(schema.orgMembers).where(eq(schema.orgMembers.userId, hr));
    expect(row).toMatchObject({ orgId, removedBy: b });
    expect(row.removedAt).toEqual(clock);
  });

  it("holds one active role per person", async () => {
    const a = await person("one-a");
    const { domain: d1 } = await company(a);
    const b = await person("one-b");
    const { domain: d2 } = await company(b);
    // a is an admin at d1; an invite from d2 can't give a a second role.
    await inviteMember(b, { workEmail: `meera@${d2}`, role: "hiring" }, deps());
    expect(await startJoin(a, { workEmail: `meera@${d2}` }, deps())).toEqual({ ok: false, error: "has_role" });
    expect(await startCompanySignup(a, details(domain()), deps())).toEqual({ ok: false, error: "has_role" });
    // The database holds the line too.
    const [org1] = await db!.select().from(schema.organizations).where(eq(schema.organizations.emailDomain, d1));
    await expect(
      db!.insert(schema.orgMembers).values({ orgId: org1.id, userId: a, role: "hiring", workEmailDomain: d1, workEmailVerifiedAt: clock, recheckDueAt: clock }),
    ).rejects.toThrow();
  });

  it("saves the company page for admins only, and keeps the GSTIN out of what members see", async () => {
    const a = await person("page");
    const { domain: d } = await company(a);
    expect(await saveCompanyPage(a, { about: "Payments software for co-operative banks.", industry: "IT services", offices: "Pune", gstinOrCin: "27AAACN1234F1Z5" }, deps())).toEqual({ ok: true });
    const [org] = await db!.select().from(schema.organizations).where(eq(schema.organizations.emailDomain, d));
    expect(org).toMatchObject({ industry: "IT services", gstinOrCin: "27AAACN1234F1Z5" });
    const home = await corporateHome(a, { db: db!, now: clock });
    expect(home!.org.hasPage).toBe(true);
    expect(JSON.stringify(home)).not.toContain("27AAACN");
  });

  it("deleting a person removes their roles; a company left without admins stays, with none", async () => {
    const a = await person("del");
    const { orgId } = await company(a);
    await db!.delete(schema.users).where(eq(schema.users.id, a));
    expect(await db!.select().from(schema.orgMembers).where(eq(schema.orgMembers.orgId, orgId))).toEqual([]);
    expect(await db!.select().from(schema.workEmailCodes).where(eq(schema.workEmailCodes.userId, a))).toEqual([]);
    const [org] = await db!.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    expect(org).toBeDefined();
  });

  it("lists the person's company roles for Download your data, without any address", async () => {
    const a = await person("export");
    const { domain: d } = await company(a);
    const rows = await exportCorporate(a, db!);
    expect(rows).toEqual([expect.objectContaining({ company: "Example Labs", role: "Recruiter admin", since: clock, workEmailDomain: d, removedAt: null })]);
    const data = await exportAccountData(a, db!);
    expect(data?.companyRoles).toEqual(rows);
    expect(JSON.stringify(data?.companyRoles)).not.toContain("meera.iyer");
  });

  it("the daily cleanup forgets addresses on codes that ran out", async () => {
    const a = await person("clean");
    await startCompanySignup(a, details(domain()), deps());
    expect(await clearExpiredCodes(db!, new Date(clock.getTime() + 11 * MIN))).toBeGreaterThanOrEqual(1);
    expect((await codeRows(a))[0].email).toBeNull();
  });

  it("never writes an address or a code to the logs", async () => {
    const a = await person("logs");
    const d = domain();
    const started = (await startCompanySignup(a, details(d), deps())) as { testCode: string };
    await finishCompanySignup(a, { details: details(d), code: "999999" === started.testCode ? "111111" : "999999" }, deps());
    await finishCompanySignup(a, { details: details(d), code: started.testCode }, deps());
    const all = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [started.testCode, "meera.iyer", d]) expect(all).not.toContain(secret);
  });

  it("pauses company access once the 180-day work-email re-check is due, until the person confirms the email again (T40)", async () => {
    const admin = await person("recheck-admin");
    const { domain: d } = await company(admin);
    const hr = await person("recheck-hr", "Rahul Menon");
    await join(admin, hr, d, "hiring", "rahul");
    const day = (n: number) => new Date(clock.getTime() + n * DAY);
    const due = deps({ now: day(181) });

    // Day 179: on. Day 181: the role is still held, but it opens nothing.
    expect(await activeMembership(hr, db!, day(179))).toMatchObject({ role: "hiring" });
    expect(await activeMembership(hr, db!, day(181))).toBeNull();
    expect(await corporateHome(hr, { db: db!, now: day(181) })).toBeNull();
    expect(await recheckDue(hr, { db: db!, now: day(181) })).toEqual({ company: "Example Labs", domain: d });
    expect(await recheckDue(hr, { db: db!, now: day(179) })).toBeNull();
    // The admin's re-check is due too, so they can't manage the team either.
    expect(await inviteMember(admin, { workEmail: `x@${d}`, role: "hiring" }, due)).toEqual({ ok: false, error: "not_member" });
    // It is still their one role: no second company meanwhile.
    expect(await startCompanySignup(hr, details(domain(), "rahul"), due)).toEqual({ ok: false, error: "has_role" });

    // Re-checking takes a work email on the company's domain only, and a code, as joining did.
    expect(await startRecheck(hr, { workEmail: "rahul@gmail.com" }, due)).toMatchObject({ ok: false, error: "invalid" });
    expect(await startRecheck(hr, { workEmail: "rahul@other-company.test" }, due)).toMatchObject({ ok: false, error: "invalid" });
    // In production without an email sender nothing is sent, and the words say access stays paused.
    expect(await startRecheck(hr, { workEmail: `rahul@${d}` }, deps({ now: day(181), delivery: "off" }))).toEqual({ ok: false, error: "closed", message: RECHECK_CLOSED_TEXT });
    const started = await startRecheck(hr, { workEmail: `rahul.menon@${d}` }, due);
    if (!started.ok || !started.testCode) throw new Error("no code");
    const wrong = started.testCode === "000000" ? "111111" : "000000";
    expect(await finishRecheck(hr, { workEmail: `rahul.menon@${d}`, code: wrong }, due)).toEqual({ ok: false, error: "wrong" });
    expect(await activeMembership(hr, db!, day(181))).toBeNull();
    expect(await finishRecheck(hr, { workEmail: `rahul.menon@${d}`, code: started.testCode }, due)).toEqual({ ok: true });
    // Access coming back is an access change: one audit line, the member by id only (security review 2026-10-13).
    const [held] = await db!.select({ id: schema.orgMembers.id, orgId: schema.orgMembers.orgId }).from(schema.orgMembers).where(eq(schema.orgMembers.userId, hr));
    const rechecked = (await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, held.orgId))).filter((a) => a.action === "access_rechecked");
    expect(rechecked.map((a) => [a.actor, a.target])).toEqual([[`member:${held.id}`, `member:${held.id}`]]);

    // Access is back for another 180 days; only the domain and the date are kept.
    expect(await activeMembership(hr, db!, day(181))).toMatchObject({ role: "hiring" });
    const [row] = await db!.select().from(schema.orgMembers).where(eq(schema.orgMembers.userId, hr));
    expect(row).toMatchObject({ workEmailDomain: d, workEmailVerifiedAt: day(181), recheckDueAt: day(361) });
    expect(JSON.stringify(row)).not.toContain("rahul.menon");
    expect((await codeRows(hr)).every((c) => c.email === null)).toBe(true);
    // Nothing to re-check now.
    expect(await startRecheck(hr, { workEmail: `rahul@${d}` }, due)).toEqual({ ok: false, error: "not_found" });
    expect(lines.join("\n")).not.toContain("rahul");
  });
});
