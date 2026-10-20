import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { exportAccountData } from "@/lib/account/export";
import { confirmProfile, getResumeForOwner, MAX_PROFILE_VERSIONS } from "@/lib/resume/store";
import { builderAnswers, EMPTY_BUILDER_ANSWERS } from "@/lib/schemas";
import type { RewordClient } from "./reword";
import { BUILDER_MIME, buildResume, loadDraft, readyForGaps, reviewDraft, saveDraft } from "./store";

vi.mock("server-only", () => ({}));

// Build your resume (FR-36) against a real Postgres with migrations applied. Every answer here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const answers = builderAnswers.parse({
  role: { roleSlug: "cyber-security-analyst", stage: "graduated", city: "Pune" },
  education: [{ id: "e1", degree: "B.Sc. Computer Science", college: "Example College", start: "2021", end: "2024" }],
  projects: [{ id: "p1", name: "Home lab", did: "Set up Wazuh on 3 home machines." }],
  worked: false,
  tools: ["Wazuh"],
  noCertificates: true,
});

function client(reply: object | Error) {
  const create = vi.fn();
  if (reply instanceof Error) create.mockRejectedValue(reply);
  else create.mockResolvedValue({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 200 }, content: [{ type: "text", text: JSON.stringify(reply) }] });
  return { client: { beta: { messages: { create } } } as unknown as RewordClient, create };
}

describe.skipIf(!db)("builder store (database)", () => {
  const run = `builder${Date.now()}`;
  const userIds: string[] = [];
  let n = 0;
  const now = new Date();
  const person = async () => {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: "Asha Example" })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  };

  // Other test files' calls count toward today's spend in a shared database, so the budget is out of the way here.
  beforeAll(() => vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000"));
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient?.end();
  });

  it("saves and loads a draft, and keeps each person's draft their own", async () => {
    const a = await person();
    const b = await person();
    expect(await loadDraft(a, db!)).toEqual({ answers: EMPTY_BUILDER_ANSWERS, resumeId: null });
    expect(await saveDraft(a, answers, { db: db!, now })).toEqual({ ok: true });
    expect((await loadDraft(a, db!)).answers).toEqual(answers);
    expect((await loadDraft(b, db!)).answers).toEqual(EMPTY_BUILDER_ANSWERS);
    // A link off its site comes back on its field, and nothing is saved; a half-typed year is saved as typed.
    const bad = await saveDraft(a, { ...answers, links: { github: "https://gitlab.com/x" } }, { db: db!, now });
    expect(bad).toEqual({ ok: false, error: "invalid", issues: { "links.github": expect.any(String) } });
    expect((await loadDraft(a, db!)).answers).toEqual(answers);
    const halfway = { ...answers, education: [{ ...answers.education[0], end: "20" }], links: { ...answers.links, portfolio: "example.com/work" } };
    expect(await saveDraft(a, halfway, { db: db!, now })).toEqual({ ok: true });
    expect((await loadDraft(a, db!)).answers).toMatchObject({ education: [{ end: "20" }], links: { portfolio: "https://example.com/work" } });
    // Review asks for the whole year, on its field.
    expect(await reviewDraft(a, halfway, { db: db!, now })).toEqual({ ok: false, error: "not_ready" });
    expect(await reviewDraft(a, { ...halfway, education: [{ ...answers.education[0], start: "2O21" }] }, { db: db!, now })).toMatchObject({
      ok: false,
      error: "invalid",
      issues: { "education.0.start": expect.any(String) },
    });
  });

  it("builds a resume waiting for the confirm step, drops a made-up line and keeps suggestions out", async () => {
    const a = await person();
    await saveDraft(a, answers, { db: db!, now });
    const reply = {
      answers: [{ answerId: "p:p1", lines: ["Deployed Wazuh on 3 home machines", "Cut alert noise by 40% with Splunk"] }],
      suggestions: [{ kind: "tool", text: "Did you use Splunk here?", answerId: "p:p1" }],
    };
    const { client: c, create } = client(reply);
    const built = await buildResume(a, { db: db!, now, client: c });
    if (!built.ok) throw new Error(built.error);
    expect(create).toHaveBeenCalledTimes(1);
    // The answers go to the model; the name, city and email never do.
    const sent = JSON.stringify(create.mock.calls[0][0].messages);
    expect(sent).not.toContain("Asha");
    expect(sent).not.toContain("Pune");
    expect(built.suggestions).toEqual(reply.suggestions);
    // "Check my gaps" needs the tick, and only for the person's own built resume.
    expect(await readyForGaps(a, built.resumeId, false, db!)).toEqual({ ok: false, error: "not_true" });
    expect(await readyForGaps(a, built.resumeId, true, db!)).toEqual({ ok: true });
    expect(await readyForGaps(await person(), built.resumeId, true, db!)).toEqual({ ok: false, error: "not_ready" });

    const review = await getResumeForOwner(built.resumeId, { userId: a }, db!);
    expect(review?.confirmed).toBe(false);
    expect(review?.profile.roles[0]).toMatchObject({ title: "Home lab", employer: "Project", highlights: ["Deployed Wazuh on 3 home machines"] });
    expect(review?.profile.skills.map((s) => s.name)).toEqual(["Wazuh"]);
    expect(JSON.stringify(review?.profile)).not.toContain("Splunk");
    const [resume] = await db!.select().from(schema.resumes).where(eq(schema.resumes.id, built.resumeId));
    expect(resume).toMatchObject({ source: "builder", status: "parsed", mimeType: BUILDER_MIME, storageKey: null });
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, (await db!.select().from(schema.profiles).where(eq(schema.profiles.resumeId, built.resumeId)))[0].aiCallId!));
    expect(call.promptVersion).toBe("build-resume/v1");
    expect(JSON.stringify(call.inputRefs)).not.toContain("Wazuh");

    // The confirm step takes it like an upload, and the next build adds a version to the same resume.
    expect((await confirmProfile(built.resumeId, { userId: a }, review!.profile, db!)).ok).toBe(true);
    const again = await buildResume(a, { db: db!, now, client: client(new Error("down")).client });
    expect(again).toMatchObject({ ok: true, resumeId: built.resumeId, plain: true, suggestions: [] });
    expect((await getResumeForOwner(built.resumeId, { userId: a }, db!))?.profile.roles[0].highlights).toEqual(["Set up Wazuh on 3 home machines."]);
  });

  it("rebuilds replace the version waiting for the confirm step, and stop at the version cap", async () => {
    const a = await person();
    await saveDraft(a, answers, { db: db!, now });
    const versions = async (resumeId: string) =>
      (await db!.select({ v: schema.profiles.version, confirmed: schema.profiles.confirmedByUser }).from(schema.profiles).where(eq(schema.profiles.resumeId, resumeId))).sort((x, y) => x.v - y.v);
    const first = await buildResume(a, { db: db!, now, client: client(new Error("down")).client });
    if (!first.ok) throw new Error(first.error);
    for (let k = 0; k < 3; k++) expect(await buildResume(a, { db: db!, now, client: client(new Error("down")).client })).toMatchObject({ ok: true, resumeId: first.resumeId });
    expect(await versions(first.resumeId)).toEqual([{ v: 1, confirmed: false }]);

    // A confirmed version stays; the next build is a new version, and rebuilding replaces that one.
    const review = await getResumeForOwner(first.resumeId, { userId: a }, db!);
    expect((await confirmProfile(first.resumeId, { userId: a }, review!.profile, db!)).ok).toBe(true);
    await buildResume(a, { db: db!, now, client: client(new Error("down")).client });
    await buildResume(a, { db: db!, now, client: client(new Error("down")).client });
    expect(await versions(first.resumeId)).toEqual([
      { v: 1, confirmed: false },
      { v: 2, confirmed: true },
      { v: 3, confirmed: false },
    ]);

    // Confirmed up to the cap: no more versions.
    await db!.delete(schema.profiles).where(and(eq(schema.profiles.resumeId, first.resumeId), eq(schema.profiles.version, 3)));
    await db!.insert(schema.profiles).values(
      Array.from({ length: MAX_PROFILE_VERSIONS - 2 }, (_, k) => ({ resumeId: first.resumeId, version: k + 3, data: review!.profile, confirmedByUser: true })),
    );
    expect(await buildResume(a, { db: db!, now, client: client(new Error("down")).client })).toEqual({ ok: false, error: "too_many" });
    expect((await versions(first.resumeId)).length).toBe(MAX_PROFILE_VERSIONS);
  });

  it("makes one resume and one version from a double click", async () => {
    const a = await person();
    await saveDraft(a, answers, { db: db!, now });
    const [x, y] = await Promise.all([
      buildResume(a, { db: db!, now, client: client(new Error("down")).client }),
      buildResume(a, { db: db!, now, client: client(new Error("down")).client }),
    ]);
    if (!x.ok || !y.ok) throw new Error("a build failed");
    expect(x.resumeId).toBe(y.resumeId);
    expect(await db!.select({ id: schema.resumes.id }).from(schema.resumes).where(eq(schema.resumes.userId, a))).toHaveLength(1);
    expect(await db!.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.resumeId, x.resumeId))).toHaveLength(1);
  });

  it("reserves the reword under the parse budget, and uses the person's own words when the budget is spent", async () => {
    const a = await person();
    await saveDraft(a, answers, { db: db!, now });
    const reply = { answers: [{ answerId: "p:p1", lines: ["Deployed Wazuh on 3 home machines"] }], suggestions: [] };
    const ok = client(reply);
    const built = await buildResume(a, { db: db!, now, client: ok.client });
    if (!built.ok) throw new Error(built.error);
    const [profile] = await db!.select({ aiCallId: schema.profiles.aiCallId }).from(schema.profiles).where(eq(schema.profiles.resumeId, built.resumeId));
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, profile.aiCallId!));
    expect(call).toMatchObject({ purpose: "build-resume", status: "done", ok: true, promptVersion: "build-resume/v1", inputRefs: { userId: a } });

    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "0");
    try {
      const spent = client(reply);
      expect(await buildResume(a, { db: db!, now, client: spent.client })).toMatchObject({ ok: true, plain: true, suggestions: [] });
      expect(spent.create).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
    }
  });

  it("refuses a build with sections missing, and puts the draft in Download your data", async () => {
    const a = await person();
    expect(await buildResume(a, { db: db!, now })).toEqual({ ok: false, error: "not_ready" });
    await saveDraft(a, answers, { db: db!, now });
    const data = await exportAccountData(a, db!);
    expect(data?.builderDraft?.answers).toEqual(answers);
  });
});
