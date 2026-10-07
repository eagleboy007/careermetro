import "server-only";
import { getDb } from "@/db";
import { aiCalls } from "@/db/schema";

/** One model call as stored in ai_calls (AI-3, AI-6). Holds ids and counts only, never resume text. */
export type AiCallRecord = {
  purpose: string;
  model: string;
  promptVersion: string;
  inputRefs: Record<string, string>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
};

/** Stores call records and returns their ids in the same order. */
export async function recordAiCalls(records: AiCallRecord[], db = getDb()): Promise<string[]> {
  if (records.length === 0) return [];
  const rows = await db
    .insert(aiCalls)
    .values(records.map((r) => ({ ...r, costUsd: r.costUsd.toFixed(6) })))
    .returning({ id: aiCalls.id });
  return rows.map((r) => r.id);
}
