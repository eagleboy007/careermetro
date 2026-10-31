// Removes everything scripts/scale/seed.mjs wrote, and nothing else (docs/scale-check.md): the members (found by their
// reserved scale-<n>@example.invalid.test emails) with all that goes with an account, their chats, the seeded feed
// posts, Timetable events and the one feed run. Local databases only. Counts only in the output.
//
//   DATABASE_URL=postgres://... node scripts/scale/cleanup.mjs
//
// Also exported for the seed, which starts from nothing so it can run twice.
import postgres from "postgres";
import { assertLocalDatabase, BOARD_LIKE, EVENT_LIKE, FEED_RUN_ID, MEMBER_LIKE } from "./common.mjs";

/**
 * Chats first: a chat's started_by is only set null when its starter goes, so the chats themselves would stay behind.
 * Then the members (every owned table goes with the account, on delete cascade), the posts (their saves go with them),
 * the events (their topics and marks go with them) and the feed run. Returns the counts.
 */
export async function cleanScale(sql) {
  return sql.begin(async (tx) => {
    const chats = await tx`
      delete from conversations where id in (
        select m.conversation_id from conversation_members m join users u on u.id = m.user_id where u.email like ${MEMBER_LIKE}
      ) returning id`;
    const members = await tx`delete from users where email like ${MEMBER_LIKE} returning id`;
    // Consents keep the email when they have no account; the seed writes none of those, but leave none behind.
    await tx`delete from consents where user_id is null and email like ${MEMBER_LIKE}`;
    const posts = await tx`delete from job_posts where board_token like ${BOARD_LIKE} returning id`;
    const events = await tx`delete from events where source = 'feed' and source_key like ${EVENT_LIKE} returning id`;
    const runs = await tx`delete from job_feed_runs where id = ${FEED_RUN_ID} returning id`;
    return { members: members.length, chats: chats.length, posts: posts.length, events: events.length, feedRuns: runs.length };
  });
}

/** What is left of the seed: all zero after a clean. */
export async function leftOver(sql) {
  const [row] = await sql`
    select
      (select count(*) from users where email like ${MEMBER_LIKE})::int as members,
      (select count(*) from job_posts where board_token like ${BOARD_LIKE})::int as posts,
      (select count(*) from events where source = 'feed' and source_key like ${EVENT_LIKE})::int as events,
      (select count(*) from job_feed_runs where id = ${FEED_RUN_ID})::int as feed_runs`;
  return row;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  assertLocalDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const started = Date.now();
    const removed = await cleanScale(sql);
    const left = await leftOver(sql);
    console.log(`scale cleanup: removed ${JSON.stringify(removed)} in ${((Date.now() - started) / 1000).toFixed(1)} s; left ${JSON.stringify(left)}`);
    if (Object.values(left).some((n) => n > 0)) {
      console.log("::error title=scale cleanup::seed rows are left after the cleanup");
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}
