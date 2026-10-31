import "server-only";
import { eq, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { interests, userInterests } from "@/db/schema";
import { interestKey } from "@/lib/me/text";
import { LIMITS, takeShared } from "@/lib/shared-limit";

/*
 * The shared interests table (docs/plans/junction-plan.md section 1 "Interests", migration 0059). Me's free-text
 * interests and a post's tags both point at it, so Me, the Life line, Network and Junction read one list. Names follow
 * Me's rules (checked by the callers' schemas). Nothing here logs a name.
 */

type Db = ReturnType<typeof getDb>;

/**
 * The shared interest for each name, made when it is new, counting each one made against the day's new-interest limit.
 * Null when that limit is spent or a name is an interest an admin hid.
 */
export async function ensureInterests(userId: string, names: string[], tx: Tx, now: Date): Promise<string[] | null> {
  const ids: string[] = [];
  for (const name of names) {
    const key = interestKey(name);
    const [found] = await tx.select({ id: interests.id, hiddenAt: interests.hiddenAt }).from(interests).where(eq(interests.nameKey, key));
    if (found) {
      if (found.hiddenAt) return null;
      ids.push(found.id);
      continue;
    }
    if (!(await takeShared(LIMITS.junctionNewInterestsPerUserDay, userId, { db: tx, now: now.getTime() }))) return null;
    const [made] = await tx.insert(interests).values({ name, nameKey: key, createdBy: userId, createdAt: now }).onConflictDoNothing().returning({ id: interests.id });
    const id = made?.id ?? (await tx.select({ id: interests.id }).from(interests).where(eq(interests.nameKey, key)))[0]?.id;
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

/**
 * Links one of a person's interests on Me to the shared table, making the shared row when it is new (no daily limit:
 * Me's own limit and 30-interest cap already apply). Run in Me's transaction right after the row is added.
 */
export async function linkUserInterest(userId: string, name: string, tx: Tx | Db, now: Date): Promise<void> {
  const key = interestKey(name);
  await tx.insert(interests).values({ name, nameKey: key, createdBy: userId, createdAt: now }).onConflictDoNothing();
  await tx.execute(
    sql`update ${userInterests} set interest_id = (select id from ${interests} where name_key = ${key}) where user_id = ${userId} and name_key = ${key}`,
  );
}
