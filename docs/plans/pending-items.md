# CareerMetro pending items

Items Milin asked to fix later. Newest at the bottom.

## From the first live test (2026-10-08)
1. **Post-upload issues.** Milin saw "some issues" after a successful upload, to be fixed later. Details still to collect from him.
2. **Gaps per company, not only per role.** Gaps are compared only with our fixed role profiles. Milin wants gaps against the roles people actually apply for, since requirements differ by company. Example: not every company needs Python for a Cyber Security Analyst L1. Likely approach: let the user paste a job description (the `job_descriptions` table already exists) and match against the skills in it, with the role profile as the fallback.

## Carried over from reviews
3. A database index on `gap_analyses.profile_id` (needs a migration).
4. Record AI spend outside the gap transaction, so a failed insert still counts toward the budget.
5. Tests for the rating route handler.
6. An eval for the explain-gaps prompt.
7. Gate `/api/health?check=parse` behind a secret (needs `CRON_SECRET` or a new secret in Vercel). Until then its calls count toward the daily upload budget.
8. `CRON_SECRET` in Vercel (Milin) for the daily cleanup job, and `ANTHROPIC_API_KEY` as a GitHub Actions secret for the parse eval.

## Future phases (Milin, 2026-10-08)
9. **More learning materials.** Keep growing the resource catalog beyond the first 217 free links.
10. **Elite tier (paid subscription).** Paid materials, a community, interview prep and similar extras. Elite interview prep means AI mock interviews with feedback, a question and answer bank by role, and timed mock tests; the free Practice step stays a short set of gap-focused questions. The Library has both a free shelf and an Elite shelf of paid and expert-verified content (Milin, 2026-10-08). Recorded in docs/REQUIREMENTS.md section 12 as a later item; no billing code until it is scheduled.
11. **B2B: DigiLocker document checks for background verification** (FR-32 in docs/REQUIREMENTS.md). Needs DigiLocker requester onboarding (API Setu, or a licensed provider), consent per document, never store full Aadhaar. Address may not come back from DigiLocker's profile.
12. **B2B: AI first-round video interviewer** (FR-33). Tavus is the candidate vendor; Griffin is a research preview announced 2026-10-01 (Griffin-Lite for trusted testers, no public API yet). Must disclose the AI, get recording consent, and keep a human deciding.
13. **Verified certifications on the profile** (Milin, 2026-10-08). Show 3 to 5 certifications on a profile. A user verifies one by adding its Credly badge link (credly.com/badges/...); we check the badge's name and issuer match before showing the verified tick. Feeds the verified skill profile.
14. **Paid mentor sessions in the community** (Milin, 2026-10-08). Free users can book and pay for an hourly 1:1 session with a mentor for guidance, interview questions or role prep. Needs mentor vetting, scheduling, payments with payouts (we keep a share), refunds and ratings. Comes after the beta, since there is no billing code yet.
15. **Junction: a posting board in the community** (Milin, 2026-10-08, comment on the line-view mock). People post an idea, question, win or resource; others upvote, comment, reshare and save; filters Top, New, My route, Following; a post can be pinned to the profile. Name "Junction" is a working title (alternatives: Platform, Signal, Interchange). Mock: Junction tab in /mnt/project-files/careermetro/post-login-home-fable-v1.html. This moves the feed earlier than the platform plan intended: once users post, the app is an intermediary under India's IT Rules 2021, so it needs a named grievance officer, complaint handling within 24 to 72 hours, moderation, and Report on every post and comment. Decide who the grievance officer is before this ships. Also (Milin, 2026-10-08): a **My interests** feed; interests are anything a person wants to learn or talk about (AI, design, marketing, public speaking), not only their job, and tag both posts and the feed. Needs an `interests` tag table and a user-to-interest link.
16. **Express apply from Departures** (Milin, 2026-10-08, comment on prototype v2). One tap sends a prefilled packet (contact, skills for the role, verified certificates, proof tasks, resume, editable drafted note) to the employer; Elite adds interview prep and mock questions per role. Needs a receiving side: employer partners (B2B) or an ATS apply API the employer has enabled; roles without it keep "Apply on company site". Under the DPDP Act this shares personal data with a third party, so ask consent per company per application, log it, and let users see and withdraw what was sent. Never send gaps or path. Express apply is gated per role by the employer's criteria (Milin, 2026-10-08): DigiLocker-verified identity, verified skills, a minimum level on a role skill check, certificates, notice period, gaps allowed; gaps alone do not block it. Ties to items 11 and 13. Mock: Departures in /mnt/project-files/careermetro/careermetro-prototype-v2.html.

## Not designed yet (Milin, 2026-10-09)
Development starts with the job seeker's first sign-up and returning screens. These still need design before any build:
17. **Organization sign-up.** How a company, college or training partner creates an account: verified work-email domain, company profile, admins and seats. `organizations` exists in the schema only. Team features are Phase 3.
18. **HR / employer role posting.** A screen where an employer posts a job: a role picked from a profile, track, required / one-of / nice skills, work type (Full time, Part time, Freelance), city, Express apply criteria (item 16), and Arrivals stages they update. Needs moderation of postings and the intermediary rules in item 15.
19. **B2B as a product.** The employer side as a whole: candidate search limited to opted-in profiles, shortlists, the pipeline that feeds Arrivals, and pricing per contact, screen or check. Covers items 11, 12 and 16 from the employer's side.
20. **Elite version design.** Item 10 sets the scope, but no screens exist yet: the upgrade page, the Elite shelf in Library, mock interviews, the practice AI round in Arrivals, and the verified tick. Free during the beta still holds, so there is no billing code until it is scheduled.
