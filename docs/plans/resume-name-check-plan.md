# Resume name check before a resume joins an account (plan, 2026-10-10)

Milin's decision (Testing thread, 2026-10-10 19:17Z): don't ask "Is this your resume?". Check the resume's first and
last name against the name on the account before the resume joins it.

## How it works

1. **Read the name at upload.** The parse call (prompt v3) also returns the person's name as printed at the top of
   the resume. The name is never saved as text. We keep only keyed hashes (HMAC with a server secret) of each name
   word, lowercased with accents and full stops removed, in a new column `resumes.name_hashes` (text array, nullable).
   It is null when the resume shows no name.
2. **Check at claim.** When an anonymous upload would move into an account (sign-in or sign-up), we hash the
   account's first and last name words the same way. The resume moves only when both words are among the resume's
   name hashes. Word order and middle names don't matter ("Sharma Riya Kumari" matches "Riya Sharma").
3. **When it doesn't match,** the resume is not moved. It stays anonymous and is deleted after its 24 hours, like any
   unclaimed upload. The person sees one line: "This resume shows a different name from your account, so we didn't
   add it. Upload your own resume, or fix the name on your account." Nothing is shown about whose name it was.
4. **Signed-in uploads** get the same check. If the name doesn't match, the analysis still shows but isn't saved to
   the account (the same line as above).

## Defaults picked (say if you want otherwise)

- **No name on the account** (the name is optional at sign-up): the name becomes required at sign-up, and
  existing accounts without a name are asked for one before their next upload joins the account.
- **No name found on the resume**: the resume joins the account. There is nothing to compare, and blocking would
  stop real users whose template hides the name in a header image.
- **Initials** ("R. Sharma"): only full words count, so an initial alone doesn't match. The person can write their
  name on the account the way the resume prints it.

## Data model and privacy

- New nullable column `resumes.name_hashes text[]`. Migration only, no backfill: older resumes have no hashes and are
  treated as "no name found".
- The name text never reaches logs, analytics, the profile or the database. The HMAC key is the existing server
  secret, so the hashes can't be reversed without it.
- Prompt version is logged in `ai_calls` as usual; the parse eval checks the name is read for the synthetic resumes.
