import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { recordAiCalls } from "@/lib/ai/log";
import { checkHealth, checkParse, HEALTH_MODEL, SYNTHETIC_RESUME, type Health, type ParseHealth } from "@/lib/health";
import { parseResume } from "@/lib/resume/parse";

/** One real check per minute per instance at most: each costs a fraction of a cent, and the page is public. */
const CACHE_MS = 60_000;
let cached: { at: number; result: Promise<Health> } | undefined;

/** A parse can take up to 100 s (PARSE_DEADLINE_MS), as in the upload route. */
export const maxDuration = 120;

/** The parse check costs a few cents, so it runs at most once per 10 minutes per instance. A failed result stays cached for that long too. */
const PARSE_CACHE_MS = 10 * 60_000;
let parseCached: { at: number; result: Promise<ParseHealth> } | undefined;

/**
 * Used by the post-deploy smoke check and by people: is the database up, and does the Claude key work?
 * With ?check=parse it instead runs the real resume-parse request on a synthetic resume.
 */
export async function GET(request: Request) {
  await connection();
  if (new URL(request.url).searchParams.get("check") === "parse") {
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
    pingDb: async () => {
      await getDb().execute(sql`select 1`);
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
    // Logged as parse calls, so they count toward the daily upload budget: the page is public, and the budget caps what it can spend.
    await recordAiCalls(result.calls).catch(() => {});
    return result;
  });
}
