import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles } from "@/content";
import { exportAccountData } from "@/lib/account/export";
import { matchProfile } from "@/lib/gaps/match";
import type { Profile } from "@/lib/schemas";
import { ingestResume } from "./ingest";
import type { ParseClient } from "./parse";
import { confirmKeyword, screeningForPage } from "./screening-store";
import { confirmProfile, getResumeForOwner } from "./store";

// Runs against a real Postgres with migrations applied, like ingest.test.ts.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const bytes = new TextEncoder().encode(readFileSync("fixtures/resumes/priya-sharma.txt", "utf8"));
const parsed: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [{ title: "Data Analyst", employer: "Example Retail Pvt Ltd", start: "2022-06", end: null, highlights: ["Wrote SQL queries for weekly sales reports across 40 stores"] }],
  skills: [{ name: "SQL", lastUsed: null, evidence: ["Wrote SQL queries for weekly sales reports across 40 stores"] }],
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
const dataAnalyst = roleProfiles.find((r) => r.slug === "data-analyst")!;

describe.skipIf(!db)("screening check (database)", () => {
  const session = `screen-${Date.now()}`;
  const created: string[] = [];
  beforeAll(() => vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000"));
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (created.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.id, created));
    await sqlClient!.end();
  });

  async function confirmed(s: string) {
    const r = await ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}` }, { db: db!, client });
    if (!r.ok) throw new Error(`setup failed: ${r.code}`);
    created.push(r.resumeId);
    await confirmProfile(r.resumeId, { sessionId: s }, parsed, db!);
    return r.resumeId;
  }

  it("shows the check only for the owner's confirmed resume", async () => {
    const s = `${session}-a`;
    const id = await confirmed(s);
    const view = await screeningForPage(id, { sessionId: s }, { role: dataAnalyst }, { db: db! });
    expect(view).toMatchObject({ against: "role", layout: { state: "pasted" }, headings: { state: "checked", issues: [] } });
    expect(view!.keywords.missing.map((k) => k.skillId)).toContain("python");
    expect(await screeningForPage(id, { sessionId: `${s}-other` }, { role: dataAnalyst }, { db: db! })).toBeNull();
  });

  it("asks for the file again for a resume uploaded before the check, never guessing", async () => {
    const s = `${session}-old`;
    const id = await confirmed(s);
    await db!.update(schema.resumes).set({ screening: null }).where(eq(schema.resumes.id, id));
    const view = await screeningForPage(id, { sessionId: s }, { role: dataAnalyst }, { db: db! });
    expect(view).toMatchObject({ layout: { state: "unknown" }, headings: { state: "unknown" } });
  });

  const role = { roleSlug: "data-analyst" };

  it("adds a confirmed skill as listed only: it stays a weak gap, and only once", async () => {
    const s = `${session}-c`;
    const owner = { sessionId: s };
    const id = await confirmed(s);
    expect(await confirmKeyword(id, owner, { skillId: "python", target: role, version: 2 }, { db: db! })).toEqual({ ok: true, version: 3 });
    const after = await getResumeForOwner(id, owner, db!);
    expect(after!.confirmed).toBe(true);
    expect(after!.profile.skills.at(-1)).toEqual({ name: "Python", lastUsed: null, evidence: [] });
    expect(matchProfile(after!.profile, dataAnalyst).gaps.find((g) => g.skillId === "python")?.status).toBe("weak");
    // Named now, and SQL was always named: neither can be added again.
    expect(await confirmKeyword(id, owner, { skillId: "python", target: role, version: 3 }, { db: db! })).toEqual({ ok: false, reason: "already" });
    expect(await confirmKeyword(id, owner, { skillId: "sql", target: role, version: 3 }, { db: db! })).toEqual({ ok: false, reason: "already" });
    expect(await confirmKeyword(id, owner, { skillId: "not-a-skill", target: role, version: 3 }, { db: db! })).toEqual({ ok: false, reason: "unknown_skill" });
    expect(await confirmKeyword(id, { sessionId: `${s}-other` }, { skillId: "statistics", target: role, version: 3 }, { db: db! })).toEqual({ ok: false, reason: "not_found" });
  });

  it("accepts only a missing keyword of the page's own role or job check", async () => {
    const s = `${session}-t`;
    const owner = { sessionId: s };
    const id = await confirmed(s);
    // Terraform is a real skill, but Data Analyst doesn't ask for it.
    expect(await confirmKeyword(id, owner, { skillId: "terraform", target: role, version: 2 }, { db: db! })).toEqual({ ok: false, reason: "not_asked" });
    expect(await confirmKeyword(id, owner, { skillId: "python", target: { roleSlug: "no-such-role" }, version: 2 }, { db: db! })).toEqual({ ok: false, reason: "not_found" });
    const [check] = await db!
      .insert(schema.jobChecks)
      .values({ resumeId: id, roleSlug: "data-analyst", company: "Example Labs", title: "Analyst", requiredSkillIds: ["sql", "tableau"], textHash: `t-${s}` })
      .returning({ id: schema.jobChecks.id });
    const job = { checkId: check.id };
    expect(await confirmKeyword(id, owner, { skillId: "python", target: job, version: 2 }, { db: db! })).toEqual({ ok: false, reason: "not_asked" });
    expect(await confirmKeyword(id, { sessionId: `${s}-other` }, { skillId: "tableau", target: job, version: 2 }, { db: db! })).toEqual({ ok: false, reason: "not_found" });
    expect(await confirmKeyword(id, owner, { skillId: "tableau", target: job, version: 2 }, { db: db! })).toEqual({ ok: true, version: 3 });
  });

  it("refuses a change made on an older profile version, saved since in another tab", async () => {
    const s = `${session}-v`;
    const owner = { sessionId: s };
    const id = await confirmed(s);
    await confirmProfile(id, owner, parsed, db!);
    expect(await confirmKeyword(id, owner, { skillId: "python", target: role, version: 2 }, { db: db! })).toEqual({ ok: false, reason: "conflict" });
    expect((await getResumeForOwner(id, owner, db!))!.version).toBe(3);
    // confirmProfile itself refuses a stale version.
    expect(await confirmProfile(id, owner, parsed, db!, 2)).toEqual({ ok: false, reason: "conflict" });
  });

  it("refuses before the person has confirmed their profile", async () => {
    const s = `${session}-u`;
    const r = await ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}` }, { db: db!, client });
    if (!r.ok) throw new Error("setup failed");
    created.push(r.resumeId);
    expect(await confirmKeyword(r.resumeId, { sessionId: s }, { skillId: "python", target: role, version: 1 }, { db: db! })).toEqual({ ok: false, reason: "not_confirmed" });
  });

  it("puts the screening flags in the account's data download", async () => {
    const s = `${session}-x`;
    const id = await confirmed(s);
    const [user] = await db!.insert(schema.users).values({ email: `${s}@example.test` }).returning({ id: schema.users.id });
    try {
      await db!.update(schema.resumes).set({ userId: user.id }).where(eq(schema.resumes.id, id));
      const exported = await exportAccountData(user.id, db!);
      expect(exported?.exportVersion).toBe(11);
      expect(exported?.resumes[0].screening).toMatchObject({ version: 1, layout: "pasted", headings: { experience: "standard" } });
    } finally {
      await db!.delete(schema.users).where(eq(schema.users.id, user.id));
    }
  });
});
