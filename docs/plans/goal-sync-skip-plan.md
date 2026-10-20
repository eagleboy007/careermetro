# Goal sync: skip it when nothing would change (2026-10-20)

The biggest win left by `docs/plans/perf-pass.md`. `syncGoals` (`src/lib/goals/store.ts`) runs a write transaction
with the person's advisory lock on every Today and Map view, about 7 round trips one after another, even when it then
writes nothing. Me, Arrivals and Market (through `mapLineFor`), the Library (through `rideGoalsFor`) and sign-in (`syncCurrentGoals`) sync the same way, so they gain too; a view that does write, such as the first sync after sign-in, pays the read-only check's few round trips on top. No migration, no export change, no new column.

## What syncGoals reads and writes

Inputs passed in: the analysis (`id`, and `result.gaps` / `result.metSkillIds`, which is the tracked result when a
track is chosen, so the same id can carry a different result) and `members` (the "one of these" groups, from content).
Module constants: `knownSkill` and `implies` from the skill taxonomy in `src/content`.

Reads, inside one READ COMMITTED transaction after `pg_advisory_xact_lock(cm-goals:<user>)`:
1. that the analysis belongs to the person (`gap_analyses` → `profiles` → `resumes.user_id`); if not, returns `[]`;
2. the person's goals (`user_goals`: skill, source, status, position, group);
3. skills with current accepted proof and skills with only expired accepted proof (`gap_proofs`, against
   `indiaToday()`, the clock);
4. after any writes, the goals again with the job check's company (`readGoals`);
5. this analysis's path steps with no goal yet (`path_steps` joined to `paths` by `gap_analysis_id`).

Writes: inserts goals for new gaps (`on conflict do nothing`), updates status / `met_at` / group / skill of existing
gap goals (`planGoalSync`), and sets `path_steps.goal_id` on unlinked steps whose skill has a goal. Returns the goals
with `proved` worked out from step 3.

## What can change its output

Everything it depends on is read fresh, or passed in, on every call:
- the analysis id and its result: a new resume or analysis, the matcher version (a new analysis row), the track
  choice (a different `result` under the same id);
- the goal rows: skip, restore and swap (`changeGoal`), "Your choice" goals (`src/lib/jobs/store.ts`,
  `removeChoiceGoal`), and every proof writer's `refreshGoals`;
- proof: `setProofStatus`, `holdProofs`, `submitCertificate`, the Credly check, `deleteProof`, the admin review, and
  the clock passing a proof's expiry date (no row changes at all);
- path steps: a path built or rebuilt for the analysis after the goals were made (`src/lib/path/store.ts`);
- the taxonomy (`implies`, known skills) and the groups (`members`): content shipped with a deploy.

A stored fingerprint would have to cover all of these. The clock and content changes have no row to hang it on, and
every writer above (about ten, in five files) would have to clear it; one missed writer shows a stale goal. Comparing
the analysis id and an `updated_at` misses the track choice, proof, skips and the clock. So nothing is stored.

## The skip rule

Do the same reads first, read-only, and skip the write transaction when the plan they give is empty:

1. One `repeatable read, read only` transaction, no lock: the ownership check, `readGoals`, proved skills, expired
   skills and the unlinked steps, all in parallel on its connection.
2. Not the person's analysis → `[]`, as before.
3. `planGoalSync` over those rows gives no insert and no update, and no unlinked step has a skill that a goal has →
   return `withProved(goals, proved)`. This is exactly what the write path would return from the same rows, since
   with an empty plan it writes nothing and reads the same goals.
4. Otherwise run the existing write transaction unchanged: lock, read again, plan again, write.

The test is the sync's own rule over the current rows, so it cannot go stale: there is no cached state to fall behind
a writer, a deploy or the clock. Repeatable read gives the five reads one snapshot, so a view never mixes a goal read
before a proof change with proof read after it (that mix could show a goal met with no proof in a state that never
existed). Every writer commits in one transaction (goal and proof writers under the person's lock, the path builder
on its own), so the snapshot is always some whole state between writers. A read-only transaction never fails to serialize.

Cost: no change, about 4 round trips in turn (begin, set transaction, the five reads together, commit), no lock wait
and no writes, against about 7 now plus waiting on the lock. A change costs the 4 more once; the next view skips.
One statement with CTEs could make it 1 round trip; left for later, as it duplicates the Drizzle queries in raw SQL.

## Concurrent views

- Two views with nothing to change both skip; neither waits on the other.
- Two views that both see a change both go to the write transaction; the lock runs them one at a time and the second
  re-reads and re-plans under the lock, so it writes nothing (as today: "two visits at once make the same goals once").
- A view during a proof check or "Not for me": its snapshot is either before or after that writer's commit, never
  between, the same choice the lock makes now. If it is before and the writer leaves work for the sync (Restore leaves
  a goal active for the sync to mark met), the next view sees it and writes.

## Tests (`src/lib/goals/store.test.ts`, DB)

- A second view with nothing changed writes nothing: the `xmin` of the person's goals and of the path's steps is the
  same before and after, and the view finishes while another connection holds the person's lock (it takes no lock).
- Each input change still syncs: a new analysis; a track's result under the same id; Restore of a skipped goal whose
  skill is proved; accepted proof written without `refreshGoals`; a proof's expiry passing (clock moved a day with
  fake `Date`); a goal row changed behind the sync's back; a path built after the goals; a new group in `members`.
- The existing race test (five views and a rejection at once) still holds.
