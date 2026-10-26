import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { postView } from "@/lib/departures/fit";
import { isStagingBuild, sessionUrl, STAGING_POSTS } from "../../scripts/staging-db.mjs";
import skills from "../content/skills.json";

const script = resolve(__dirname, "../../scripts/staging-db.mjs");
const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, [script], { cwd: resolve(__dirname, "../.."), env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

describe("staging-db", () => {
  it("runs only for the staging branch's preview build", () => {
    expect(isStagingBuild({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging" })).toBe(true);
    expect(isStagingBuild({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "inbox-tables" })).toBe(false);
    expect(isStagingBuild({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "staging" })).toBe(false);
    expect(isStagingBuild({})).toBe(false);
  });

  it("moves Supabase's transaction pooler to its session port and leaves other links alone", () => {
    expect(sessionUrl("postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")).toBe("postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres");
    expect(sessionUrl("postgres://u:p@127.0.0.1:6543/cm")).toBe("postgres://u:p@127.0.0.1:6543/cm");
    expect(sessionUrl("not a link")).toBe("not a link");
  });

  it("seeds example feed posts that show as rows, one with the longest title the feed stores", () => {
    const skillIds = new Set(skills.map((x) => x.id));
    expect(Math.max(...STAGING_POSTS.map((p) => p.title.length))).toBe(160);
    for (const p of STAGING_POSTS) {
      expect(roleProfiles.some((r) => r.slug === p.role)).toBe(true);
      expect(p.required.every((id) => skillIds.has(id))).toBe(true);
      const row = postView(
        { ...p, workType: "full_time", experienceNote: "2 to 4 years", roleSlug: p.role, requiredSkillIds: p.required, niceSkillIds: [], url: `https://example.com/jobs/${p.id}`, postedAt: new Date(), firstSeenAt: new Date(), closedAt: null },
        null,
      );
      expect(row.role).toBe(p.title);
    }
  });

  it("does nothing outside the staging build", () => {
    const out = run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature", DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" });
    expect(out.status).toBe(0);
    expect(out.stdout + out.stderr).toBe("");
  });

  it("warns and lets the build go on when the database can't be reached", () => {
    const out = run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging", DATABASE_URL: "postgres://nobody:secret-pw@127.0.0.1:1/none" });
    expect(out.status).toBe(0);
    expect(out.stderr).toMatch(/staging-db: migrations failed/);
    expect(out.stdout + out.stderr).not.toMatch(/secret-pw/);
  });
});

// Brings an empty database up to date, twice: the second run changes nothing.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("staging-db on a real database", () => {
  const name = `cm_staging_${process.pid}`;
  const admin = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
  const target = url ? Object.assign(new URL(url), { pathname: `/${name}` }).toString() : "";
  afterAll(async () => {
    await admin?.unsafe(`drop database if exists ${name} with (force)`);
    await admin?.end();
  });

  it("applies every migration and loads the content", { timeout: 120_000 }, async () => {
    await admin!.unsafe(`create database ${name}`);
    const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging", DATABASE_URL: target };
    for (let i = 0; i < 2; i++) {
      const out = run(env);
      expect(out.status).toBe(0);
      expect(out.stdout).toMatch(/migrations applied[\s\S]*content loaded[\s\S]*example feed posts in place/);
    }
    const db = postgres(target, { max: 1, onnotice: () => {} });
    try {
      const [{ applied }] = await db`select count(*)::int as applied from drizzle.__drizzle_migrations`;
      const journal = (await import("../../drizzle/meta/_journal.json")).default as { entries: unknown[] };
      expect(applied).toBe(journal.entries.length);
      const [{ roles }] = await db`select count(*)::int as roles from role_profiles`;
      expect(roles).toBeGreaterThan(0);
      const [{ posts }] = await db`select count(*)::int as posts from job_posts where board_token = 'staging-example' and closed_at is null`;
      expect(posts).toBe(STAGING_POSTS.length);
    } finally {
      await db.end();
    }
  });
});
