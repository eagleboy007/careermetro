import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { CLEANUP_BATCH, CLEANUP_MAX_BATCHES, OFFERED_TIMES_KEEP_DAYS } from "@/lib/schemas/constants";
import { COMPANY_ACCESS_DAYS } from "./applications-store";

/*
 * The employer side's part of the daily clean-up (dev/corporate-plan.md build step 7), run by /api/cron/cleanup. Every
 * cutoff here is already enforced on each read and write (steps 4 to 6), so these jobs never decide who may see
 * what: they only record what has already ended and delete or erase the data the rules say goes. None of them can
 * widen access. Each works in batches of CLEANUP_BATCH rows, at most CLEANUP_MAX_BATCHES a run, so a backlog is worked
 * off over several days instead of one unbounded statement; running twice changes nothing more. Counts only come back.
 */

type Db = ReturnType<typeof getDb>;
const DAY = 86_400_000;

/**
 * `only` limits a run to one company. The daily route never passes it; tests do, so a run there can't touch the rows
 * other test files are using in the same database at the same time.
 */
type Only = { orgId: string } | undefined;
const inOrg = (only: Only) => (only ? sql`and a.org_id = ${only.orgId}` : sql``);

/** Runs `step` until a batch comes back short or the run's cap is reached; the total. */
async function inBatches(step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < CLEANUP_MAX_BATCHES; i++) {
    const n = await step();
    total += n;
    if (n < CLEANUP_BATCH) break;
  }
  return total;
}

/**
 * The 180-day access end: applications closed 180 days ago or more get `company_access_ends_at` (the day the access
 * ended), and the company-side read marks on their chats go. Reads already refuse these applications; a reopen can't
 * happen, because moving an application needs the company to see it.
 */
export async function endCompanyAccess(db: Db = getDb(), now = new Date(), only?: Only): Promise<{ accessEnded: number; readMarksCleared: number }> {
  const cutoff = new Date(now.getTime() - COMPANY_ACCESS_DAYS * DAY);
  let readMarksCleared = 0;
  const accessEnded = await inBatches(() =>
    db.transaction(async (tx) => {
      const ended = await tx.execute<{ id: string }>(sql`
        update applications set company_access_ends_at = closed_at + make_interval(days => ${COMPANY_ACCESS_DAYS})
        where id in (
          select a.id from applications a
          where a.closed_at is not null and a.closed_at <= ${cutoff.toISOString()}::timestamptz and a.company_access_ends_at is null ${inOrg(only)}
          order by a.closed_at limit ${CLEANUP_BATCH} for update skip locked)
        returning id`);
      const ids = [...ended].map((r) => r.id);
      if (ids.length) {
        const cleared = await tx.execute<{ conversation_id: string }>(sql`
          delete from conversation_members where role <> 'member'
            and conversation_id in (select id from conversations where application_id in ${ids})
          returning conversation_id`);
        readMarksCleared += [...cleared].length;
      }
      return ids.length;
    }),
  );
  return { accessEnded, readMarksCleared };
}

/**
 * Phones shared for an interview are shown only while the application is open (step 6), so once it has closed (Not
 * this time, or withdrawn) the number is erased, as "Stop sharing" does. Reopening it later doesn't bring it back; the
 * candidate can share again when accepting the next interview.
 */
export async function eraseClosedPhones(db: Db = getDb(), only?: Only): Promise<number> {
  return inBatches(() =>
    db.transaction(async (tx) => {
      const erased = await tx.execute<{ id: string }>(sql`
        update applications set phone_shared = null
        where id in (
          select a.id from applications a where a.closed_at is not null and a.phone_shared is not null ${inOrg(only)}
          limit ${CLEANUP_BATCH} for update skip locked)
        returning id`);
      const ids = [...erased].map((r) => r.id);
      if (ids.length) await tx.execute(sql`update interviews set phone_shared = false where phone_shared and application_id in ${ids}`);
      return ids.length;
    }),
  );
}

/**
 * Stale "Ask for times": offered times are only of use until they pass, and an unanswered ask stops waiting once its
 * days have gone (both read from the clock in step 6). So offered times that passed more than a week ago without
 * being booked are deleted. Their ask is marked answered first, so the chat still reads as answered without them.
 * Times an interview was booked on stay with that interview.
 */
export async function clearPastOfferedTimes(db: Db = getDb(), now = new Date(), only?: Only): Promise<number> {
  const before = new Date(now.getTime() - OFFERED_TIMES_KEEP_DAYS * DAY);
  return inBatches(() =>
    db.transaction(async (tx) => {
      const picked = await tx.execute<{ id: string; ask_message_id: string | null }>(sql`
        select s.id, s.ask_message_id from candidate_slots s join applications a on a.id = s.application_id
        where s.starts_at < ${before.toISOString()}::timestamptz ${inOrg(only)}
          and not exists (select 1 from interviews i where i.slot_id = s.id)
        limit ${CLEANUP_BATCH} for update of s skip locked`);
      const rows = [...picked];
      if (!rows.length) return 0;
      const asks = [...new Set(rows.map((r) => r.ask_message_id).filter((id): id is string => !!id))];
      if (asks.length) {
        await tx.execute(sql`
          update messages set payload = coalesce(payload, '{}'::jsonb) || '{"answered": true}'::jsonb
          where kind = 'ask_times' and id in ${asks}`);
      }
      const gone = await tx.execute<{ id: string }>(sql`
        delete from candidate_slots s where s.id in ${rows.map((r) => r.id)}
          and not exists (select 1 from interviews i where i.slot_id = s.id)
        returning s.id`);
      return [...gone].length;
    }),
  );
}
