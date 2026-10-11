import "server-only";
import { and, count, eq, gte, inArray, isNotNull, sql, sum, type SQL } from "drizzle-orm";
import type { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { aiCalls } from "@/db/schema";
import { errorFields, logEvent } from "@/lib/log";
import { recordAiCalls, type AiCallRecord } from "./log";

type Db = ReturnType<typeof getDb>;

/** A reservation still "reserved" after this long belongs to a request that died; its estimate stops counting. */
export const RESERVATION_MINUTES = 10;

const startOfUtcDay = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

/**
 * What one purpose has used today: its spend, with each call still running counted at `inFlightUsd`, and how many
 * calls `mine` reserved. Call inside the reserving transaction, under the purpose's lock, so parallel requests see
 * each other's reservations. `mine` picks this owner's rows from input_refs (see reserveCall).
 */
export async function usedToday(tx: Tx, purpose: string, inFlightUsd: number, mine: SQL): Promise<{ usd: number; mine: number }> {
  const today = and(eq(aiCalls.purpose, purpose), gte(aiCalls.createdAt, startOfUtcDay()));
  const running = new Date(Date.now() - RESERVATION_MINUTES * 60_000);
  const [[spent], [inFlight], [own]] = await Promise.all([
    tx.select({ usd: sum(aiCalls.costUsd) }).from(aiCalls).where(today),
    tx.select({ n: count() }).from(aiCalls).where(and(today, eq(aiCalls.status, "reserved"), gte(aiCalls.createdAt, running))),
    tx.select({ n: count() }).from(aiCalls).where(and(today, isNotNull(aiCalls.status), mine)),
  ]);
  return { usd: Number(spent.usd ?? 0) + inFlight.n * inFlightUsd, mine: own.n };
}

/** input_refs->>key is one of the ids `ids` selects (as text); for counting one owner's reserved calls. */
export const refIn = (key: string, ids: Parameters<typeof inArray>[1]) => inArray(sql`${aiCalls.inputRefs}->>${key}`, ids);

/** Inserts the row for a call about to run. It counts toward the limits from now on; settleCall fills in the numbers. */
export async function reserveCall(
  tx: Tx,
  call: Pick<AiCallRecord, "purpose" | "model" | "promptVersion" | "inputRefs">,
): Promise<string> {
  const [row] = await tx
    .insert(aiCalls)
    .values({ ...call, inputTokens: 0, outputTokens: 0, costUsd: "0", latencyMs: 0, ok: false, status: "reserved" })
    .returning({ id: aiCalls.id });
  return row.id;
}

/**
 * Writes what the call cost into its reserved row: the last attempt's numbers there (it is the one whose answer is
 * used) and any earlier attempt as a row of its own, so every attempt's cost counts. No attempt at all leaves a done,
 * failed row. Never throws: the answer is still shown, and a row it couldn't settle stops counting after
 * RESERVATION_MINUTES. Returns the id to link the stored result to, or null when no attempt was made.
 */
export async function settleCall(db: Db | Tx, reservedId: string, calls: AiCallRecord[]): Promise<string | null> {
  const last = calls.at(-1);
  try {
    if (calls.length > 1) await recordAiCalls(calls.slice(0, -1), db);
    await db
      .update(aiCalls)
      .set(
        last
          ? {
              model: last.model,
              inputTokens: last.inputTokens,
              outputTokens: last.outputTokens,
              costUsd: last.costUsd.toFixed(6),
              latencyMs: last.latencyMs,
              ok: last.ok,
              status: "done",
            }
          : { status: "done" },
      )
      .where(eq(aiCalls.id, reservedId));
  } catch (error) {
    logEvent("error", "ai_call_settle_failed", { purpose: last?.purpose ?? "unknown", ...errorFields(error) });
  }
  return last ? reservedId : null;
}
