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
import { NO_NAME } from "@/lib/account/name";
import { meFor } from "./store";

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
  certifications: [{ name: "Made-up Certificate", earned: null, expires: null }],
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
    expect(theirMe!.certifications.map((c) => [c.name, c.status, c.fromResume])).toEqual([["Made-up Certificate", "added", true]]);
    expect(theirMe!.skills.missing.length + theirMe!.skills.weak.length).toBe(gaps.analysis.gaps.length);

    const myMe = await meFor(mine, new Date(), db!);
    expect(myMe).toMatchObject({ name: "Asha", aim: null, experience: [], certifications: [] });
  });

  it("lists the person's own accepted certificate proofs, verified first, and never held ones or anyone else's", async () => {
    const mine = await user("certs", "Asha Rao");
    const theirs = await user("certs-other", "Ravi Menon");
    const row = (userId: string, certId: string, over: Partial<typeof schema.gapProofs.$inferInsert> = {}) => ({
      userId,
      skillId: "aws",
      type: "certification" as const,
      status: "accepted" as const,
      certId,
      credentialKey: `${certId}-${userId}`,
      issuedOn: "2025-03-01",
      expiresOn: null,
      evidence: { type: "certification" as const, certId, issuer: "x", url: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000002" },
      ...over,
    });
    await db!.insert(schema.gapProofs).values([
      row(mine, "aws-developer-associate", { issuedOn: "2026-01-01", checkNote: "earner_name" }),
      row(mine, "aws-cloud-practitioner", { verifier: "credly", badgeId: "c4ed1100-0000-4000-8000-000000000002" }),
      row(mine, "aws-security-specialty", { status: "pending", heldReason: "credential_reused" }),
      row(theirs, "aws-devops-professional"),
    ]);
    const me = await meFor(mine, new Date("2026-10-13T06:00:00Z"), db!);
    expect(meProfile.safeParse(me).success).toBe(true);
    expect(me!.certifications.map((c) => [c.name, c.status, c.date])).toEqual([
      ["AWS Certified Cloud Practitioner", "verified", "Mar 2025"],
      ["AWS Certified Developer – Associate", "added", "Jan 2026"],
    ]);
    expect(me!.certifications[0].badgeUrl).toBe("https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000002");
    expect(me!.certifications[1].note).toMatch(/doesn't match your account/);
  });
});
