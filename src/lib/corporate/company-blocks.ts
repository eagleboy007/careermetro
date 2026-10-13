import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import { companyBlocks, conversationMembers, conversations } from "@/db/schema";

/*
 * A person blocking a whole company (pending item 19, dev/companies-find-me-plan.md). Kept apart from the find store so
 * the Inbox can use it without importing the company side.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Blocks a company: it never finds the person again, can't open their profile, and any found chat with it closes for
 * good and leaves the person's Inbox. Silent: the company is not told. Run inside the caller's transaction.
 */
export async function blockCompanyIn(tx: Db | Tx, userId: string, orgId: string, now: Date): Promise<void> {
  await tx.insert(companyBlocks).values({ userId, orgId, createdAt: now }).onConflictDoNothing();
  const chats = tx
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, userId), eq(conversationMembers.role, "member")),
    )
    .where(and(eq(conversations.orgId, orgId), eq(conversations.kind, "found")));
  await tx.update(conversations).set({ status: "closed" }).where(inArray(conversations.id, chats));
  await tx
    .update(conversationMembers)
    .set({ hiddenAt: now })
    .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, chats)));
}

/** Whether the person has blocked this company. */
export async function companyBlocked(userId: string, orgId: string, db: Pick<Db, "select"> | Tx): Promise<boolean> {
  const [row] = await db
    .select({ at: companyBlocks.createdAt })
    .from(companyBlocks)
    .where(and(eq(companyBlocks.userId, userId), eq(companyBlocks.orgId, orgId)))
    .limit(1);
  return !!row;
}
