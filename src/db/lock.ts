import "server-only";
import { sql } from "drizzle-orm";
import type { getDb } from "@/db";

type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs fn in a transaction that holds a per-key advisory lock, so work for one key runs one at a time. Waits up to
 * timeoutMs for the lock, then answers "busy". Keep fn short and never call the network inside it: every waiter holds
 * a pooled connection while it waits.
 */
export async function withKeyLock<T>(db: Db, key: string, timeoutMs: number, fn: (tx: Tx) => Promise<T>): Promise<T | "busy"> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local lock_timeout = ${Math.trunc(timeoutMs)}`));
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      return fn(tx);
    });
  } catch (error) {
    // 55P03: lock_timeout passed while another holder kept the lock.
    if ((error as { cause?: { code?: string } })?.cause?.code === "55P03") return "busy";
    throw error;
  }
}

/**
 * Network's lock on a pair of people: every connection, request and block between them takes it first, so a block
 * and an accept at the same moment run one after the other (FR-49: a block ends the connection for good). A block
 * from the Inbox takes it too, before the Inbox's own lock.
 */
export const networkPairLock = (x: string, y: string, tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${["network", ...[x, y].sort()].join("|")}))`);

/**
 * The Inbox's lock on two people's direct chat. Network takes it too (after its own pair lock) whenever a connection
 * starting or ending changes that chat, so a first message can't open a chat while the connection is being removed.
 */
export const directChatLock = (a: string, b: string, tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${["inbox", ...[a, b].sort()].join("|")}))`);
