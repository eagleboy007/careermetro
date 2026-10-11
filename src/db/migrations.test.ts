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
  [/\bRENAME\b/i, "renames something"],
  [/\bALTER\s+COLUMN\s+"?[\w]+"?\s+(SET\s+DATA\s+)?TYPE\b/i, "changes a column type"],
  [/\bALTER\s+COLUMN\s+"?[\w]+"?\s+SET\s+NOT\s+NULL\b/i, "makes a column required"],
  [/\bALTER\s+COLUMN\s+"?[\w]+"?\s+DROP\s+DEFAULT\b/i, "removes a default"],
  [/\bADD\s+COLUMN\s+(?:(?!DEFAULT|GENERATED)[^;,])*\bNOT\s+NULL\b(?:(?!DEFAULT|GENERATED)[^;,])*(?:[;,]|$)/i, "adds a required column without a default"],
];

/** The breaking steps in a migration's SQL, unless it is marked as a contract step. */
function breakingSteps(sql: string): string[] {
  if (/^\s*--\s*contract:\s*\S/i.test(sql)) return [];
  const statements = sql.replace(/--[^\n]*/g, "").split(/;|--> statement-breakpoint/);
  return statements.flatMap((s) => BREAKING.filter(([re]) => re.test(s)).map(([, why]) => `${why}: ${s.trim().slice(0, 100)}`));
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
  ])("allows %s", (sql) => {
    expect(breakingSteps(sql)).toEqual([]);
  });

  it("allows a breaking step in a migration marked as a contract step", () => {
    expect(breakingSteps('-- contract: phone unused since #90\nALTER TABLE "users" DROP COLUMN "phone";')).toEqual([]);
  });
});

describe("migrations", () => {
  it("only expand the schema unless marked as a contract step", () => {
    const problems = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .flatMap((f) => breakingSteps(readFileSync(join(DIR, f), "utf8")).map((p) => `${f}: ${p}`));
    expect(problems).toEqual([]);
  });
});
