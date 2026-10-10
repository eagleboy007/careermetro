import { readFileSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { GAP_LIMITS, getGapsForOwner } from "@/lib/gaps/store";
import { ingestResume } from "@/lib/resume/ingest";
import type { ParseClient } from "@/lib/resume/parse";
import { confirmProfile } from "@/lib/resume/store";
import { meProfile, type Profile } from "@/lib/schemas";
import { meFor, NO_NAME } from "./store";

vi.mock("server-only", () => ({}));

// Runs against a real Postgres with migrations applied, like the other store tests.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const bytes = new TextEncoder().encode(readFileSync("fixtures/resumes/priya-sharma.txt", "utf8"));
const parsed: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [{ title: "Analyst", employer: "Acme", start: "2023-01", end: null, highlights: [] }],
  skills: [{ name: "SQL", lastUsed: null, evidence: [] }],
  education: [],
  certifications: ["Made-up Certificate"],
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

describe.skipIf(!db)("meFor (database)", () => {
  const run = `me-${Date.now()}`;
  const userIds: string[] = [];
  const role = roleProfiles[0];
  const explain = GAP_LIMITS.explainedPerOwnerPerDay;
  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
    GAP_LIMITS.explainedPerOwnerPerDay = 0;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    GAP_LIMITS.explainedPerOwnerPerDay = explain;
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  async function user(n: string, name: string | null = null) {
    const [row] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.test`, name })
      .returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  }

  it("is null without an account, and shows only the account before a resume", async () => {
    expect(await meFor("00000000-0000-4000-8000-000000000000", new Date(), db!)).toBeNull();
    const me = await meFor(await user("new"), new Date(), db!);
    // T6: no name means a neutral label, never the part of the email before the @.
    expect(me).toMatchObject({ name: NO_NAME, aim: null, experience: [], resumeReadOn: null });
    expect(me!.journey.at(-1)).toMatchObject({ name: "Add your resume" });
  });

  it("shows each person only their own resume and gaps", async () => {
    const mine = await user("mine", "Asha");
    const theirs = await user("theirs", "Ravi");
    const owner = { userId: theirs };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-theirs` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);

    const theirMe = await meFor(theirs, new Date(), db!);
    expect(meProfile.safeParse(theirMe).success).toBe(true);
    expect(theirMe).toMatchObject({ name: "Ravi", aim: role.title });
    expect(theirMe!.experience.map((e) => e.title)).toEqual(["Analyst"]);
    expect(theirMe!.certifications).toEqual([{ name: "Made-up Certificate", verified: false }]);
    expect(theirMe!.skills.missing.length + theirMe!.skills.weak.length).toBe(gaps.analysis.gaps.length);

    const myMe = await meFor(mine, new Date(), db!);
    expect(myMe).toMatchObject({ name: "Asha", aim: null, experience: [], certifications: [] });
  });
});
