import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Production code can reach the database before or after its migration runs (see scripts/wait-for-migrations.mjs),
// and a rollback puts old code on the new schema. So a migration must work with the code before and after it: add
// first, switch reads, remove later ("expand, then contract"). A step that breaks old code (dropping or renaming a
// table, column or enum value, changing a type, adding NOT NULL without a default, removing a default) is allowed only
// in a migration whose first line is `-- contract: <why it's safe>`, written after the code that used the old shape
// has been live.
const DIR = resolve(__dirname, "../../drizzle");

const BREAKING: [RegExp, string][] = [
  [/\bDROP\s+(TABLE|TYPE|SCHEMA|VIEW|MATERIALIZED\s+VIEW|SEQUENCE)\b/i, "drops an object"],
  [/\bDROP\s+COLUMN\b/i, "drops a column"],
  // A unique index can be the target of an onConflict clause in the code still running.
  [/\bDROP\s+INDEX\b/i, "drops an index"],
  [/\bRENAME\b/i, "renames something"],
  [/\bALTER\s+COLUMN\s+"?[\w]+"?\s+(SET\s+DATA\s+)?TYPE\b/i, "changes a column type"],
  [/\bALTER\s+COLUMN\s+"?[\w]+"?\s+SET\s+NOT\s+NULL\b/i, "makes a column required"],
  [/\bALTER\s+COLUMN\s+"?[\w]+"?\s+DROP\s+DEFAULT\b/i, "removes a default"],
];

/** `(…)` groups such as numeric(10, 2) removed, so a comma inside a type doesn't end a column definition early. */
const flatten = (s: string) => {
  let out = s;
  for (let i = 0; i < 3; i++) out = out.replace(/\([^()]*\)/g, "");
  return out;
};

/** The breaking steps in a migration's SQL, unless it is marked as a contract step. */
function breakingSteps(sql: string): string[] {
  if (/^\s*--\s*contract:\s*\S/i.test(sql)) return [];
  const statements = sql.replace(/--[^\n]*/g, "").split(/;|--> statement-breakpoint/).map((s) => s.trim()).filter(Boolean);
  // Constraints on a table created in the same migration can't break code that runs before it.
  const created = new Set(statements.flatMap((s) => [...s.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)].map((m) => m[1])));
  // So are constraints on a column added in the same migration: old code never writes it.
  const added = new Set(
    statements.flatMap((s) => {
      const table = /\bALTER\s+TABLE(?:\s+ONLY)?\s+(?:"?\w+"?\.)?"?(\w+)"?/i.exec(s)?.[1];
      return [...s.matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)].map((m) => `${table}.${m[1]}`);
    }),
  );
  const columnsOf = (s: string) => {
    const m = /\b(?:UNIQUE|FOREIGN\s+KEY|PRIMARY\s+KEY)\s*(?:NULLS\s+(?:NOT\s+)?DISTINCT\s*)?\(([^)]*)\)/i.exec(s) ?? /\bUSING\s+\w+\s*\(([^)]*)\)/i.exec(s);
    if (m) return [...m[1].matchAll(/"(\w+)"/g)].map((c) => c[1]);
    // A check names its columns as "table"."column", as drizzle writes them; an unqualified one counts as unknown.
    const check = /\bCHECK\s*\(([\s\S]*)\)/i.exec(s);
    return check ? [...check[1].matchAll(/"\w+"\."(\w+)"/g)].map((c) => c[1]) : [];
  };
  const target = (s: string) => /\b(?:ALTER\s+TABLE(?:\s+ONLY)?|\bON(?:\s+ONLY)?)\s+(?:"?\w+"?\.)?"?(\w+)"?/i.exec(s)?.[1];
  return statements.flatMap((s) => {
    const found = BREAKING.filter(([re]) => re.test(s)).map(([, why]) => why);
    const flat = flatten(s);
    for (const column of flat.split(/\bADD\s+COLUMN\b/i).slice(1)) {
      const def = column.split(",")[0];
      if (/\bNOT\s+NULL\b/i.test(def) && !/\b(DEFAULT|GENERATED|SERIAL|BIGSERIAL|SMALLSERIAL)\b/i.test(def)) found.push("adds a required column without a default");
    }
    const table = target(s);
    const cols = columnsOf(s);
    const onExisting =
      table !== undefined && !created.has(table) && !(cols.length > 0 && cols.every((c) => added.has(`${table}.${c}`)));
    if (onExisting && /\bADD\s+CONSTRAINT\b[\s\S]*\b(UNIQUE|CHECK|FOREIGN\s+KEY|PRIMARY\s+KEY|EXCLUDE)\b/i.test(s)) found.push("adds a constraint to an existing table");
    if (onExisting && /\bCREATE\s+UNIQUE\s+INDEX\b/i.test(s)) found.push("adds a unique index to an existing table");
    return found.map((why) => `${why}: ${s.slice(0, 100)}`);
  });
}

describe("breakingSteps", () => {
  it.each([
    ['ALTER TABLE "users" DROP COLUMN "phone";', "drops a column"],
    ['DROP TABLE "waitlist";', "drops an object"],
    ['ALTER TABLE "users" RENAME COLUMN "name" TO "full_name";', "renames something"],
    ['ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE integer;', "changes a column type"],
    ['ALTER TABLE "users" ALTER COLUMN "age" TYPE integer;', "changes a column type"],
    ['ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;', "makes a column required"],
    ['ALTER TABLE "users" ALTER COLUMN "state" DROP DEFAULT;', "removes a default"],
    ['ALTER TABLE "users" ADD COLUMN "state" text NOT NULL;', "adds a required column without a default"],
    ['ALTER TYPE "status" RENAME VALUE "a" TO "b";', "renames something"],
    ['ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";', "drops a column"],
    ['ALTER TABLE "items" ADD COLUMN "price" numeric(10, 2) NOT NULL;', "adds a required column without a default"],
    ['ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");', "adds a constraint to an existing table"],
    ['ALTER TABLE "users" ADD CONSTRAINT "age_check" CHECK ("age" > 0);', "adds a constraint to an existing table"],
    ['ALTER TABLE "users" ADD CONSTRAINT "users_name_length" CHECK (char_length("users"."name") <= 80);', "adds a constraint to an existing table"],
    ['ALTER TABLE "goals" ADD CONSTRAINT "goals_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");', "adds a constraint to an existing table"],
    ['CREATE UNIQUE INDEX "users_email" ON "users" USING btree ("email");', "adds a unique index to an existing table"],
    ['DROP INDEX "user_goals_skill";', "drops an index"],
  ])("flags %s", (sql, why) => {
    expect(breakingSteps(sql).join("\n")).toContain(why);
  });

  it.each([
    'ALTER TABLE "users" ADD COLUMN "state" text DEFAULT \'x\' NOT NULL;',
    'ALTER TABLE "users" ADD COLUMN "state" text NOT NULL DEFAULT \'x\';',
    'ALTER TABLE "users" ADD COLUMN "nick" text;',
    'ALTER TABLE "resumes" ALTER COLUMN "file_delete_after" DROP NOT NULL;',
    'CREATE INDEX IF NOT EXISTS "x" ON "t" ("a");',
    'ALTER TYPE "status" ADD VALUE \'c\';',
    'CREATE TABLE "t" ("id" uuid PRIMARY KEY NOT NULL, "n" text NOT NULL);',
    'ALTER TABLE "t" DROP CONSTRAINT "t_fk";',
    'ALTER TABLE "items" ADD COLUMN "price" numeric(10, 2) DEFAULT 0 NOT NULL;',
    'ALTER TABLE "items" ADD COLUMN "n" serial NOT NULL;',
    'CREATE TABLE "t" ("id" uuid PRIMARY KEY NOT NULL);\n--> statement-breakpoint\nALTER TABLE "t" ADD CONSTRAINT "t_u_fk" FOREIGN KEY ("u") REFERENCES "public"."users"("id");',
    'CREATE TABLE "t" ("id" uuid NOT NULL);\n--> statement-breakpoint\nCREATE UNIQUE INDEX "t_id" ON "t" USING btree ("id");',
    'ALTER TABLE "resumes" ADD COLUMN "consent_id" uuid;\n--> statement-breakpoint\nALTER TABLE "resumes" ADD CONSTRAINT "r_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id");',
    'ALTER TABLE "users" ADD COLUMN "bio" text;\n--> statement-breakpoint\nALTER TABLE "users" ADD CONSTRAINT "users_bio_length" CHECK (char_length("users"."bio") between 1 and 500);',
  ])("allows %s", (sql) => {
    expect(breakingSteps(sql)).toEqual([]);
  });

  it("allows a breaking step in a migration marked as a contract step", () => {
    expect(breakingSteps('-- contract: phone unused since #90\nALTER TABLE "users" DROP COLUMN "phone";')).toEqual([]);
  });
});

// Steps that were checked by hand before this test existed, with why they were safe then.
const GRANDFATHERED: Record<string, string> = {
  "0003_sign_in.sql: adds a unique index to an existing table":
    "users had no rows when sign-in was built, and code before it never inserted users",
  "0003_sign_in.sql: adds a constraint to an existing table": "users had no rows when sign-in was built",
  // Checked by hand (corporate build step 5): conversations.application_id existed from 0012 but no code wrote it before
  // 0021, so every row is null and neither the foreign key nor the unique index can refuse a write old code makes.
  "0021_company_chats.sql: adds a constraint to an existing table: ALTER TABLE \"conversations\" ADD CONSTRAINT \"conversations_application_id":
    "conversations.application_id was never written before 0021",
  "0021_company_chats.sql: adds a unique index to an existing table: CREATE UNIQUE INDEX \"conversations_application\"":
    "conversations.application_id was never written before 0021",
  // Checked by hand (My jobs PR 1): code before 0050 writes only job_post_id and stage 1-4 and never closed_at or
  // job_check_id, so none of these refuses a write it makes; (user_id, job_post_id) was the primary key until 0050.
  "0050_my_jobs.sql: adds a unique index to an existing table: CREATE UNIQUE INDEX \"job_saves_user_post\"":
    "(user_id, job_post_id) was the primary key before 0050, so existing rows are already unique",
  "0050_my_jobs.sql: adds a unique index to an existing table: CREATE UNIQUE INDEX \"job_saves_user_check\"":
    "job_saves.job_check_id is new in 0050 and null on every existing row",
  "0050_my_jobs.sql: adds a constraint to an existing table: ALTER TABLE \"job_saves\" ADD CONSTRAINT \"job_saves_stage\"":
    "widens the stage range from 1-4 to 1-6",
  "0050_my_jobs.sql: adds a constraint to an existing table: ALTER TABLE \"job_saves\" ADD CONSTRAINT \"job_saves_one_job\"":
    "old code always sets job_post_id and never job_check_id",
  "0050_my_jobs.sql: adds a constraint to an existing table: ALTER TABLE \"job_saves\" ADD CONSTRAINT \"job_saves_closed\"":
    "old code never writes closed_at, which is new in 0050",
  "0051_mock_for_a_job.sql: adds a constraint to an existing table: ALTER TABLE \"mock_sessions\" ADD CONSTRAINT \"mock_sessions_focus\"":
    "widens the focus check by 'job'; old code writes only the four it knew",
  "0056_events_cleanup.sql: adds a constraint to an existing table: ALTER TABLE \"events\" ADD CONSTRAINT \"events_place\"":
    "events is empty until the feed job (Timetable PR 4), and the Zod schema already refuses an in-person event with no city",
  // Checked by hand (Junction part 1): both checks only widen. Old code writes the six kinds it knew, each with exactly
  // the one reference it always set, and never the four reference columns new in 0059, so every row it writes passes.
  "0059_junction.sql: adds a constraint to an existing table: ALTER TABLE \"notifications\" ADD CONSTRAINT \"notifications_kind\"":
    "widens the kind check by six new kinds; old code writes only the six it knew",
  "0059_junction.sql: adds a constraint to an existing table: ALTER TABLE \"notifications\" ADD CONSTRAINT \"notifications_refs\"":
    "old kinds keep exactly their one reference; the new reference columns are null on every row old code writes",
};

describe("migrations", () => {
  it("have journal timestamps that increase in order, so drizzle never skips one", () => {
    const journal = JSON.parse(readFileSync(join(DIR, "meta/_journal.json"), "utf8")) as { entries: { idx: number; when: number }[] };
    const sorted = [...journal.entries].sort((a, b) => a.idx - b.idx);
    sorted.forEach((e, i) => {
      expect(e.idx).toBe(i);
      if (i > 0) expect(e.when).toBeGreaterThan(sorted[i - 1].when);
    });
  });

  it("only expand the schema unless marked as a contract step", () => {
    const problems = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .flatMap((f) => breakingSteps(readFileSync(join(DIR, f), "utf8")).map((p) => `${f}: ${p}`))
      .filter((p) => !Object.keys(GRANDFATHERED).some((g) => p.startsWith(g)));
    expect(problems).toEqual([]);
  });
});
