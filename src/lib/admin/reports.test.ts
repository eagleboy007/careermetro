import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const log = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { reportsForReview, reviewReport, REPORT_REVIEW_TEXT } = await import("./reports");

// The report review (/admin/reports, FR-45) against a real Postgres with migrations applied. Every fixture is made
// here, so it runs on an unseeded database.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const HOUR = 3_600_000;

describe.skipIf(!db)("report review (database)", () => {
  const run = `rpr-${Date.now()}`;
  const userIds: string[] = [];
  const reportIds: string[] = [];
  const chatIds: string[] = [];
  const adminId = "2d0a0c74-8c3f-4d9a-9f8c-4a3f5e6d7c8b";
  const at = new Date("2026-10-15T04:30:00Z");

  beforeEach(() => log.mockClear());
  afterAll(async () => {
    await db!.delete(schema.auditLogs).where(eq(schema.auditLogs.actor, `admin:${adminId}`));
    if (chatIds.length) await db!.delete(schema.conversations).where(inArray(schema.conversations.id, chatIds));
    if (reportIds.length) await db!.delete(schema.reports).where(inArray(schema.reports.id, reportIds));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.organizations).where(like(schema.organizations.emailDomain, `%${run}%`));
    await sqlClient!.end();
  });

  async function person(n: string, firstName: string, lastName: string) {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.test`, firstName, lastName, name: `${firstName} ${lastName}` })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }
  async function chat(kind: "direct" | "found", members: string[], orgId: string | null = null) {
    const [c] = await db!.insert(schema.conversations).values({ kind, status: "open", orgId, startedBy: members[0] }).returning({ id: schema.conversations.id });
    chatIds.push(c.id);
    await db!.insert(schema.conversationMembers).values(members.map((userId) => ({ conversationId: c.id, userId, role: "member" as const })));
    return c.id;
  }
  async function file(reporterId: string, target: "message" | "person" | "chat", targetId: string, reason: (typeof schema.reports.$inferInsert)["reason"], minutes: number, note: string | null = null) {
    const [r] = await db!
      .insert(schema.reports)
      .values({ reporterId, target, targetId, reason, note, createdAt: new Date(at.getTime() + minutes * 60_000) })
      .returning({ id: schema.reports.id });
    reportIds.push(r.id);
    return r.id;
  }
  const mine = async () => (await reportsForReview({ db: db! })).filter((r) => reportIds.includes(r.id));

  it("lists open reports oldest first with their deadlines and what was reported, with short names and no email", async () => {
    const asha = await person("a", "Asha", "Verma");
    const ravi = await person("r", "Ravi", "Kulkarni");
    const recruiter = await person("h", "Hari", "Menon");
    const [org] = await db!.insert(schema.organizations).values({ name: "Example Labs", emailDomain: `${run}.example.test` }).returning({ id: schema.organizations.id });
    const direct = await chat("direct", [asha, ravi]);
    const found = await chat("found", [asha], org.id);
    const [msg] = await db!.insert(schema.messages).values({ conversationId: found, senderId: recruiter, body: "Pay a fee of 5,000 to book the interview." }).returning({ id: schema.messages.id });

    const first = await file(asha, "message", msg.id, "money_or_otp", 0, "They asked me to pay.");
    const second = await file(asha, "person", ravi, "intimate_or_impersonation", 5);
    const third = await file(asha, "chat", direct, "other", 10);
    const closed = await file(ravi, "person", asha, "harassment", 1);
    await db!.update(schema.reports).set({ status: "dismissed", resolvedAt: at }).where(eq(schema.reports.id, closed));

    const list = await mine();
    expect(list.map((r) => r.id)).toEqual([first, second, third]);
    expect(list[0]).toMatchObject({
      reason: "Asked for money, an OTP or bank details",
      what: "A message",
      reporter: "Asha V.",
      note: "They asked me to pay.",
      acknowledgedAt: null,
      acknowledgeBy: new Date(at.getTime() + 24 * HOUR).toISOString(),
      decideBy: new Date(at.getTime() + 72 * HOUR).toISOString(),
      context: { label: "Message from Hari M. at Example Labs", text: "Pay a fee of 5,000 to book the interview." },
    });
    expect(list[1]).toMatchObject({ what: "A person", decideBy: new Date(at.getTime() + 5 * 60_000 + 24 * HOUR).toISOString(), context: { label: "Person: Ravi K.", text: null } });
    expect(list[2]).toMatchObject({ what: "A chat", context: { label: "Chat with Ravi K.", text: null } });
    const text = JSON.stringify(list);
    expect(text).not.toContain("@example.test");
    expect(text).not.toContain("Kulkarni");
  });

  it("acknowledges once, closes as action taken or dismissed, writes one audit line each, and refuses a closed report", async () => {
    const meera = await person("m", "Meera", "Iyer");
    const other = await person("o", "Om", "Das");
    const a = await file(meera, "person", other, "harassment", 20);
    const b = await file(meera, "person", other, "fake_or_spam", 21);
    const now = new Date(at.getTime() + HOUR);

    expect(await reviewReport(adminId, { reportId: a, decision: "acknowledge" }, { db: db!, now })).toEqual({ ok: true, message: REPORT_REVIEW_TEXT.acknowledge });
    expect(await reviewReport(adminId, { reportId: a, decision: "acknowledge" }, { db: db!, now })).toEqual({ ok: true, message: REPORT_REVIEW_TEXT.already });
    expect((await mine()).find((r) => r.id === a)?.acknowledgedAt).toBe(now.toISOString());

    const later = new Date(now.getTime() + HOUR);
    expect(await reviewReport(adminId, { reportId: a, decision: "actioned" }, { db: db!, now: later })).toEqual({ ok: true, message: REPORT_REVIEW_TEXT.actioned });
    expect(await reviewReport(adminId, { reportId: b, decision: "dismissed" }, { db: db!, now: later })).toEqual({ ok: true, message: REPORT_REVIEW_TEXT.dismissed });
    const rows = await db!.select().from(schema.reports).where(inArray(schema.reports.id, [a, b]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)).toMatchObject({ status: "actioned", acknowledgedAt: now, resolvedAt: later });
    // Closing acknowledges a report that hadn't been.
    expect(byId.get(b)).toMatchObject({ status: "dismissed", acknowledgedAt: later, resolvedAt: later });
    expect((await mine()).some((r) => r.id === a || r.id === b)).toBe(false);

    expect(await reviewReport(adminId, { reportId: a, decision: "dismissed" }, { db: db!, now: later })).toEqual({ ok: false, message: REPORT_REVIEW_TEXT.not_found });
    expect(await reviewReport(adminId, { reportId: "not-a-uuid", decision: "dismissed" }, { db: db! })).toEqual({ ok: false, message: REPORT_REVIEW_TEXT.invalid });
    expect(await reviewReport(adminId, { reportId: a, decision: "delete" }, { db: db! })).toEqual({ ok: false, message: REPORT_REVIEW_TEXT.invalid });

    const audit = await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.actor, `admin:${adminId}`));
    expect(audit.map((l) => [l.action, l.target]).sort()).toEqual(
      [
        ["report_acknowledged", `report:${a}`],
        ["report_actioned", `report:${a}`],
        ["report_dismissed", `report:${b}`],
      ].sort(),
    );
    // Logs carry the decision and outcome only.
    for (const call of log.mock.calls) expect(JSON.stringify(call)).not.toMatch(/Meera|Iyer|example\.test/);
  });
});
