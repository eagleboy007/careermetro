# "Not for me" per goal (handoff section 6, build step 10)

Status: approved by the Project manager under Milin's delegation, 2026-10-17. Built as FR-48.

As built: goals are made only from required gaps, so no goal is "nice to have" yet and the nice-goal Remove has nothing to act on. "Not for me" sits at the foot of each pitstop on the Map (#154) and in each open goal on Today; a skipped goal stays on the line (the train passes it) and shows "Bring back" there. Today leaves skipped goals out, with no tasks for them.

## What the person sees

On each goal's menu (Map and Today), one "Not for me" action whose effect depends on the goal's level in the role:

- **Nice to have:** "Remove from my goals". The goal is skipped. The match does not change.
- **One of these** (for example Splunk, Sentinel or QRadar): "Learn another one instead" lists the other skills in the group. Picking one swaps the goal to it: the pitstops switch to that skill's resources. Proof of any skill in the group still fills it, so the match does not change.
- **Required:** shows how many of the role's live posts ask for it ("Asked for in 31 of 40 posts"; the line is left out when the role has no posts), then "Skip anyway". A skipped required goal stays a gap: the Gaps page and roles that need it stay amber.
- **Your choice:** keeps today's "Remove from my goals".

A "Skipped goals" list under the goals has "Bring back" on each one. That restores it as active, at the end of the order, with its proof kept.

"Offer another track" waits until role profiles have tracks (none do yet), so it is out of this PR.

## Data

- No migration. `user_goals.status = 'skipped'`, `skipped_at` and `swapped_to` have existed since 0004. Goal sync already leaves skipped goals alone, so a recompute never brings one back (handoff rule 9).
- A swap sets `swapped_to` to the chosen group member. Learn pitstops and the goal's label use `swapped_to ?? skill_id`. Undoing the swap clears it.
- Export: add `swappedTo` beside `skippedAt` and bump `EXPORT_VERSION` to 19.
- One route, `PATCH /api/goals/[id]` with `{action: "skip" | "swap" | "restore", skillId?}`, Zod-validated. It acts only on the caller's own goal, and a swap only to a member of that goal's group.
- No audit line (own data). Logs hold only the action and the outcome.

## Docs and tests

- FR-48 in REQUIREMENTS, a STATUS line, and a `/design` section with example goals of each level.
- Unit tests for the rules (which action each level gets, swap only within the group, restore). DB tests for skip, swap, restore and sync leaving skipped goals alone. Route tests. One e2e step: skip a nice goal and bring it back.
