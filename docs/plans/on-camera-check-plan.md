# On-camera skill check: plan

**Status: proposed, for PM review; not approved; nothing is built.**

Development, 2026-10-31. Source: handoff section 6, proof 1 ("A skill check for that skill (timed, on camera, retake after 7 days)"), the Library's Prove part, and the Map's "Skill check on camera · soon" (`src/components/map/metro-map.tsx`). `gap_proofs` already allows `type skill_check` with evidence `{type: "skill_check", checkId}` (`src/lib/schemas/goals.ts`). This plan touches the data model, the AI pipeline, storage and privacy, so it needs approval before any code.

**The rules this keeps:**
- Only accepted proof fills a gap. Recording an answer fills nothing; a pass decided by people and code does.
- Pass or fail is decided by a deterministic rubric over a human expert's ticks. The model may transcribe or explain; it never decides, scores or suggests a result on its own (CLAUDE.md: gap matching is deterministic code).
- Video stays in India (Supabase Storage, `ap-south-1`) and is deleted soon after review. It is never shown to companies or the public.
- No billing code, nothing that needs Vercel Pro, and no new paid service without a decision below.

## What is already built

| Piece | Today | Use here |
|---|---|---|
| Private storage | Certificate files in a private Supabase Storage bucket in Mumbai, one folder per person, signed URLs (dev/proof-plan.md). | Same pattern, a new bucket. |
| On-device speech | Mock interviews turn speech to text in the browser (Web Speech API with `processLocally`; browsers that would send audio away are not offered it), so audio never leaves the device. | Optional transcript, free. |
| Question banks | `src/content/mock-bank.json` with `reviewed` flags; production uses reviewed items only (pending item 27). | Same flag for check questions and rubrics. |
| AI calls | Every call reserved first, logged in `ai_calls` with its prompt version, daily USD budget, Zod-checked output. | Only for the feedback text. |
| Admin gate | `ADMIN_EMAILS` for `/admin/*`. | A reviewer gate next to it. |
| Cleanup | Daily `/api/cron/cleanup` at 03:00 IST (Hobby allows one a day). | Deletes old recordings. |

## 1. What is recorded

- **v1: camera and microphone**, one practical question, answered live. 30 seconds to read, then up to 3 minutes of recording. One retake inside the same sitting before submitting; after submitting, a new check of that skill waits 7 days (handoff).
- **Recorded in the browser only** with `getUserMedia` and `MediaRecorder` (WebM, or MP4 on Safari), 480p at about 500 kbit/s, mono audio. There is no file picker: a pre-made video can't be uploaded.
- **Not in v1: screen recording.** It suits "write this SQL query" tasks but shows whatever else is on screen (mail, chats) and doubles the size. Listed as decision 6.
- **Audio-only and typed answers** are the alternatives (section 8), with the same question, rubric and reviewer.
- **Liveness line:** at the start the screen shows two random words and a number to say aloud ("blue river 47"). The reviewer ticks whether they were said. No face recognition and no face matching to any ID.

## 2. Questions and rubric

- New content file `src/content/skill-checks.json`, checked by a Zod schema: per skill, 3 to 6 practical questions ("Walk through how you would find why this query is slow: …"), each with a rubric of 4 to 6 observable items ("names an index on the join column", "checks the query plan first"). Each item is `must` or `plus`.
- Written by Development and Data research with `reviewed: false`; production offers a skill's check only once someone who works in the role has reviewed its questions and rubric (pending item 27).
- The question is picked by code (seeded by the check id), never shown before recording starts, and not reused for the same person until the others are used.

## 3. Assessment

1. **Code checks first:** the recording is 30 seconds to 3 minutes long, has audio, and the upload's size and type match. Fail any and the check returns to the person with a plain reason; no reviewer time is spent.
2. **Transcript (optional):** when the browser can transcribe on the device, the text is saved with the recording. A keyword hint (rubric words found in it) is shown to the reviewer as "words heard", never as a score and never failing anyone, since accents and noise trip speech-to-text.
3. **Human expert review:** a reviewer opens the next check in `/review/checks`, watches it through a signed URL valid 10 minutes, and ticks each rubric item yes or no, plus the liveness line and "Looks like someone else or reading a script". They see the skill, question and rubric only: no name, photo, profile or resume (blind review).
4. **Deterministic result:** pass when every `must` item and at least half the `plus` items are ticked and the liveness line is ticked. Plain code, tested. A tick of "someone else or reading" holds the check for a second reviewer instead.
5. **Second review:** a random 10% of checks and every held one go to a second reviewer; when they disagree, the stricter result stands and both are told (calibration).
6. **Feedback text (the model's only job):** after the result is set, one call (`prompts/skill-check-feedback/v1.md`) gets the question, rubric, the reviewer's ticks and the transcript (as untrusted data, AI-7) and writes two or three plain lines: what came through and what to add next time. The app drops a reply with a score word, a pass or fail claim that differs from the stored result, or a number it wasn't given (the mock eval's checks). Without a transcript, the feedback is the ticked list in words, with no call.
7. **Turnaround:** reviewers aim for 72 hours; a check not reviewed in 14 days is cancelled, its video deleted and the person told they can record again at once.

## 4. Result and proof level

- A pass writes `gap_proofs`: `type skill_check`, `verifier person`, `status accepted`, evidence `{type: "skill_check", checkId}`. The goal turns met and the train moves.
- **Label:** "Skill check passed · reviewed by an expert · Oct 2026". It says the answer showed the skill, not who the person is.
- **Proposed place in the proof order** (shared with the confirmation plan, decision 4 there): below issuer- or Credly-verified certificates, above a manager or colleague's confirmation. L1 "Interview-checked" stays a separate later check.
- **Not passed:** "Not yet" with the feedback, owner only; nothing on the profile; a new check after 7 days.
- **Expiry:** none in v1 (decision 7).

## 5. Storage and caps

- A new private bucket `skill-checks` in the existing Supabase project (`ap-south-1`), path `<user_id>/<check_id>.<ext>`, bucket file limit 25 MB, allowed types `video/webm`, `video/mp4`, `audio/webm`, `audio/mp4`.
- **Upload goes straight from the browser to Supabase Storage** with a signed upload URL (resumable, so a dropped 4G link can continue). No video passes through a Vercel function, so the 4.5 MB body limit and Hobby's function time don't matter.
- A server action issues the upload URL only for the person's own open check, then confirms the object exists and its size before marking it submitted.
- **Caps:** 3 minutes a recording, 25 MB a file, 3 submitted checks a person a month and 1 open at a time, a global daily cap on new checks (`SKILL_CHECKS_DAILY`, proposed 30) so reviewers aren't swamped.
- **Size estimate:** 3 minutes at 500 kbit/s is about 11 MB; audio-only about 1.5 MB.

## 6. Consent, retention, who can view

- **Consent:** a separate screen before the camera turns on, with its own tick (not the sign-up consent): what is recorded (video and voice, or voice only), who watches it (one or two expert reviewers bound by a confidentiality agreement; CareerMetro admins only after a report), how long it is kept, that it is never shown to companies or the public, never used to train any model, never used to recognise faces, and that the person can delete it any time. Saved with the version of the wording and the time.
- **Retention:** the recording and transcript are deleted 30 days after the result (time for a re-review request) or 14 days after submission when unreviewed, by the daily cleanup; at once when the person deletes it (deleting before review cancels the check). What stays: question id, rubric ticks, result, reviewer ids, dates and the feedback text, as long as the proof lives.
- **Who can view:** the person (their own playback, signed URL) and the assigned reviewers. Not shared by link in v1. Sharing one recording with one company in an Express apply, with a per-company consent and a 30-day view window, is a later choice (decision 5).
- **Download your data:** next export version adds `skillChecks` (skill, question, result, ticks, feedback, dates) and a signed link to the recording while it still exists.
- **Account deletion:** cascades the rows; the cleanup removes the person's storage folder the same day.
- **Logs:** ids and counts only. Never the transcript, the feedback text or a storage path.

## 7. Cost per check (estimate)

| Item | Per check |
|---|---|
| Storage, 11 MB for about 30 days | well under ₹0.1 |
| Reviewer playback egress, one or two views | under ₹0.2 |
| Feedback call (short text in and out) | about ₹1 |
| On-device transcript | free |
| **Expert review, about 5 to 8 minutes** | **₹50 to ₹150, to be set (decision 2)** |

- Review pay dominates: about ₹60 to ₹160 a check. At the proposed 30 a day that is up to about ₹1.4 lakh a month at full use.
- **Supabase plan:** the free plan's storage (about 1 GB) holds only around 90 live recordings, and its egress is small. The tech-stack register already lists Supabase Pro (about $25 a month, 100 GB storage) as needed before real users; this feature makes that firm (decision 3).
- No transcription service is used. If on-device speech proves too patchy, a paid speech-to-text service would be a new decision with its own cost.

## 8. Accessibility and alternatives

- **No-camera path, same standing:** "Answer with voice only" (microphone) and "Type your answer" (a timed text box, 5 minutes, same question and rubric, same reviewer, liveness by a typed random phrase). The label is the same whichever way the person answers, so nobody is pushed onto camera.
- **Extra time:** "I need more time" gives 1.5 times the read and answer time, no reason asked.
- Question shown as text and readable by screen readers; recording controls keyboard-operable with visible state ("Recording, 1:42 left"); no autoplay; countdown not by colour alone; `prefers-reduced-motion` respected.
- **Low bandwidth:** 480p, resumable upload, and "Upload later on Wi-Fi" keeps the recording in the browser for 24 hours.
- Hindi: questions in English at launch, as the app; answering in Hindi is allowed when the reviewer can follow it (decision 8).

## 9. Abuse, deepfakes, impersonation

| Risk | What we do | What stays open |
|---|---|---|
| Someone else answers | Liveness line; reviewer flag; the L1 interview later; "Report a fake". | No ID check (DigiLocker is FR-32, later). The label never claims identity. |
| Reading a script or an AI helper | Question hidden until recording; 30 s to read; reviewer flag "reading". | Can't be fully stopped; the rubric asks for reasoning, not recall. |
| Deepfake or virtual camera | Live recording only, no file upload; liveness words; second review on flags. | Virtual cameras can't be reliably detected in a browser. |
| Leaked questions | 3 to 6 a skill, no repeats, retired when seen shared. | Bank needs topping up. |
| Abusive content in a video | Reviewer reports it to `/admin/reports`; the video is kept with the report, not deleted by cleanup, until closed. | Reviewer wellbeing; a short guide. |
| Reviewer misuse | Blind review; signed URLs 10 minutes; no download button; every view writes an audit line (reviewer id, check id). | A reviewer can still screen-record; covered by their agreement. |

## 10. India DPDP Act notes (for counsel)

- Video of a face and a voice is personal data. The DPDP Act has no separate "sensitive" class, but face and voice can act as biometric data, and the older SPDI Rules under the IT Act treat biometrics as sensitive until the DPDP regime fully replaces them. We treat it as high-risk: separate consent, short retention, India storage, no face recognition or voice prints.
- Consent must be free, specific, informed and as easy to withdraw as to give: the separate screen, the alternatives of equal standing and delete-any-time cover this.
- Cross-border: video never leaves India. The feedback call sends the transcript (text) to the AI provider; the existing privacy-page line on the provider covers the transfer, but counsel should confirm it names this use.
- Reviewers are processors acting for CareerMetro: they need a written agreement (confidentiality, no copies, deletion).
- Sign-up is for adults; this flow adds an "I am 18 or over" line to its consent in case that changes.
- Breach duties under the DPDP Rules apply; a leaked video is the worst case here, so the bucket is private, paths are unguessable and signed URLs are short.

## 11. Data model (needs sign-off)

Migration: next free number at build time.

- `skill_checks`: `id`, `user_id` fk cascade, `skill_id`, `question_id`, `mode` (`video`, `audio`, `text`), `status` (`recording`, `submitted`, `in_review`, `held`, `passed`, `not_yet`, `cancelled`, `deleted`), `storage_path` null, `size_bytes`, `duration_s`, `transcript` text null, `text_answer` text null (typed mode, up to 4,000), `liveness_phrase`, `extra_time` bool, `consent_version`, `consented_at`, `submitted_at`, `decided_at`, `feedback` text null, `media_deleted_at`, `created_at`. Indexes: (`user_id`, `skill_id`, `created_at`), (`status`, `submitted_at`).
- `skill_check_reviews`: `check_id` fk cascade, `reviewer_id`, `ticks` jsonb (item id → bool), `liveness_ok`, `flag` (`none`, `someone_else`, `reading`, `abuse`), `created_at`. Primary key (`check_id`, `reviewer_id`).
- Reviewers: `REVIEWER_EMAILS` env (like `ADMIN_EMAILS`) and a `skill_reviewers` content list of the skills each may review.

## 12. Decisions for Milin, the PM or a lawyer

1. **Approve the plan and data model.** (PM under Milin's delegation.)
2. **Reviewer pay and who the reviewers are** (₹50 to ₹150 a check proposed), and a daily cap that fits the money. (Milin.)
3. **Move Supabase to Pro** (about $25 a month) before this ships; storage use is listed in section 7. (Milin.)
4. **Consent wording, the confidentiality agreement for reviewers, and the lawful-basis notes** in section 10. (Lawyer.)
5. **Share a recording with a company** later, or never? (Milin.)
6. **Screen recording** for hands-on tasks, in a later version? (Milin.)
7. **Does a passed check expire** (for example after 3 years)? (Milin.)
8. **Answers in Hindi** at launch? (Milin.)
9. **Checks a person a month** (3 proposed) during the free beta. (PM.)

## 13. Build order (small PRs)

1. Migration, Zod schemas, the `skill-checks.json` schema with a few `reviewed: false` items, and the pure rubric scorer with tests. After sign-off.
2. Recorder component on `/design` with a fake stream: consent screen, read timer, liveness line, record, retake, extra time, accessible states.
3. The bucket, signed upload, submit with code checks, the person's own playback and delete, and the 7-day rule. Behind `SKILL_CHECK_ON`, off in production.
4. Reviewer screen `/review/checks` (gate, blind view, ticks, flags, second review, audit lines), result to `gap_proofs`, in-app notice.
5. Feedback prompt `prompts/skill-check-feedback/v1.md` with the `ai_calls` budget, its Zod checks and `npm run eval:check` over synthetic transcripts (never in CI).
6. Voice-only and typed modes, daily cleanup of media, export version bump, privacy page, Map and Library "Skill check" no longer "soon" for reviewed skills.
7. Turn on in production after decisions 1 to 4 and reviewed questions for at least one skill.

Each PR updates `docs/STATUS.md` and runs the full check before its one push.
