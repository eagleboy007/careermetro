import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { publicTablesWithoutRls } from "../../scripts/check-rls.mjs";

// The app reaches Postgres from the server only. Supabase's REST API serves every table in the public schema to
// anyone holding the project's anon key unless row level security is on, so every public table must have it (no
// policies: nothing gets through the API, and the server's table-owner role is not affected).
const DIR = resolve(__dirname, "../../drizzle");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => readFileSync(resolve(DIR, f), "utf8")).join("\n");

const names = (re: RegExp) => new Set([...all.matchAll(re)].map((m) => m[1]));

describe("row level security in the migrations", () => {
  it("is turned on for every table a migration creates in the public schema", () => {
    const created = names(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"public"\.)?"(\w+)"\s*\(/gi);
    const dropped = names(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"public"\.)?"(\w+)"/gi);
    const secured = names(/\bALTER\s+TABLE\s+(?:"public"\.)?"(\w+)"\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi);
    const missing = [...created].filter((t) => !dropped.has(t) && !secured.has(t));
    expect(missing).toEqual([]);
    expect(created.size).toBeGreaterThan(20);
  });

  it("is never turned off", () => {
    expect(all).not.toMatch(/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i);
  });

  it("has no policies, so the API's anon and authenticated roles can read and write nothing", () => {
    // The pattern since #112: row level security on, no policies. A policy would open rows to the anon key.
    expect(all).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(all).not.toMatch(/\bGRANT\b[^;]*\bTO\s+"?(anon|authenticated|public)\b/i);
  });

  it("covers the tables the v44 migrations added (0040 to 0043, launch-readiness pass)", () => {
    const created = names(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"public"\.)?"(\w+)"\s*\(/gi);
    const secured = names(/\bALTER\s+TABLE\s+(?:"public"\.)?"(\w+)"\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi);
    const v44 = [
      "job_posts",
      "job_saves",
      "job_feed_runs",
      "user_resources",
      "resource_reports",
      "resource_suggestions",
      "me_roles",
      "me_education",
      "stories",
      "story_boxes",
      "user_interests",
      "notifications",
    ];
    for (const table of v44) {
      expect(created.has(table), table).toBe(true);
      expect(secured.has(table), table).toBe(true);
    }
  });
});

const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;

describe.skipIf(!sql)("row level security in the database", () => {
  afterAll(async () => {
    await sql!.end();
  });

  it("is on for every table in the public schema once the migrations have run", async () => {
    expect(await publicTablesWithoutRls(sql!)).toEqual([]);
  });

  it("has no policies on any table in the public schema", async () => {
    const rows = await sql!<{ name: string }[]>`select tablename || '.' || policyname as name from pg_policies where schemaname = 'public' order by 1`;
    expect(rows.map((r) => r.name)).toEqual([]);
  });
});
