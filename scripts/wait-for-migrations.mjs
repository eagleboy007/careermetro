// Runs before `next build` on Vercel. A production deploy and the "Migrate database" workflow both start when main
// changes, so new code could go live before the schema it needs. In a production build this waits until the database
// has every migration in drizzle/meta/_journal.json, and fails the build if it is still behind at the time limit. A
// failed build leaves the previous deployment live, so code never runs against an older schema. If the build can't
// read the migrations table at all (no access, database down), it warns and lets the deploy go ahead, so a permissions
// difference can never block every deploy; the smoke check still runs after it. Other builds skip the check. It
// prints fixed messages and error codes only, never the connection string.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

/** The newest migration's timestamp in the journal; drizzle stores it as created_at when it applies the migration. */
export function latestMigration(journal) {
  const entries = journal?.entries ?? [];
  return entries.reduce((max, e) => Math.max(max, Number(e.when) || 0), 0);
}

/** True when the database has applied the newest migration (or the journal has none). */
export const isCurrent = (latest, applied) => latest === 0 || (applied !== null && applied >= latest);

/**
 * Asks until the database is current or time runs out. Returns "current", "behind" (it read an older migration), or
 * "error" (it never read the table: three non-missing-table errors, or the table still missing at the deadline).
 */
export async function waitForMigrations({ latest, readApplied, timeoutMs, intervalMs, sleep, now = Date.now, log = console.log }) {
  const deadline = now() + timeoutMs;
  let errors = 0;
  let missing = false;
  for (;;) {
    let applied;
    try {
      applied = await readApplied();
    } catch (error) {
      errors++;
      log(`wait-for-migrations: could not read the migrations table (${error?.code ?? error?.name ?? "error"})`);
      // A missing table means no migration has run yet: keep waiting. Anything else gets a few more tries.
      if (error?.code !== "42P01" && errors >= 3) return "error";
      missing = error?.code === "42P01";
      applied = null;
    }
    if (isCurrent(latest, applied)) return "current";
    if (now() >= deadline) return missing ? "error" : "behind";
    log("wait-for-migrations: the database is behind this build's migrations; waiting for the Migrate database workflow");
    await sleep(intervalMs);
  }
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") return;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("wait-for-migrations: DATABASE_URL is not set for this production build");
    process.exit(1);
  }
  const latest = latestMigration(JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")));
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
  try {
    const result = await waitForMigrations({
      latest,
      readApplied: async () => {
        const [row] = await sql`select max(created_at)::bigint as applied from drizzle.__drizzle_migrations`;
        return row?.applied == null ? null : Number(row.applied);
      },
      timeoutMs: Number(process.env.MIGRATION_WAIT_MS ?? 10 * 60_000),
      intervalMs: 10_000,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    if (result === "current") {
      console.log("wait-for-migrations: the database has every migration in this build");
      return;
    }
    if (result === "error") {
      console.warn("wait-for-migrations: could not read the migrations table; deploying without the check");
      return;
    }
    console.error(
      "wait-for-migrations: the database is still missing migrations; failing so the previous deployment stays live. Check the Migrate database workflow.",
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
