# Certificate pass year and expiry (plan, 2026-10-10)

Milin's decision (Testing thread, 2026-10-10 19:17Z): keep each certificate's year, add an expiry field, and let the
user mark expiry "not applicable" for certificates that never expire.

## What changes

1. **Profile schema** (`src/lib/schemas/profile.ts`). `certifications` becomes a list of objects:
   `{ name, earned: "YYYY" | "YYYY-MM" | null, expires: "YYYY" | "YYYY-MM" | "none" | null }`.
   `null` = not stated. `"none"` = does not expire (the user's "not applicable" tick, or the resume says lifetime).
   No migration: profiles are JSON. Old rows hold plain strings and are upgraded on read
   (`{ name, earned: null, expires: null }`), so nothing breaks and the next save writes the new shape.
2. **Parse prompt v2** (`prompts/parse-resume/v2.md`). Same as v1, plus: copy the pass year/month and the expiry
   year/month when the resume states them; never guess. `ai_calls.prompt_version` logs `parse-resume/v2`.
3. **Verification** (AI-5). A certificate whose name is not in the resume is dropped (as today). A pass or expiry
   date whose year is not in the resume text is cleared, so the model can't invent dates.
4. **Profile editor**. Each certificate row gets "Passed" and "Expires" fields (YYYY or YYYY-MM) and a
   "Doesn't expire" tick that sets `"none"`. Dates are checked like job dates before saving.
5. **Gap matcher** (matcher/v6). The pass date comes from the `earned` field when set, else from the name text as
   today. A pass date in the future is a plan and counts for nothing. A certificate past its expiry shows its skills
   as weak only, never met. Unchanged rule: a certificate only makes a goal met from the resume, never proved;
   only accepted proof (gap_proofs) fills a goal. Older analyses carry over when the reading is the same.

## Not in this change

Showing pass years on the life line and profile page (follow-up), Credly verification (pending item), reminders
before a certificate expires.
