import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import journal from "../../../../drizzle/meta/_journal.json";
import { recordAiCalls } from "@/lib/ai/log";
import { checkHealth, checkParse, deployEnv, HEALTH_MODEL, missingSecrets, SYNTHETIC_RESUME, type Health, type ParseHealth } from "@/lib/health";
import { parseResume } from "@/lib/resume/parse";
import { hasBearer } from "@/lib/secret";

/** One real check per minute per instance at most: each costs a fraction of a cent, and the page is public. */
const CACHE_MS = 60_000;
let cached: { at: number; result: Promise<Health> } | undefined;

/** The market read's statement limit (checkHealth's own MARKET_CHECK_MS is a little longer), and its lock limit, lower so a lock wait fails as one (55P03). */
const MARKET_STATEMENT_MS = 3000;
const MARKET_LOCK_MS = 2000;

/** A parse can take up to 100 s (PARSE_DEADLINE_MS), as in the upload route. */
export const maxDuration = 120;

/** The parse check costs a few cents, so it runs at most once per 10 minutes per instance. A failed result stays cached for that long too. */
const PARSE_CACHE_MS = 10 * 60_000;
let parseCached: { at: number; result: Promise<ParseHealth> } | undefined;

/**
 * Used by the post-deploy smoke check and by people: is the database up, and does the Claude key work?
 * With ?check=parse it instead runs the real resume-parse request on a synthetic resume. That costs a few cents
 * from the daily upload budget, so it needs the cron secret as a bearer token; the smoke workflow sends it.
 */
export async function GET(request: Request) {
  await connection();
  if (new URL(request.url).searchParams.get("check") === "parse") {
    if (!hasBearer(request, process.env.CRON_SECRET)) {
      return Response.json({ ok: false, error: "The parse check needs the cron secret." }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    if (!parseCached || Date.now() - parseCached.at > PARSE_CACHE_MS) {
      parseCached = { at: Date.now(), result: runParseCheck() };
    }
    const parse = await parseCached.result;
    return Response.json(parse, { status: parse.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  }
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), result: runCheck() };
  }
  const health = await cached.result;
  return Response.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}

function runCheck(): Promise<Health> {
  return checkHealth({
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    missingSecrets: missingSecrets(),
    env: deployEnv(),
    pingDb: async () => {
      await getDb().execute(sql`select 1`);
    },
    countMigrations: async () => {
      const [row] = await getDb().execute<{ applied: number }>(sql`select count(*)::int as applied from drizzle.__drizzle_migrations`);
      return { applied: row?.applied ?? 0, expected: journal.entries.length };
    },
    // T122: the one table only /market reads. Its own read-only transaction, so SET LOCAL holds through the transaction
    // pooler; a lock wait fails in 2 s (55P03) and a stuck read in 3 s (57014), and health says "timeout" instead of waiting.
    readMarket: async () => {
      await getDb().transaction(
        async (tx) => {
          await tx.execute(sql.raw(`set local statement_timeout = ${MARKET_STATEMENT_MS}`));
          await tx.execute(sql.raw(`set local lock_timeout = ${MARKET_LOCK_MS}`));
          await tx.execute(sql`select 1 from market_openings_monthly limit 1`);
        },
        { accessMode: "read only" },
      );
    },
    pingClaude: async () => {
      const client = new Anthropic({ timeout: 15_000, maxRetries: 0 });
      // The same request shape as the parse call, so the ping also proves access to the fallback beta.
      const response = await client.beta.messages.create({
        model: HEALTH_MODEL,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with OK." }],
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      return { model: response.model, usage: response.usage };
    },
    record: async (call) => {
      await recordAiCalls([call]);
    },
  });
}

function runParseCheck(): Promise<ParseHealth> {
  return checkParse(async () => {
    const result = await parseResume(SYNTHETIC_RESUME, { check: "synthetic" });
    // Logged as parse calls, so they count toward the daily upload budget like any other parse.
    await recordAiCalls(result.calls).catch(() => {});
    return result;
  });
}
