# Proof confirmed by a manager or colleague: plan

**Status: proposed, for PM review; not approved; nothing is built.**

Development, 2026-10-31. Source: handoff section 6 ("Goals, pitstops and proof", proof 3: work experience confirmed by a manager or colleague, pending until confirmed), section 11 (stories backed by work proof show "Confirmed"), 12d (a job with no work email can "ask a manager to confirm later"), and the Library's Prove part. FR-47 ends with "Manager confirmation comes later". The Map shows "work you did, a manager or colleague confirms · soon" (`src/components/map/metro-map.tsx`). This plan touches the data model and emails a third party, so it needs approval before any code.

**The rules this keeps:**
- Only accepted proof fills a gap. A request on its way fills nothing ("pending until confirmed").
- Gap matching stays deterministic. No model reads, writes or judges a confirmation.
- The confirmer's email address is used to send one message and then thrown away; only a keyed hash and the domain stay.
- Email only, through the existing Resend helper and the shared app-email budget. No SMS, no WhatsApp.
- Nothing is shown to companies or the public that the person did not switch on.

## What is already built

| Piece | Today | Gap |
|---|---|---|
| Proof table | `gap_proofs` with `type` `work`, `verifier` `person`, and `evidence` `{type: "work", profileId, roleIndex}` (`src/lib/schemas/goals.ts`). | No flow writes a `work` proof yet. The evidence points at a resume role by index; roles added on Me (FR-53) need their own reference. |
| Work-email check | FR-47: a 6-digit code to the person's own work email; `job_email_checks` keeps employer, start month, domain and status; free mail refused (`FREE_MAIL_DOMAINS`, `isFreeMail` in `src/lib/corporate/domains.ts`); only a domain of a company CareerMetro verified that names the employer passes without an admin. | Checks the member, not a second person. |
| Email | `sendEmail` (`src/lib/email/send.ts`) and the shared budget `takeAppEmail` / `giveBackAppEmail` (`src/lib/email/budget.ts`): 40 app emails an India day, sign-in codes keep 60 of Resend's 100. | Needs a share for confirm invites. |
| Stories | `stories` rows; Me's `confirmed` flag is set when the linked goal's skill has accepted work proof (`src/lib/me/build.ts`). | Lights up by itself once work proof exists. |
| Held-proof review | `/admin/proofs` (FR-44) for held certificates. | Needs a second queue for confirmations whose domain needs a look. |
| Labels | Certificates show "Verified with Credly" or "Added by you" (FR-43); Milin's proof-honesty rules add "Uploaded" and, later, "Interview-checked" after L1. | No label for a confirmation. |

## 1. What can be confirmed

- **v1: a skill used in a role.** The member picks a role on their profile (resume or added on Me) and one to three skills of their open goals that they used there. The confirmer is asked about exactly those. An accepted answer writes one `gap_proofs` row a skill: `type work`, `verifier person`.
- **The role itself** (12d): for a job that couldn't get the work-email badge, a confirmation of "worked here, roughly these dates" shows "Confirmed by a colleague" on the job. It fills no gap on its own.
- **Stories:** not sent to the confirmer in v1. A story linked to a goal whose skill was confirmed in the same role shows "Confirmed", as the handoff says. Sending story text to a third party is a later choice (decision 7).
- **Handoff condition "backed by a course or certificate on the resume":** checked by code when the request is made (the resume lists a course or certificate whose `proves` covers the skill). Decision 3 asks whether to keep it, since many real workplace skills have no certificate.

## 2. Who can confirm

- Anyone the member names by email, with no CareerMetro account needed. Opening the link from that inbox is what proves control of the address.
- **Work email only.** Free mail (the FR-47 list and its country domains) and disposable-mail domains are refused before anything is sent.
- **Same company.** The confirmer's domain must be, or be under, the email domain of a company CareerMetro verified whose name or legal name names the role's employer (the FR-47 rule, so `accenture.xyz` can't pass for Accenture). Any other domain is accepted but the answer is held as `review` until an admin passes or refuses the domain, as with work-email checks.
- **Relationship:** the confirmer picks one: "I managed them", "I worked with them", "They reported to me on a project", "I was their client" (freelance only). The pick is shown with the proof.
- **Past colleagues who left the company** have no work email there and can't confirm in v1 (decision 2).
- **Freelance:** the client's own business domain, held for admin review every time, since there is no company record to match.

## 3. Sending the invite

1. On a goal's Prove pitstop (Map, Today, Library) or on a role on Me: "Ask someone to confirm". The form takes the role, the skills (pre-ticked from the goal), the confirmer's work email and the relationship. No free-text message from the member, so the email can't carry spam or abuse.
2. The server checks the rules (section 5), takes one email from the budget, creates the request and sends one email through `sendEmail` with `Idempotency-Key: confirm-<requestId>`. A refused or unsure send gives the budget back and marks the request `unsent`; the member is told to try again tomorrow.
3. **Budget:** invites share the 40 app emails a day with a cap of `APP_EMAIL_CONFIRM_SHARE` (proposed 10), like the digest's 20. When the share is spent the button says "We can send more requests tomorrow."
4. **The email** (plain text and simple HTML, from the app sender): "Asha V. asked you to confirm her work at Infosys" · what she says she did (role title, dates, skills in plain words) · one button "Answer (takes a minute)" · "If you don't know Asha, choose 'I don't know this person'. You can also stop all CareerMetro emails to this address." It names no other person and has no tracking pixel.
5. The link carries a random 32-byte token; only its SHA-256 is stored. It works once for answering, ends after 14 days, and is never logged.
6. **No reminder emails** in v1, because a reminder needs the address kept. The member may send one fresh request to the same person after 7 days, typing the address again.
7. **Do-not-email list:** "Stop emails to this address" stores the address's keyed hash in a suppression table; every later invite to it is refused silently (the member sees "We couldn't send to this address").

## 4. What the confirmer sees and can say

- A public page `/confirm/[token]`, no sign-in, no cookies beyond the CSRF one, `noindex`.
- It shows: the member's first name and last initial, the role title, company and dates as the member gave them, the skills in plain words with one line each from the taxonomy, and the relationship the member picked (the confirmer can change it).
- Three answers:
  - **"Yes, I confirm"**: "I saw Asha use these skills in this role." Each skill has its own tick, so they can confirm two of three.
  - **"I can't confirm"**: no reason needed.
  - **"I don't know this person"**: ends the request, adds a soft flag against the member (section 5) and offers "Stop emails to this address".
- **Optional note**, up to 200 characters, plain text: no links, email addresses or phone numbers (the existing note checks). Seen by the member only, never public or by companies.
- **Notice and consent** above the buttons (section 9 has the words): what is kept, who sees it, how to withdraw. Answering is the consent; nothing is kept if they close the page.
- After answering: a short thank-you, a **withdraw link** to keep (a second token, valid 2 years, hash stored), and "Stop emails to this address". A second click on the answer link shows "Already answered".

## 5. Anti-abuse

| Risk | Rule |
|---|---|
| Self-confirm | The confirmer's address may not equal the member's sign-in email, or the work email of any of the member's own code checks (compared by keyed hash at check time; FR-47 keeps only the domain, so the code check would keep a keyed hash too, decision 5). Aliases on the member's own company mailbox can't be fully caught; the answer is a signed statement and "Report a fake" plus spot checks back it. |
| Spam through the sender | 3 requests a day and 10 open at once per member; 20 invites a day per registered domain, shared with the work-email code count (T66); 1 open request per member and confirmer address; the suppression list. |
| Free or throwaway mail | Refused before sending (FR-47 list, its country domains, and a disposable-domain list in content). |
| Wrong company | Domain must match a verified company naming the employer, else held for an admin. |
| Collusion rings | A confirmer address (by hash) that confirms more than 5 members in 90 days, or two members who confirm each other within 30 days at different companies, is held for review rather than refused. Counts only, shown on `/admin/proofs`. |
| Made-up roles | Only roles on the member's profile; editing a confirmed role's company or start date clears its confirmations (as the work-email badge clears). |
| "I don't know this person" | Two such answers in 30 days pause the member's requests for 30 days and list them on `/admin/proofs`. |
| Reports | "Report a fake" on a public profile's confirmation files a person report into `/admin/reports` (FR-45). |
| Spot checks | An admin can reject any accepted confirmation with a reason; it writes one audit line and the goal reopens. |

## 6. How it shows, and the proof level

- **Fills the gap:** an accepted, domain-passed confirmation of a skill is accepted proof (handoff proof 3), so the goal turns met and the train moves. Held (`review`) ones fill nothing until an admin passes the domain.
- **Label:** "Confirmed by a manager at Infosys · Oct 2026" or "Confirmed by a colleague at Infosys". Never the confirmer's name or address.
- **Proposed order of proof strength** (for sorting and for Express apply criteria; decision 4): Verified with the issuer or Credly; Skill check passed (on-camera plan); Confirmed by a manager or colleague; Uploaded; Added by you. L1 "Interview-checked" stays a separate badge on top, never holding the goal back (Milin, 2026-10-11).
- **Me:** Proof of work lists each confirmed skill and role; a held one says "Waiting for us to check the company's email domain" to the owner only; a refused one says "They couldn't confirm this" with the note, owner only.
- **Public profile and companies:** behind the existing skills or proof switch; companies see it in Match as accepted proof, in words. "Verified" (the profile tick, "at least one skill proved by CareerMetro proof") counts it.
- **Stories:** "Confirmed" as in section 1.

## 7. Revocation

- **The confirmer** withdraws with the link they kept. The proof turns `rejected` with reason `withdrawn`, the goal reopens unless other proof fills it, the member is told in-app ("A confirmation was withdrawn") with no name.
- **The member** removes a confirmation from Me at any time.
- **Automatic:** a new company or start date on that role clears it; deleting the role clears it.
- **Admin:** reject after a report or a spot check, with an audit line.
- A confirmer leaving the company does not undo a confirmation.

## 8. Data model (needs sign-off)

Migration: next free number at build time (0058 if nothing lands first). Zod schemas and tests before code.

### `proof_confirm_requests`

| Column | Notes |
|---|---|
| `id` uuid pk, `user_id` fk → users cascade | The member. |
| `role_ref` jsonb | `{source: "resume", profileId, roleIndex}` or `{source: "added", roleId}`; the role's employer key and start month copied so a change can be spotted. |
| `skill_ids` text[] 0-3 | Empty for a role-only confirmation. |
| `relationship` enum | `manager`, `colleague`, `project_lead`, `client`. |
| `confirmer_hash` text | HMAC of the lower-cased address (the existing hash keys). The address itself is never stored. |
| `confirmer_domain` text | For the domain rule, counts and the admin queue. |
| `token_hash`, `withdraw_hash` text | SHA-256 of each token. |
| `status` enum | `unsent`, `sent`, `confirmed`, `declined`, `unknown_person`, `expired`, `withdrawn`, `removed`. |
| `domain_status` enum | `passed`, `review`, `refused`. |
| `note` text 0-200, null | Confirmer's note; owner only. |
| `confirmed_skill_ids` text[] | The skills they ticked. |
| `sent_at`, `answered_at`, `expires_at`, `created_at` | |

Indexes: (`user_id`, `created_at`), (`confirmer_hash`, `answered_at`), (`token_hash`) unique, (`domain_status`) where `review`.

- `gap_proofs.evidence` for `work` gains `requestId` and the `role_ref` shape (a Zod change, old rows stay valid).
- `email_suppressions` (`address_hash` pk, `created_at`): no user link, kept until the person asks to be emailed again.
- Rate limits use `shared-limit.ts` buckets (`confirm-request`, `confirm-domain`), no table.

## 9. Data kept, export, delete, privacy page

- **Kept:** see the table. Unanswered requests expire after 14 days; `expired`, `declined`, `unknown_person`, `unsent` rows are deleted 90 days later by the daily cleanup (long enough for abuse counts). Confirmed rows live as long as the proof; `withdrawn` and `removed` rows lose `note` at once and go after 90 days.
- **Logs:** event names and counts only. Never an address, token, note, name or domain.
- **Download your data:** next export version (38 if nothing lands first) adds `confirmations`: role, skills, relationship, domain, status, dates and the note. Never the hash or tokens.
- **Account deletion:** cascades. Proofs go with it, so nothing is left about the confirmer except the suppression hash, which names no one.
- **Confirmer's own rights:** they hold no account. The withdraw link and the grievance contact cover access, correction and erasure; erasure means deleting their answers (the member's proof goes too).
- **Privacy page lines (draft):**
  - "If you ask someone to confirm your work, we send them one email with your first name, last initial, the role and the skills you named. We don't keep their email address: we keep a scrambled form of it so we can stop repeat or unwanted emails, and their company's email domain."
  - "What they answer, and any short note, is shown to you. Others see only 'Confirmed by a manager at <company>', and only if you show your skills."
  - "The person who confirmed can withdraw at any time with the link we give them, or by writing to our grievance officer."

## 10. India DPDP Act notes (for counsel)

- The confirmer is a Data Principal whose address the member gives us. We process it to send one message. Whether that sits on the member's request, on a "legitimate use" or needs the confirmer's consent before the first email is a question for counsel; the plan minimises it (one email, address discarded, suppression list).
- Notice at collection: the email says why they got it and who asked; the page gives the full notice before any answer, so the consent to keep their answer is informed, specific and as easy to withdraw as to give.
- Purpose limitation: the answer is used only as proof for that member; no marketing, no sign-up nudge beyond a footer line (decision 8).
- Erasure when the purpose ends: cleanup times in section 9.
- Grievance officer: the confirmer may complain; pending item 15 (no officer named yet) should be settled before launch, as with Timetable suggestions.
- The DPDP Rules' phased dates and any breach-notice duties apply to these rows as to the rest.

## 11. Decisions for Milin, the PM or a lawyer

1. **Approve the data model** (section 8) and the plan as a whole. (PM under Milin's delegation.)
2. **Past colleagues without a work email**: leave out in v1, or allow a signed-in CareerMetro member with a verified work-email check at that company in the role's years? (Milin.)
3. **Keep the handoff's "backed by a course or certificate on the resume"** condition? (Milin.)
4. **Proof strength order** in section 6, and whether a confirmation meets an Express apply "accepted proof" criterion. (Milin.)
5. **Keep a keyed hash of the member's work-email address** from FR-47 checks so self-confirm can be caught? (PM.)
6. **Confirm-invite share** of the 40 a day (proposed 10). Resend Pro is already the listed upgrade; no new paid service. (PM.)
7. **Story text to the confirmer** later? (Milin.)
8. **Footer line inviting the confirmer to try CareerMetro**, or nothing? (Milin; counsel on whether it is marketing.)
9. **Lawful basis for the first email**, consent wording, and the privacy-page lines. (Lawyer.)
10. **Who reviews held domains and reports** until a grievance officer is named. (Milin.)

## 12. Build order (small PRs)

1. Migration (next free number), Zod schemas, `role_ref` evidence, the pure rules (domain, free and disposable mail, self-confirm, limits, collusion counts) with tests, export version bump. After sign-off.
2. "Ask someone to confirm" form on Me and the Prove pitstop, the budget share, the email, `unsent` handling and the suppression list. Behind `PROOF_CONFIRM_ON`, off in production.
3. `/confirm/[token]`: notice, answers, note checks, withdraw link, stop-emails; writes `gap_proofs` and recomputes goals.
4. Display: Me's Proof of work, the job label, story "Confirmed", public profile, Match and the strength order; member remove; cleared on role edits.
5. `/admin/proofs` queue for held domains, "I don't know this person" pauses and ring flags; "Report a fake"; daily cleanup; privacy page; `/design` entries.
6. Turn on in production after decisions 1, 9 and 10.

Each PR updates `docs/STATUS.md` and runs the full check before its one push.
