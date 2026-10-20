import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { libraryAdminView } from "@/lib/schemas";
import { decideResource, decideSuggestion, libraryReviewQueue } from "./library";

vi.mock("server-only", () => ({}));

// The Library review page (/admin/library, docs/plans/library-part-2-plan.md) against a real Postgres with migrations
// applied. Every person and link here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("Library review (database)", () => {
  const run = `libadmin-${Date.now()}`;
  const linkPrefix = `https://library-admin.example.test/${run}/`;
  const userIds: string[] = [];
  let n = 0;
  const user = async () => {
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${n++}@example.test`, name: "Ravi Example" }).returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  };
  const resource = async (tag: string) => {
    const [row] = await db!
      .insert(schema.resources)
      .values({ title: `Admin course ${tag}`, url: `${linkPrefix}${tag}`, provider: "Example Learn", kind: "course", skillIds: ["sql"], minutes: 30 })
      .returning({ id: schema.resources.id });
    return row.id;
  };
  const audit = async (target: string) => (await db!.select({ actor: schema.auditLogs.actor, action: schema.auditLogs.action }).from(schema.auditLogs).where(eq(schema.auditLogs.target, target)));
  const ours = <T extends { url: string }>(rows: T[]) => rows.filter((r) => r.url.startsWith(linkPrefix));

  afterAll(async () => {
    await db!.delete(schema.resourceSuggestions).where(like(schema.resourceSuggestions.url, `${linkPrefix}%`));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.resources).where(like(schema.resources.url, `${linkPrefix}%`));
    await sqlClient!.end();
  });

  it("lists reported links and suggestions oldest first, with counts by reason and no one's name", async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const older = await resource("older");
    const newer = await resource("newer");
    await db!.insert(schema.resourceReports).values([
      { resourceId: newer, userId: a, reason: "broken", createdAt: new Date("2026-10-19T05:00:00Z") },
      { resourceId: older, userId: a, reason: "broken", createdAt: new Date("2026-10-18T05:00:00Z") },
      { resourceId: older, userId: b, reason: "broken", createdAt: new Date("2026-10-18T06:00:00Z") },
      { resourceId: older, userId: c, reason: "not_free", createdAt: new Date("2026-10-18T07:00:00Z") },
    ]);
    await db!.insert(schema.resourceSuggestions).values([
      { userId: a, url: `${linkPrefix}s-new`, host: "library-admin.example.test", skillId: "sql", createdAt: new Date("2026-10-19T05:00:00Z") },
      { userId: b, url: `${linkPrefix}s-old`, host: "library-admin.example.test", skillId: null, createdAt: new Date("2026-10-17T05:00:00Z") },
    ]);
    const queue = await libraryReviewQueue({ db: db! });
    expect(libraryAdminView.safeParse(queue).success).toBe(true);
    const broken = ours(queue.broken);
    expect(broken.map((r) => r.id)).toEqual([older, newer]);
    expect(broken[0]).toMatchObject({ counts: { broken: 2, not_free: 1, outdated: 0, other: 0 }, firstReported: "2026-10-18", hidden: false, healthy: true });
    const suggestions = ours(queue.suggestions);
    expect(suggestions.map((s) => s.url)).toEqual([`${linkPrefix}s-old`, `${linkPrefix}s-new`]);
    expect(suggestions.map((s) => s.skill)).toEqual([null, "SQL"]);
    expect(JSON.stringify(queue)).not.toMatch(/Ravi|@example\.test/);
  });

  it("hides, shows again and dismisses, with one audit line per change", async () => {
    const admin = await user();
    const reporter = await user();
    const link = await resource("hide-me");
    await db!.insert(schema.resourceReports).values({ resourceId: link, userId: reporter, reason: "broken" });
    expect(await decideResource(admin, { resourceId: link, decision: "hide" }, { db: db! })).toMatchObject({ ok: true });
    const [row] = await db!.select({ hiddenAt: schema.resources.hiddenAt, healthy: schema.resources.healthy }).from(schema.resources).where(eq(schema.resources.id, link));
    // Hidden apart from the link check's own column.
    expect(row.hiddenAt).not.toBeNull();
    expect(row.healthy).toBe(true);
    const [report] = await db!.select().from(schema.resourceReports).where(eq(schema.resourceReports.resourceId, link));
    expect(report).toMatchObject({ status: "hidden", decidedBy: admin });
    // It stays on the list as hidden, so it can be shown again.
    expect(ours((await libraryReviewQueue({ db: db! })).broken).find((r) => r.id === link)).toMatchObject({ hidden: true, counts: { broken: 0 } });
    // Hiding again changes nothing and writes nothing.
    expect(await decideResource(admin, { resourceId: link, decision: "hide" }, { db: db! })).toMatchObject({ ok: true });
    expect(await decideResource(admin, { resourceId: link, decision: "show" }, { db: db! })).toMatchObject({ ok: true });
    expect(ours((await libraryReviewQueue({ db: db! })).broken).some((r) => r.id === link)).toBe(false);

    await db!.insert(schema.resourceReports).values({ resourceId: link, userId: reporter, reason: "outdated" });
    expect(await decideResource(admin, { resourceId: link, decision: "dismiss" }, { db: db! })).toMatchObject({ ok: true });
    expect(await decideResource(admin, { resourceId: link, decision: "dismiss" }, { db: db! })).toMatchObject({ ok: true, message: "No open reports on that link." });
    expect((await audit(`resource:${link}`)).map((a) => `${a.actor} ${a.action}`).sort()).toEqual(
      [`admin:${admin} resource_hidden`, `admin:${admin} resource_reports_dismissed`, `admin:${admin} resource_shown`],
    );
    expect(await decideResource(admin, { resourceId: link, decision: "delete" }, { db: db! })).toMatchObject({ ok: false });
  });

  it("records a suggestion's decision once, with its audit line, and never touches the catalog", async () => {
    const admin = await user();
    const sender = await user();
    const [s] = await db!
      .insert(schema.resourceSuggestions)
      .values({ userId: sender, url: `${linkPrefix}s-decide`, host: "library-admin.example.test" })
      .returning({ id: schema.resourceSuggestions.id });
    expect(await decideSuggestion(admin, { suggestionId: s.id, decision: "declined", declineReason: null }, { db: db! })).toMatchObject({ ok: false });
    expect(await decideSuggestion(admin, { suggestionId: s.id, decision: "accepted", declineReason: null }, { db: db! })).toMatchObject({ ok: true });
    // Already decided.
    expect(await decideSuggestion(admin, { suggestionId: s.id, decision: "declined", declineReason: "paywall" }, { db: db! })).toMatchObject({ ok: false });
    const [row] = await db!.select().from(schema.resourceSuggestions).where(eq(schema.resourceSuggestions.id, s.id));
    expect(row).toMatchObject({ status: "accepted", declineReason: null, decidedBy: admin });
    expect(await db!.select().from(schema.resources).where(eq(schema.resources.url, `${linkPrefix}s-decide`))).toEqual([]);
    expect(await audit(`suggestion:${s.id}`)).toEqual([{ actor: `admin:${admin}`, action: "suggestion_accepted" }]);
  });
});
