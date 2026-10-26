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

/**
 * Synthetic feed posts for staging (T124): staging's database never gets the daily feed, so without these no browser
 * check renders a real Departures or Today board row. Three open posts on a made-up board, one with the longest title
 * the feed stores (160 characters), kept open on every build. A feed run row is added only when none finished in the
 * last day, so the header reads "Updated". Example companies and example.com links only.
 */
export const STAGING_POSTS = [
  { id: "staging-1", title: "Data analyst (staging example)", company: "Example Labs", city: "Mumbai", role: "data-analyst", required: ["sql", "excel", "statistics"] },
  { id: "staging-2", title: "Cloud engineer (staging example)", company: "Example Cloud", city: "Pune", role: "cloud-engineer", required: ["aws", "linux", "terraform", "docker"] },
  {
    id: "staging-3",
    title: "Senior DevOps engineer, platform reliability, Kubernetes and Terraform on AWS, for the payments and lending products team (staging example of a long title)".padEnd(160, "."),
    company: "Example Fintech",
    city: "Remote",
    role: "devops-engineer",
    required: ["kubernetes", "terraform", "aws", "ci-cd"],
  },
];

export async function seedStagingPosts(sql) {
  for (const post of STAGING_POSTS) {
    await sql`
      insert into job_posts (ats, board_token, external_id, url, title, company, city, experience_note, role_slug, required_skill_ids, posted_at)
      values ('greenhouse', 'staging-example', ${post.id}, ${`https://example.com/jobs/${post.id}`}, ${post.title}, ${post.company}, ${post.city},
        '2 to 4 years', ${post.role}, ${post.required}::text[], now())
      on conflict (ats, board_token, external_id) do update set title = excluded.title, closed_at = null, last_seen_at = now()`;
  }
  const [recent] = await sql`select 1 from job_feed_runs where finished_at > now() - interval '1 day' limit 1`;
  if (!recent) await sql`insert into job_feed_runs (started_at, finished_at, boards_ok, posts_open) values (now(), now(), 1, ${STAGING_POSTS.length})`;
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
  const posts = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await seedStagingPosts(posts);
    console.log("staging-db: example feed posts in place");
  } catch (error) {
    console.warn(`staging-db: example feed posts failed (${error?.code ?? error?.name ?? "error"}); building anyway`);
  } finally {
    await posts.end({ timeout: 5 }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.warn(`staging-db: unexpected ${error?.code ?? error?.name ?? "error"}; building anyway`);
  });
}
