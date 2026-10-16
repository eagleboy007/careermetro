import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { HIDDEN_MESSAGE_TEXT } from "@/lib/inbox/types";

const log = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { applyRemoval, removalsInForce, REMOVAL_TEXT } = await import("./removals");
const { reportsForReview, reviewReport } = await import("./reports");
const { listThreads } = await import("@/lib/inbox/store");

// The removal tools on /admin/reports (FR-46) against a real Postgres with migrations applied. Every fixture is made
// here, so it runs on an unseeded database.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const HOUR = 3_600_000;
const OTP = "Send me the OTP you just got, quickly.";
const WHY = "Asked for an OTP in the chat.";

describe.skipIf(!db)("report removal tools (database)", () => {
  const run = `rmv-${Date.now()}`;
  const userIds: string[] = [];
  const reportIds: string[] = [];
  const chatIds: string[] = [];
  const at = new Date("2026-10-15T04:30:00Z");
  const later = new Date(at.getTime() + HOUR);
  // Another admin, listed in ADMIN_EMAILS, whose account can't be suspended.
  const bossEmail = `${run}-boss@example.test`;
  const env = { ADMIN_EMAILS: `${run}-admin@example.test,${bossEmail}` };
  const deps = (now = later) => ({ db: db!, now, env });
  let adminId = "";

  beforeEach(() => log.mockClear());
  afterAll(async () => {
    if (userIds.length) {
      await db!.delete(schema.auditLogs).where(eq(schema.auditLogs.actor, `admin:${adminId}`));
      if (chatIds.length) await db!.delete(schema.conversations).where(inArray(schema.conversations.id, chatIds));
      if (reportIds.length) await db!.delete(schema.reports).where(inArray(schema.reports.id, reportIds));
      await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
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
  async function admin() {
    if (!adminId) adminId = await person("admin", "Milin", "Shah");
    return adminId;
  }
  /** A direct chat between two people with one message from the second, reported by the first. */
  async function reported(tag: string, target: "message" | "person" | "chat" = "message") {
    const reporter = await person(`${tag}-r`, "Asha", "Verma");
    const sender = await person(`${tag}-s`, "Ravi", "Kulkarni");
    // One transaction: another test file's account purge removes chats with no members (removeEmptyChats).
    const c = await db!.transaction(async (tx) => {
      const [row] = await tx.insert(schema.conversations).values({ kind: "direct", status: "open", startedBy: sender }).returning({ id: schema.conversations.id });
      await tx.insert(schema.conversationMembers).values([reporter, sender].map((userId) => ({ conversationId: row.id, userId, role: "member" as const })));
      return row;
    });
    chatIds.push(c.id);
    const [m] = await db!.insert(schema.messages).values({ conversationId: c.id, senderId: sender, body: OTP, createdAt: at }).returning({ id: schema.messages.id });
    const targetId = target === "message" ? m.id : target === "person" ? sender : c.id;
    const [r] = await db!.insert(schema.reports).values({ reporterId: reporter, target, targetId, reason: "money_or_otp", createdAt: at }).returning({ id: schema.reports.id });
    reportIds.push(r.id);
    return { reporter, sender, chatId: c.id, messageId: m.id, reportId: r.id };
  }
  const auditFor = async (target: string) =>
    (await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.target, target))).map((l) => [l.actor, l.action]).sort((a, b) => a[1].localeCompare(b[1]));
  const rowOf = async (reportId: string) => (await reportsForReview({ db: db!, adminUserId: adminId, env })).find((r) => r.id === reportId);

  it("hides a reported message for everyone in the chat and shows it again, keeping the text, with one audit line each", async () => {
    const me = await admin();
    const x = await reported("hide");

    expect(await applyRemoval(me, { action: "hide_message", reportId: x.reportId, reason: `  ${WHY} ` }, deps())).toEqual({ ok: true, message: REMOVAL_TEXT.hidden });
    const [row] = await db!.select().from(schema.messages).where(eq(schema.messages.id, x.messageId));
    expect(row).toMatchObject({ body: OTP, hiddenAt: later, hiddenBy: me, hiddenReason: WHY });
    // Both sides read the notice; the text never comes back from the Inbox read.
    for (const who of [x.reporter, x.sender]) {
      const [thread] = await listThreads(who, { db: db!, now: later });
      expect(thread.messages.map((m) => m.text)).toEqual([HIDDEN_MESSAGE_TEXT]);
      expect(JSON.stringify(thread)).not.toContain(OTP);
    }
    // The admin sees the state in words, and the text, on the report and in the list in force.
    expect((await rowOf(x.reportId))?.message).toEqual({ id: x.messageId, hidden: { at: later.toISOString(), by: "Milin S.", reason: WHY } });
    expect((await rowOf(x.reportId))?.context?.text).toBe(OTP);
    const inForce = await removalsInForce({ db: db! });
    expect(inForce.messages.find((m) => m.id === x.messageId)).toMatchObject({ label: "Message from Ravi K.", text: OTP, hidden: { by: "Milin S.", reason: WHY } });
    // Hiding doesn't close the report.
    expect((await rowOf(x.reportId))?.id).toBe(x.reportId);
    expect(await applyRemoval(me, { action: "hide_message", reportId: x.reportId, reason: WHY }, deps())).toEqual({ ok: true, message: REMOVAL_TEXT.already_hidden });

    // Shown again after the report is closed: undoing takes the message, not the report.
    expect((await reviewReport(me, { reportId: x.reportId, decision: "actioned" }, { db: db!, now: later })).ok).toBe(true);
    expect(await applyRemoval(me, { action: "hide_message", reportId: x.reportId, reason: WHY }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.not_open });
    expect(await applyRemoval(me, { action: "unhide_message", messageId: x.messageId }, deps())).toEqual({ ok: true, message: REMOVAL_TEXT.unhidden });
    expect(await applyRemoval(me, { action: "unhide_message", messageId: x.messageId }, deps())).toEqual({ ok: true, message: REMOVAL_TEXT.not_hidden });
    const [shown] = await db!.select().from(schema.messages).where(eq(schema.messages.id, x.messageId));
    expect(shown).toMatchObject({ body: OTP, hiddenAt: null, hiddenBy: null, hiddenReason: null });
    expect((await listThreads(x.reporter, { db: db!, now: later }))[0].messages.map((m) => m.text)).toEqual([OTP]);
    expect((await removalsInForce({ db: db! })).messages.some((m) => m.id === x.messageId)).toBe(false);

    expect(await auditFor(`message:${x.messageId}`)).toEqual([
      [`admin:${me}`, "message_hidden"],
      [`admin:${me}`, "message_unhidden"],
    ]);
    // Logs carry the action and outcome only: never the reason, the text or a name.
    for (const call of log.mock.calls) expect(JSON.stringify(call)).not.toMatch(/OTP|Asha|Ravi|Kulkarni|example\.test/);
  });

  it("hides only a message: a report about a person or a chat has none to hide, and a reason is required", async () => {
    const me = await admin();
    const p = await reported("hide-person", "person");
    expect(await applyRemoval(me, { action: "hide_message", reportId: p.reportId, reason: WHY }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.no_message });
    expect((await rowOf(p.reportId))?.message).toBeNull();
    const m = await reported("hide-blank");
    expect(await applyRemoval(me, { action: "hide_message", reportId: m.reportId, reason: "   " }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.no_reason });
    expect(await applyRemoval(me, { action: "hide_message", reportId: m.reportId }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.no_reason });
    expect(await applyRemoval(me, { action: "delete_message", reportId: m.reportId, reason: WHY }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.invalid });
    const [row] = await db!.select().from(schema.messages).where(eq(schema.messages.id, m.messageId));
    expect(row.hiddenAt).toBeNull();
  });

  it("suspends the account a report points at and lifts it, with one audit line each", async () => {
    const me = await admin();
    // A reported person, the writer of a reported message, and the other person in a reported direct chat.
    for (const target of ["person", "message", "chat"] as const) {
      const x = await reported(`susp-${target}`, target);
      expect((await rowOf(x.reportId))?.account).toEqual({ id: x.sender, name: "Ravi K.", suspended: null, canSuspend: true });
      expect(await applyRemoval(me, { action: "suspend_account", reportId: x.reportId, reason: WHY }, deps())).toEqual({ ok: true, message: REMOVAL_TEXT.suspended });
      const [u] = await db!.select().from(schema.users).where(eq(schema.users.id, x.sender));
      expect(u).toMatchObject({ suspendedAt: later, suspendedBy: me, suspendedReason: WHY, deletionRequestedAt: null });
      expect((await rowOf(x.reportId))?.account?.suspended).toEqual({ at: later.toISOString(), by: "Milin S.", reason: WHY });
      expect((await removalsInForce({ db: db! })).accounts.find((a) => a.id === x.sender)).toMatchObject({ name: "Ravi K.", suspended: { reason: WHY } });
      expect(await applyRemoval(me, { action: "suspend_account", reportId: x.reportId, reason: WHY }, deps())).toEqual({ ok: true, message: REMOVAL_TEXT.already_suspended });
      // The reporter is never the one suspended.
      const [reporter] = await db!.select({ at: schema.users.suspendedAt }).from(schema.users).where(eq(schema.users.id, x.reporter));
      expect(reporter.at).toBeNull();

      expect(await applyRemoval(me, { action: "lift_suspension", userId: x.sender }, deps())).toEqual({ ok: true, message: REMOVAL_TEXT.lifted });
      expect(await applyRemoval(me, { action: "lift_suspension", userId: x.sender }, deps())).toEqual({ ok: true, message: REMOVAL_TEXT.not_suspended });
      const [lifted] = await db!.select().from(schema.users).where(eq(schema.users.id, x.sender));
      expect(lifted).toMatchObject({ suspendedAt: null, suspendedBy: null, suspendedReason: null });
      expect(await auditFor(`user:${x.sender}`)).toEqual([
        [`admin:${me}`, "account_suspended"],
        [`admin:${me}`, "account_unsuspended"],
      ]);
    }
  });

  it("never suspends an admin's account or the admin's own, and never without a reason", async () => {
    const me = await admin();
    const boss = await db!.insert(schema.users).values({ email: bossEmail, firstName: "Nila", lastName: "Rao", name: "Nila Rao" }).returning({ id: schema.users.id });
    userIds.push(boss[0].id);
    const reporter = await person("adm-r", "Asha", "Verma");
    const file = async (targetId: string) => {
      const [r] = await db!.insert(schema.reports).values({ reporterId: reporter, target: "person", targetId, reason: "harassment", createdAt: at }).returning({ id: schema.reports.id });
      reportIds.push(r.id);
      return r.id;
    };
    const aboutBoss = await file(boss[0].id);
    const aboutMe = await file(me);
    expect((await rowOf(aboutBoss))?.account).toMatchObject({ name: "Nila R.", canSuspend: false });
    expect((await rowOf(aboutMe))?.account).toMatchObject({ canSuspend: false });
    expect(await applyRemoval(me, { action: "suspend_account", reportId: aboutBoss, reason: WHY }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.admin });
    expect(await applyRemoval(me, { action: "suspend_account", reportId: aboutMe, reason: WHY }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.self });
    const x = await reported("adm-blank", "person");
    expect(await applyRemoval(me, { action: "suspend_account", reportId: x.reportId, reason: "" }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.no_reason });
    const rows = await db!.select({ at: schema.users.suspendedAt }).from(schema.users).where(inArray(schema.users.id, [boss[0].id, me, x.sender]));
    expect(rows.every((r) => r.at === null)).toBe(true);
    expect(await auditFor(`user:${boss[0].id}`)).toEqual([]);
    expect(await auditFor(`user:${me}`)).toEqual([]);
  });

  it("points at no account for a company chat, and at nobody once the account has gone", async () => {
    const me = await admin();
    const reporter = await person("co-r", "Asha", "Verma");
    const [org] = await db!.insert(schema.organizations).values({ name: "Example Labs", emailDomain: `${run}.example.test` }).returning({ id: schema.organizations.id });
    // One transaction: another test file's account purge removes chats with no members (removeEmptyChats).
    const c = await db!.transaction(async (tx) => {
      const [row] = await tx.insert(schema.conversations).values({ kind: "found", status: "open", orgId: org.id, startedBy: reporter }).returning({ id: schema.conversations.id });
      await tx.insert(schema.conversationMembers).values({ conversationId: row.id, userId: reporter, role: "member" });
      return row;
    });
    chatIds.push(c.id);
    const [r] = await db!.insert(schema.reports).values({ reporterId: reporter, target: "chat", targetId: c.id, reason: "fake_or_spam", createdAt: at }).returning({ id: schema.reports.id });
    reportIds.push(r.id);
    expect((await rowOf(r.id))?.account).toBeNull();
    expect(await applyRemoval(me, { action: "suspend_account", reportId: r.id, reason: WHY }, deps())).toEqual({ ok: false, message: REMOVAL_TEXT.no_account });
    await db!.delete(schema.conversations).where(eq(schema.conversations.id, c.id));
    await db!.delete(schema.organizations).where(eq(schema.organizations.id, org.id));
  });
});
