import "server-only";
import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { applications, candidateSlots, companyBlocks, conversationMembers, conversations, interviews } from "@/db/schema";

/*
 * A person blocking a whole company (pending item 19, dev/companies-find-me-plan.md). Kept apart from the find store so
 * the Inbox can use it without importing the company side.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Blocks a company: it never finds the person again, can't open their profile, and every chat with it (found chats and
 * the chats of the person's applications to it) closes for good and leaves the person's Inbox. Silent: the company is
 * not told. A request still waiting stays "Waiting" for the company, exactly as a deleted one does; any other chat reads
 * as closed, as an application chat does when blocked from inside it. The company's other ways in go too: a phone
 * shared with it is erased (as Stop sharing does) and offered times it hasn't booked are taken back, so it can't
 * message, ask for times or book an interview (Testing T37). The applications themselves go on, so the person still
 * follows them on Arrivals and can withdraw. Run inside the caller's transaction.
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
    .where(and(eq(conversations.orgId, orgId), inArray(conversations.kind, ["found", "application"])));
  await tx
    .update(conversations)
    .set({ status: "closed" })
    .where(and(inArray(conversations.id, chats), eq(conversations.status, "open")));
  await tx
    .update(conversationMembers)
    .set({ hiddenAt: now })
    .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, chats)));
  const mine = and(eq(applications.userId, userId), eq(applications.orgId, orgId));
  const apps = tx.select({ id: applications.id }).from(applications).where(mine);
  await tx.update(applications).set({ phoneShared: null }).where(and(mine, isNotNull(applications.phoneShared)));
  await tx.update(interviews).set({ phoneShared: false }).where(and(inArray(interviews.applicationId, apps), eq(interviews.phoneShared, true)));
  await tx
    .delete(candidateSlots)
    .where(
      and(
        inArray(candidateSlots.applicationId, apps),
        gt(candidateSlots.startsAt, now),
        sql`not exists (select 1 from ${interviews} i where i.slot_id = ${candidateSlots.id})`,
      ),
    );
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
