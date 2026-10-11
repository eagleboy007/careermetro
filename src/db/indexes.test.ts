import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

// Runs against a real Postgres with migrations applied, like the store tests.
const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;

/**
 * Foreign keys that may go without an index. Skills, role profiles and organizations are small tables that are never
 * deleted (skill_aliases is only rewritten by the content seed, a few hundred rows). ai_calls rows are never deleted
 * today; a retention job would need these indexed first.
 */
const unindexedOk = new Set([
  "gap_analyses.ai_call_id",
  "gap_analyses.role_profile_id",
  "gap_proofs.skill_id",
  "path_steps.skill_id",
  "paths.ai_call_id",
  "profiles.ai_call_id",
    "skill_aliases.skill_id",
  "user_goals.skill_id",
  "user_goals.swapped_to",
  "users.organization_id",
]);

describe.skipIf(!sql)("database indexes", () => {
  afterAll(async () => {
    await sql!.end();
  });

  it("indexes every foreign key that is queried or cascades on delete", async () => {
    // Postgres does not index a foreign key column on its own; without one, a query by it or a cascade scans the table.
    const rows = await sql!<{ fk: string }[]>`
      select c.conrelid::regclass || '.' || a.attname as fk
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`;
    const unindexed = rows.map((r) => r.fk);
    expect(unindexed.filter((fk) => !unindexedOk.has(fk)).sort()).toEqual([]);
    // An entry that has since got an index comes off the list, so the list stays true.
    expect([...unindexedOk].filter((fk) => !unindexed.includes(fk))).toEqual([]);
  });
});
