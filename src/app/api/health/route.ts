import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { recordAiCalls } from "@/lib/ai/log";
import { checkHealth, HEALTH_MODEL, type Health } from "@/lib/health";

/** One real check per minute per instance at most: each costs a fraction of a cent, and the page is public. */
const CACHE_MS = 60_000;
let cached: { at: number; result: Promise<Health> } | undefined;

/** Used by the post-deploy smoke check and by people: is the database up, and does the Claude key work? */
export async function GET() {
  await connection();
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
