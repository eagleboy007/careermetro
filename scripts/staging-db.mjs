// Runs before `next build` on Vercel. The staging build (docs/staging.md) brings its own database up to date: it
// applies this build's migrations and loads the role, skill and resource content, the same steps the Migrate database
// workflow runs for production. Staging always holds main's code, so these are migrations already merged; on a
// database shared with production they are already applied and nothing changes. Without this a preview database that
// nobody migrates falls behind, and every signed-in screen fails. Other builds skip it. A failure warns and lets the
// build go on (the site's /api/health then reports "schema":"behind"). It prints fixed messages and error codes only,
// never the connection string.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** True only for Vercel's build of the staging branch. */
export const isStagingBuild = (env) => env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === "staging";

/**
 * Supabase's transaction pooler (port 6543) is for the app's short queries; migrations want a session, which the same
 * pooler host gives on port 5432. Any other link is used as it is.
 */
export function sessionUrl(raw) {
  try {
    const url = new URL(raw.trim());
    if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") url.port = "5432";
    return url.toString();
  } catch {
    return raw;
  }
}

async function main() {
  if (!isStagingBuild(process.env)) return;
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.warn("staging-db: DATABASE_URL is not set for the staging build; skipping");
    return;
  }
  const url = sessionUrl(raw);
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    console.log("staging-db: migrations applied");
  } catch (error) {
    console.warn(`staging-db: migrations failed (${error?.code ?? error?.cause?.code ?? error?.name ?? "error"}); building anyway`);
    return;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
  const seed = spawnSync(process.execPath, ["scripts/seed-content.mjs"], { env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "ignore", "ignore"] });
  console.log(seed.status === 0 ? "staging-db: content loaded" : "staging-db: loading content failed; building anyway");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.warn(`staging-db: unexpected ${error?.code ?? error?.name ?? "error"}; building anyway`);
  });
}
