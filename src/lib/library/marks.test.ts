import { readFileSync } from "node:fs";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { decideResource, decideSuggestion } from "@/lib/admin/library";
import { GAP_LIMITS, getGapsForOwner } from "@/lib/gaps/store";
import { getPathForOwner, PATH_LIMITS } from "@/lib/path/store";
import { ingestResume } from "@/lib/resume/ingest";
import type { ParseClient } from "@/lib/resume/parse";
import { confirmProfile } from "@/lib/resume/store";
import { tickTask, todayRideFor } from "@/lib/ride/store";
import { libraryExport, libraryView, resourceReportExport, resourceSuggestionExport, type Profile } from "@/lib/schemas";
import { LIBRARY_CHANGES_PER_DAY, ON_RIDE_MAX, RESOURCE_REPORTS_PER_DAY, SUGGESTIONS_OPEN_MAX, SUGGESTIONS_PER_DAY } from "@/lib/schemas/constants";
import { LIMITS } from "@/lib/shared-limit";
import { clearOldLibraryRecords, LIBRARY_MESSAGES, libraryFor, reportResource, setLibraryMark, suggestResource } from "./store";

vi.mock("server-only", () => ({}));

it("keeps the daily limits the plan sets", () => {
  expect(LIMITS.libraryChangesPerUserDay.max).toBe(LIBRARY_CHANGES_PER_DAY);
  expect(LIBRARY_CHANGES_PER_DAY).toBe(300);
  expect(LIMITS.resourceReportsPerUserDay.max).toBe(RESOURCE_REPORTS_PER_DAY);
  expect(RESOURCE_REPORTS_PER_DAY).toBe(10);
  expect(LIMITS.resourceSuggestionsPerUserDay.max).toBe(SUGGESTIONS_PER_DAY);
  expect([SUGGESTIONS_PER_DAY, SUGGESTIONS_OPEN_MAX, ON_RIDE_MAX]).toEqual([5, 30, 5]);
  expect(LIBRARY_MESSAGES.ride_full).toBe("You have 5 on your rides. Finish or remove one first.");
  expect(LIBRARY_MESSAGES.duplicate).toBe("That link is already in the Library.");
});

// Library part 2 (docs/plans/library-part-2-plan.md) against a real Postgres with migrations applied. Every person,
// resume and link here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const bytes = new TextEncoder().encode(readFileSync("fixtures/resumes/priya-sharma.txt", "utf8"));
const parsed: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [],
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

describe.skipIf(!db)("Library marks, reports and suggestions (database)", () => {
  const run = `libmarks-${Date.now()}`;
  const linkPrefix = `https://library-marks.example.test/${run}/`;
  const userIds: string[] = [];
  const lines: string[] = [];
  const role = roleProfiles[0];
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  // Mid-afternoon in India, so the India day is the same date as the UTC one.
  const day = (n: number) => new Date(Date.UTC(2026, 9, 20 + n, 9));
  let n = 0;

  const user = async (tag: string) => {
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${tag}-${n++}@example.test`, name: "Asha Example" }).returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  };
  const resource = async (tag: string, skillIds: string[], extra: Partial<typeof schema.resources.$inferInsert> = {}) => {
    const [row] = await db!
      .insert(schema.resources)
      .values({ title: `Marks course ${tag}`, url: `${linkPrefix}${tag}`, provider: "Example Learn", kind: "course", skillIds, minutes: 30, ...extra })
      .returning({ id: schema.resources.id });
    return row.id;
  };
  const rowOf = async (userId: string, resourceId: string) =>
    (await db!.select().from(schema.userResources).where(and(eq(schema.userResources.userId, userId), eq(schema.userResources.resourceId, resourceId))))[0] ?? null;
  /** A person with a line for the role, its path built, and the skill today's ride is on. */
  const withLine = async (tag: string) => {
    const userId = await user(tag);
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-${tag}` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);
    const path = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
    if (!path.ok) throw new Error(path.reason);
    const today = await todayRideFor(userId, day(0), db!);
    const goalId = today!.ride.prove!.goalId;
    const view = await libraryFor(userId, day(0), db!);
    const skillId = view.goals.find((g) => g.goalId === goalId)!.skillId;
    return { userId, resumeId: r.resumeId, skillId, path: path.path };
  };

  beforeAll(async () => {
    await db!.insert(schema.skills).values(skills.map(({ id, name, category }) => ({ id, name, category }))).onConflictDoNothing();
    // A one-minute free link for every skill of the role, so the path picks these first (free, then shortest) even on
    // a seeded database, and hiding one touches no real catalog link.
    await db!
      .insert(schema.resources)
      .values(role.skills.map(({ skillId }, i) => ({ title: `Path course ${i}`, url: `${linkPrefix}path-${skillId}`, provider: "Example Learn", kind: "course", skillIds: [skillId], minutes: 1 })))
      .onConflictDoNothing();
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
    GAP_LIMITS.explainedPerOwnerPerDay = 0;
    PATH_LIMITS.wordedPerOwnerPerDay = 0;
  });
  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    vi.unstubAllEnvs();
    GAP_LIMITS.explainedPerOwnerPerDay = limits.explain;
    PATH_LIMITS.wordedPerOwnerPerDay = limits.word;
    await db!.delete(schema.resourceSuggestions).where(like(schema.resourceSuggestions.url, `${linkPrefix}%`));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.resources).where(like(schema.resources.url, `${linkPrefix}%`));
    await sqlClient!.end();
    // Titles and links never reach a log.
    expect(lines.join("\n")).not.toMatch(/Marks course|library-marks\.example\.test|Asha/);
  });

  it("saves and finishes for the person only, keeps an empty row nowhere, and unticking takes back only the box", async () => {
    const me = await user("save");
    const other = await user("save-other");
    const a = await resource("save-a", ["sql"]);
    const b = await resource("save-b", ["sql"]);
    expect(await setLibraryMark(me, { resourceId: a, mark: "saved", on: true }, { db: db!, now: day(0) })).toEqual({ ok: true });
    expect(await setLibraryMark(me, { resourceId: b, mark: "saved", on: true }, { db: db!, now: day(1) })).toEqual({ ok: true });
    expect(await setLibraryMark(me, { resourceId: a, mark: "finished", on: true }, { db: db!, now: day(1) })).toEqual({ ok: true });
    // Saving twice is fine and changes nothing.
    expect(await setLibraryMark(me, { resourceId: a, mark: "saved", on: true }, { db: db!, now: day(2) })).toEqual({ ok: true });
    expect((await rowOf(me, a))!.savedAt).toEqual(day(0));

    const view = await libraryFor(me, day(2), db!);
    expect(libraryView.safeParse(view).success).toBe(true);
    // Newest first.
    expect(view.saved.filter((id) => id === a || id === b)).toEqual([b, a]);
    expect(view.ticked).toContain(a);
    // Someone else's marks never show.
    const theirs = await libraryFor(other, day(2), db!);
    expect([...theirs.saved, ...theirs.ticked]).not.toContain(a);
    // Someone else can't take my mark off: their write is scoped to their own row.
    expect(await setLibraryMark(other, { resourceId: a, mark: "saved", on: false }, { db: db! })).toEqual({ ok: true });
    expect((await rowOf(me, a))!.savedAt).not.toBeNull();

    // Unticking the box keeps the save; taking the save off too deletes the row.
    expect(await setLibraryMark(me, { resourceId: a, mark: "finished", on: false }, { db: db! })).toEqual({ ok: true });
    expect(await rowOf(me, a)).toMatchObject({ finishedAt: null });
    expect(await setLibraryMark(me, { resourceId: a, mark: "saved", on: false }, { db: db! })).toEqual({ ok: true });
    expect(await rowOf(me, a)).toBeNull();
    // Bad input and unknown links are refused.
    expect(await setLibraryMark(me, { resourceId: a, mark: "liked", on: true }, { db: db! })).toEqual({ ok: false, error: "invalid" });
    expect(await setLibraryMark(me, { resourceId: "6f1c2b9e-0000-4000-8000-00000000dead", mark: "saved", on: true }, { db: db! })).toEqual({ ok: false, error: "not_found" });
    // A broken or paid link takes no new mark, but an old one can still come off.
    const paid = await resource("save-paid", ["sql"], { free: false });
    expect(await setLibraryMark(me, { resourceId: paid, mark: "saved", on: true }, { db: db! })).toEqual({ ok: false, error: "not_found" });
    await db!.update(schema.resources).set({ healthy: false }).where(eq(schema.resources.id, b));
    expect(await setLibraryMark(me, { resourceId: b, mark: "finished", on: true }, { db: db! })).toEqual({ ok: false, error: "not_found" });
    expect(await setLibraryMark(me, { resourceId: b, mark: "saved", on: false }, { db: db! })).toEqual({ ok: true });
    expect(await rowOf(me, b)).toBeNull();
  });

  it("counts every change against the day's 300", async () => {
    const me = await user("limit");
    const a = await resource("limit-a", ["sql"]);
    const at = day(5);
    const limit = { ...LIMITS.libraryChangesPerUserDay };
    LIMITS.libraryChangesPerUserDay.max = 2;
    try {
      expect((await setLibraryMark(me, { resourceId: a, mark: "saved", on: true }, { db: db!, now: at })).ok).toBe(true);
      expect((await setLibraryMark(me, { resourceId: a, mark: "saved", on: false }, { db: db!, now: at })).ok).toBe(true);
      expect(await setLibraryMark(me, { resourceId: a, mark: "saved", on: true }, { db: db!, now: at })).toEqual({ ok: false, error: "limit" });
    } finally {
      LIMITS.libraryChangesPerUserDay.max = limit.max;
    }
  });

  it("rides an added 90-minute course in 4 daily parts, finishes it with the last tick, and holds five at once", async () => {
    const { userId, skillId } = await withLine("ride");
    const long = await resource("ride-long", [skillId], { minutes: 90 });
    expect(await setLibraryMark(userId, { resourceId: long, mark: "onRide", on: true }, { db: db!, now: day(0) })).toEqual({ ok: true });
    for (let k = 1; k <= 4; k++) {
      const today = (await todayRideFor(userId, day(k), db!))!;
      expect(today.ride.tasks[0]).toMatchObject({ id: `res:${long}:${k}`, detail: `Example Learn · course · Part ${k} of 4` });
      expect(await tickTask(userId, `res:${long}:${k}`, true, day(k), db!)).toBe(true);
    }
    const after = await libraryFor(userId, day(5), db!);
    expect(after.finished).toContain(long);
    expect(after.added).not.toContain(long);
    expect((await todayRideFor(userId, day(5), db!))!.ride.tasks.map((t) => t.id)).not.toContain(`res:${long}:1`);

    // Five at once; the finished one no longer counts.
    const more: string[] = [];
    for (let k = 0; k < 6; k++) more.push(await resource(`ride-more-${k}`, [skillId]));
    for (const id of more.slice(0, 5)) expect(await setLibraryMark(userId, { resourceId: id, mark: "onRide", on: true }, { db: db!, now: day(5) })).toEqual({ ok: true });
    expect(await setLibraryMark(userId, { resourceId: more[5], mark: "onRide", on: true }, { db: db!, now: day(5) })).toEqual({ ok: false, error: "ride_full" });
    // Ticking one finished in the box makes room.
    expect(await setLibraryMark(userId, { resourceId: more[0], mark: "finished", on: true }, { db: db!, now: day(5) })).toEqual({ ok: true });
    expect(await setLibraryMark(userId, { resourceId: more[5], mark: "onRide", on: true }, { db: db!, now: day(5) })).toEqual({ ok: true });
    expect((await libraryFor(userId, day(5), db!)).added.length).toBe(ON_RIDE_MAX);
    // A link for no goal on the line can't go on a ride.
    const elsewhere = await resource("ride-elsewhere", ["no-such-skill-here"]);
    expect(await setLibraryMark(userId, { resourceId: elsewhere, mark: "onRide", on: true }, { db: db!, now: day(5) })).toEqual({ ok: false, error: "not_on_goals" });
  });

  it("keeps one open report per person and link, and takes none for a hidden link", async () => {
    const me = await user("report");
    const other = await user("report-other");
    const a = await resource("report-a", ["sql"]);
    expect(await reportResource(me, { resourceId: a, reason: "broken" }, { db: db! })).toEqual({ ok: true });
    expect(await reportResource(me, { resourceId: a, reason: "outdated" }, { db: db! })).toEqual({ ok: true });
    expect(await reportResource(other, { resourceId: a, reason: "not_free" }, { db: db! })).toEqual({ ok: true });
    const rows = await db!.select().from(schema.resourceReports).where(eq(schema.resourceReports.resourceId, a));
    expect(rows.map((r) => r.reason).sort()).toEqual(["broken", "not_free"]);
    expect(await reportResource(me, { resourceId: a, reason: "broken", note: "404" }, { db: db! })).toEqual({ ok: false, error: "invalid" });
    await db!.update(schema.resources).set({ hiddenAt: new Date() }).where(eq(schema.resources.id, a));
    expect(await reportResource(await user("report-late"), { resourceId: a, reason: "broken" }, { db: db! })).toEqual({ ok: false, error: "not_found" });
  });

  it("takes suggestions: cleaned, never a catalog link, five a day and thirty waiting", async () => {
    const me = await user("suggest");
    const at = day(7);
    const link = `${linkPrefix}suggested/sql-course`;
    expect(await suggestResource(me, { url: `${link}?utm_source=newsletter`, skillId: "sql" }, { db: db!, now: at })).toEqual({ ok: true });
    // The same link again stores nothing new.
    expect(await suggestResource(me, { url: link, skillId: "sql" }, { db: db!, now: at })).toEqual({ ok: true });
    const mine = await db!.select().from(schema.resourceSuggestions).where(eq(schema.resourceSuggestions.userId, me));
    expect(mine.map((s) => [s.url, s.host, s.skillId, s.status])).toEqual([[link, "library-marks.example.test", "sql", "open"]]);
    // A catalog link, however it is written, is a duplicate and names the item.
    const inCatalog = await resource("suggest-catalog", ["sql"]);
    expect(await suggestResource(me, { url: `${linkPrefix.replace("https://", "https://www.")}suggest-catalog/#intro`, skillId: null }, { db: db!, now: at })).toEqual({
      ok: false,
      error: "duplicate",
      resourceId: inCatalog,
    });
    expect(await suggestResource(me, { url: "http://example.org/x", skillId: null }, { db: db!, now: at })).toEqual({ ok: false, error: "bad_link" });
    expect(await suggestResource(me, { url: `${link}-2`, skillId: "not-a-skill-we-have" }, { db: db!, now: at })).toEqual({ ok: false, error: "invalid" });
    // Five tries a day, whatever came of them; a link or skill refused before the try isn't counted.
    expect((await suggestResource(me, { url: `${link}-3`, skillId: null }, { db: db!, now: at })).ok).toBe(true);
    expect((await suggestResource(me, { url: `${link}-4`, skillId: null }, { db: db!, now: at })).ok).toBe(true);
    expect(await suggestResource(me, { url: `${link}-5`, skillId: null }, { db: db!, now: at })).toEqual({ ok: false, error: "limit" });
    // Thirty waiting at once.
    const busy = await user("suggest-busy");
    await db!.insert(schema.resourceSuggestions).values(Array.from({ length: SUGGESTIONS_OPEN_MAX }, (_, k) => ({ userId: busy, url: `${link}/busy-${k}`, host: "library-marks.example.test" })));
    expect(await suggestResource(busy, { url: `${link}/busy-new`, skillId: null }, { db: db!, now: at })).toEqual({ ok: false, error: "too_many_open" });
  });

  it("hides a link from the Library, the path and the ride at once, and shows it again", async () => {
    const { userId, resumeId, path } = await withLine("hide");
    const course = path.steps.flatMap((s) => s.resources).find((r) => r.url.startsWith(linkPrefix))?.id;
    if (!course) throw new Error("the path took none of this test's links");
    const admin = await user("hide-admin");
    expect((await libraryFor(userId, day(0), db!)).items.some((i) => i.id === course)).toBe(true);
    expect((await decideResource(admin, { resourceId: course, decision: "hide" }, { db: db! })).ok).toBe(true);
    try {
      expect((await libraryFor(userId, day(0), db!)).items.some((i) => i.id === course)).toBe(false);
      const ride = (await todayRideFor(userId, day(0), db!))!;
      expect(ride.ride.tasks.some((t) => t.id.endsWith(course))).toBe(false);
      const again = await getPathForOwner(resumeId, { userId }, role, 5, { db: db! });
      if (!again.ok) throw new Error(again.reason);
      expect(again.path.steps.flatMap((s) => s.resources.map((r) => r.id))).not.toContain(course);
      // A mark can't be set on it while it is hidden.
      expect(await setLibraryMark(userId, { resourceId: course, mark: "saved", on: true }, { db: db! })).toEqual({ ok: false, error: "not_found" });
    } finally {
      expect((await decideResource(admin, { resourceId: course, decision: "show" }, { db: db! })).ok).toBe(true);
    }
    expect((await libraryFor(userId, day(0), db!)).items.some((i) => i.id === course)).toBe(true);
  });

  it("is in Download your data (version 27); marks go with the account, reports and suggestions stay without it", async () => {
    const me = await user("export");
    const a = await resource("export-a", ["sql"]);
    await setLibraryMark(me, { resourceId: a, mark: "saved", on: true }, { db: db! });
    await reportResource(me, { resourceId: a, reason: "outdated" }, { db: db! });
    await suggestResource(me, { url: `${linkPrefix}export-suggested`, skillId: null }, { db: db! });
    const data = (await exportAccountData(me, db!))!;
    expect(EXPORT_VERSION).toBe(27);
    expect(data.exportVersion).toBe(27);
    expect(libraryExport.parse(data.library).saved).toEqual([expect.objectContaining({ title: "Marks course export-a", url: `${linkPrefix}export-a` })]);
    expect(data.resourceReports.map((r) => resourceReportExport.parse(r))).toEqual([expect.objectContaining({ title: "Marks course export-a", reason: "outdated", status: "open" })]);
    expect(data.resourceSuggestions.map((s) => resourceSuggestionExport.parse(s))).toEqual([expect.objectContaining({ url: `${linkPrefix}export-suggested`, status: "open" })]);

    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await db!.select().from(schema.userResources).where(eq(schema.userResources.resourceId, a))).toEqual([]);
    const [report] = await db!.select().from(schema.resourceReports).where(eq(schema.resourceReports.resourceId, a));
    expect(report).toMatchObject({ userId: null, reason: "outdated" });
    const [suggestion] = await db!.select().from(schema.resourceSuggestions).where(eq(schema.resourceSuggestions.url, `${linkPrefix}export-suggested`));
    expect(suggestion).toMatchObject({ userId: null, status: "open" });
    // Deleting the resource takes its reports with it.
    await db!.delete(schema.resources).where(eq(schema.resources.id, a));
    expect(await db!.select().from(schema.resourceReports).where(eq(schema.resourceReports.resourceId, a))).toEqual([]);
  });

  it("deletes decided reports and suggestions 180 days after the decision, and keeps open ones", async () => {
    const me = await user("cleanup");
    const admin = await user("cleanup-admin");
    const a = await resource("cleanup-a", ["sql"]);
    const b = await resource("cleanup-b", ["sql"]);
    await reportResource(me, { resourceId: a, reason: "broken" }, { db: db! });
    await reportResource(me, { resourceId: b, reason: "broken" }, { db: db! });
    await suggestResource(me, { url: `${linkPrefix}cleanup-1`, skillId: null }, { db: db! });
    await suggestResource(me, { url: `${linkPrefix}cleanup-2`, skillId: null }, { db: db! });
    const decidedAt = new Date("2026-01-01T00:00:00Z");
    expect((await decideResource(admin, { resourceId: a, decision: "dismiss" }, { db: db!, now: decidedAt })).ok).toBe(true);
    const [s1] = await db!.select({ id: schema.resourceSuggestions.id }).from(schema.resourceSuggestions).where(eq(schema.resourceSuggestions.url, `${linkPrefix}cleanup-1`));
    expect((await decideSuggestion(admin, { suggestionId: s1.id, decision: "declined", declineReason: "affiliate" }, { db: db!, now: decidedAt })).ok).toBe(true);

    // 179 days on, nothing goes; at 181 the decided ones do.
    const DAY = 86_400_000;
    await clearOldLibraryRecords(db!, new Date(decidedAt.getTime() + 179 * DAY));
    expect(await db!.select().from(schema.resourceReports).where(eq(schema.resourceReports.resourceId, a))).toHaveLength(1);
    await clearOldLibraryRecords(db!, new Date(decidedAt.getTime() + 181 * DAY));
    expect(await db!.select().from(schema.resourceReports).where(eq(schema.resourceReports.resourceId, a))).toEqual([]);
    expect(await db!.select().from(schema.resourceReports).where(eq(schema.resourceReports.resourceId, b))).toHaveLength(1);
    const left = await db!.select({ url: schema.resourceSuggestions.url }).from(schema.resourceSuggestions).where(eq(schema.resourceSuggestions.userId, me));
    expect(left.map((s) => s.url)).toEqual([`${linkPrefix}cleanup-2`]);
  });
});
