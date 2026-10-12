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
});
