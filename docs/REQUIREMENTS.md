# CareerMetro — Product Requirements (for Claude Code)

> Drop this file in the repo root. Reference it from `CLAUDE.md` with: `Read CAREERMETRO_REQUIREMENTS.md before any design or implementation work.`

## 1. Product summary

CareerMetro reads a person's actual resume and a named target role in the Indian job market, tells them their specific skill gaps, and gives them a short personalized upskilling path, AI interview practice, and role matches they are ready for.

**One-line positioning:** Naukri finds listings, LinkedIn Learning and upGrad/Coursera sell courses. CareerMetro connects the two: *resume + target role -> your gap -> shortest path to close it.*

**Brand metaphor:** a metro map. Every journey is a "route" made of "stations". The landing page prototype (`careermetro.html`) is the visual source of truth for tone, colors and metaphor.

## 2. Goals and non-goals

### Goals (MVP)
1. A job seeker uploads a resume, picks a target role, and in under 2 minutes sees their top 3-5 skill gaps with evidence from their own resume.
2. They get a short upskilling path (target: 2-6 weeks of effort) sized to those gaps.
3. They can practice AI-coached interview questions for the target role.
4. They can export an improved, ATS-friendly resume.
5. Waitlist and SEO content engine live from day one (the B2C growth channel).

### Non-goals (MVP)
- Hosting our own course content. We curate and link; we do not build a content library.
- A full job board. Job matching in MVP is role-profile matching, not listing aggregation.
- Native mobile apps. Responsive web only.
- Employer-side hiring tools.

## 3. Users

| Persona | Need | Entry point |
|---|---|---|
| **Job seeker (B2C)**, India, 1-10 yrs experience, switching or upgrading roles | "What exactly am I missing for this job?" | Google search on "how to get X job" |
| **L&D / HR lead (B2B)** at a mid-size company | See skill gaps across a team and assign short paths | Direct sales, consulting relationships |

MVP builds for the job seeker. B2B is Phase 3 but the data model must not block it (see section 6).

## 4. Core user journey (the "route")

| Station | What happens | Output |
|---|---|---|
| **Resume St.** | Upload PDF/DOCX or paste text | Parsed, structured profile the user can correct |
| **Skill Gap Jn.** | Pick a target role (+ optional city, experience level) | Ranked gap list, each gap linked to evidence ("your resume shows X, role needs Y") |
| **Upskill Line** | System builds a short path | Ordered steps: skill, why it matters, 1-3 curated resources, time estimate, a small proof-of-skill task |
| **Interview Yd.** | AI interview practice for the role and the gaps | Question set, answer feedback, score trend |
| **Job Match Term.** | Match readiness to role profiles | Roles the user is ready for now and roles they are N weeks away from |

## 5. Functional requirements

### 5.1 Accounts and onboarding
- FR-1: Sign in with Google or an emailed 6-digit code (the email also carries a link). First sign-up asks for an "I am 18 or older" tick and records an account consent. Phone OTP (India) waits on TRAI DLT registration.
- FR-2: A first-time user can run one gap analysis before creating an account (reduces drop-off); results are saved on signup.
- FR-3: User can delete their account and all stored resume data from settings (see privacy).

### 5.2 Resume ingestion
- FR-4: Accept PDF, DOCX, plain text paste. Max 4 MB (Vercel caps function request bodies at 4.5 MB; changed from 5 MB on 2026-10-07).
- FR-5: Extract into a structured profile: roles, employers, dates, skills, tools, education, certifications, achievements.
- FR-6: Show the parsed profile and let the user fix mistakes before analysis. Never analyze silently on wrong parse.
- FR-7: Handle Indian resume conventions (CTC mentions, notice period, multi-column templates, Hindi/English mixed text).

### 5.3 Target role and market data
- FR-8: Target role is chosen from a curated **role profile library** (start with 30-50 high-demand India roles) or created by pasting a real job description.
- FR-9: Each role profile holds: required skills, nice-to-have skills, tools, typical experience band, and a freshness date.
- FR-10: Role profiles are refreshed on a schedule from licensed or permitted sources only (see open question OQ-1). Every profile shows "updated on <date>".

### 5.4 Skill-gap analysis
- FR-11: Compare the structured profile to the role profile and return gaps classified as *missing*, *weak evidence*, or *outdated*.
- FR-12: Every gap must cite evidence from the resume (or its absence) and the role requirement. No unexplained scores.
- FR-13: Provide an overall readiness indicator with a plain-language explanation, not a magic number.
- FR-14: Output is structured JSON validated against a schema, then rendered. Reject and retry malformed model output.

### 5.5 Upskilling path
- FR-15: Generate a path of at most 6 steps, sized to the user's stated weekly hours (default 5 hrs/week).
- FR-16: Each step: skill, reason tied to a gap, curated resources (prefer free and India-accessible), time estimate, one proof-of-skill task (mini project or exercise).
- FR-17: Resources come from a maintained catalog with link-health checks. The model selects from the catalog and never invents URLs.
- FR-18: User can mark steps done; path progress updates. Progress is kept when the weekly hours change. Readiness changes only once a step's proof task is checked (Practice), because a self-reported tick is not evidence.

### 5.5b Resume builder
- FR-19: Generate an improved resume draft from the parsed profile, rewriting bullets for the target role. Never fabricate experience or skills; anything the model adds as a suggestion is flagged for the user to confirm.
- FR-20: ATS-friendly single-column templates (2-3). Export to PDF and DOCX.

### 5.6 Interview practice
- FR-21: Generate role-specific questions weighted toward the user's gaps.
- FR-22: Text answers in MVP (voice later). Feedback on structure, specificity, and technical correctness, with a stronger sample answer.
- FR-23: Track a per-skill confidence trend across sessions.

### 5.7 Job matching (MVP scope)
- FR-24: Show which role profiles the user is ready for now, and which are within N weeks.
- FR-25: Phase 2: connect to real listings through a licensed or partner feed.

### 5.8 Growth and content (B2C channel)
- FR-26: Programmatic SEO pages for "how to get a [role] job in [city]", generated from role profiles plus human editorial review before publishing.
- FR-27: Each SEO page ends with a "check your own gap" call to action into the route.
- FR-28: Waitlist capture with double opt-in; a public changelog page.

### 5.9 Phase 3 — B2B team shuttle
- FR-29: Organizations, seats, and admin role.
- FR-30: Aggregate skill-gap dashboard per team (no individual resume visible to admins without that employee's explicit consent).
- FR-31: Assign a role profile or path to a team; track completion.
- FR-32 (later, added 2026-10-08): Document verification for background checks. A candidate connects DigiLocker and consents per document; we check name, date of birth and photo against issued documents (Aadhaar via e-Aadhaar, PAN, marksheets and certificates). Needs DigiLocker requester onboarding (directly through API Setu or via a licensed provider), which has its own audit duties. Store only what the check needs: never the full Aadhaar number (last 4 digits at most), no copies of documents beyond the employer's retention rule, and a consent record per document. Address may not be returned by DigiLocker's user profile, so confirm the source before promising address checks.
- FR-33 (later, added 2026-10-08): AI first-round interviewer for employers. A lifelike video agent runs a structured level-1 interview, records it with the candidate's consent, and gives the employer a transcript, a scored summary against the role profile and the recording to review. Candidates are told up front that the interviewer is an AI, and a human makes the hiring decision. Candidate vendor: Tavus (its Conversational Video Interface today; its new Griffin model, a research preview announced 2026-10-01, when it opens up). Evaluate cost, India data residency, bias testing and recording consent before building.

## 6. Data model (high level)

`User`, `Organization` (nullable in MVP, present from day one), `Resume` (file ref, parse status), `Profile` (structured JSON, versioned), `RoleProfile` (skills, tools, freshness date, source), `GapAnalysis` (profile version, role profile version, gaps JSON, model + prompt version), `Path`, `PathStep`, `Resource` (catalog, link-health status), `InterviewSession`, `InterviewAnswer`, `ContentPage` (SEO), `WaitlistEntry`, `AuditLog`.

Rule: every AI output record stores the model, prompt version, and inputs' versions so results are reproducible and debuggable.

## 7. AI requirements

- AI-1: Use the Claude API with structured (schema-constrained) outputs for parsing, gap analysis, path generation and interview feedback.
- AI-2: Ground gap analysis in the stored role profile and the user's parsed profile only; do not let the model assert market facts that are not in the role profile.
- AI-3: Prompts live in versioned files, not inline strings. Each has an eval set.
- AI-4: Build an **evaluation harness before launch**: 30+ real (consented or synthetic) resumes across roles, with expected gaps reviewed by a human domain expert. Track parse accuracy, gap precision/recall, and hallucination rate on every prompt or model change.
- AI-5: Hard rules: never invent employers, titles, dates, certifications, or resource URLs. Resume rewrites flag any added claim.
- AI-6: Cost control: cache role-profile context, cap tokens per analysis, per-user daily limits, and log cost per analysis.
- AI-7: Treat resume text as untrusted input (prompt injection, e.g. hidden "ignore previous instructions" text). Isolate it in the prompt and never let it trigger tool actions.

## 8. Security and privacy

Resumes are dense personal data (name, phone, employer history, sometimes salary and address). Treat the product as a security-sensitive system from day one.

- SEC-1: Comply with India's **Digital Personal Data Protection Act, 2023**: clear consent at upload, purpose limitation, a grievance contact, deletion on request, breach-notification process. Confirm the exact obligations with counsel before launch.
- SEC-2: Encrypt in transit (TLS) and at rest. Resume files in private object storage with short-lived signed URLs.
- SEC-3: Store data in an India region where feasible; document any cross-border transfer (including to the LLM provider) in the privacy policy.
- SEC-4: Do not use user resumes to train models. State this plainly in the UI.
- SEC-5: Auto-delete uploaded raw files after N days (default 30); the user can delete earlier.
- SEC-6: Strip or mask phone, email and address before sending text to the LLM where the analysis does not need them.
- SEC-7: OWASP ASVS L1 baseline: rate limiting, upload validation (type, size, malware scan), CSRF protection, secure session handling, dependency scanning in CI, secrets in a vault not the repo.
- SEC-8: Role-based access; audit log for any admin access to user data.
- SEC-9: Pre-launch penetration test of upload, auth and admin paths.

## 9. Non-functional requirements

- Performance: parse + gap analysis p95 under 45 seconds, with streamed progress on the route UI. Pages LCP under 2.5 s on mid-range Android over 4G.
- Availability: 99.5% for MVP.
- Accessibility: WCAG 2.1 AA, keyboard-navigable, screen-reader labels on the route map, sufficient contrast (verify the line colors on the dark background), `prefers-reduced-motion` respected.
- Responsive: mobile-first (most Indian job seekers are on phones). Route map collapses to a vertical line on small screens (already prototyped).
- Languages: English at launch; i18n structure in place for Hindi next.
- Observability: structured logs, error tracking, per-feature funnel analytics (privacy-respecting, no resume content in logs).

## 10. Design requirements

- DES-1: Reuse the visual system from `careermetro.html`: dark ink background (`#0E141F`), paper surface (`#EAE6D8`), five line colors (red `#D6543F`, amber `#E7A73C`, blue `#3E7CB1`, violet `#8175CE`, green `#3F9C7D`), Space Grotesk (display), Inter (body), JetBrains Mono (labels).
- DES-2: The **route map is the primary navigation and progress indicator** of the logged-in app. Each station = one product step; the user always sees where they are. Structure encodes real sequence here, so numbering and stations are legitimate.
- DES-3: Extract these into design tokens (CSS variables / Tailwind theme) and a small component library: RouteMap, Station, GapCard, PathStep, ResumeDiff, ChatPractice, ReadinessMeter, EmptyState, Toast.
- DES-4: Copy rules: plain verbs, sentence case, active voice, same name for an action through the whole flow. Errors say what happened and how to fix it. Metro words are used for naming stages only, not sprinkled everywhere.
- DES-5: Screens to design (MVP): landing, sign in, resume upload and parse review, role picker, gap results, upskilling path, resume builder, interview practice, readiness dashboard, settings and data deletion, SEO article template.
- DES-6: Empty, loading, partial-parse and failure states are designed for every screen, not left to defaults.

## 11. Suggested tech stack (changeable; justify any deviation)

- **App:** Next.js (App Router) + TypeScript, Tailwind with design tokens, deployed on Vercel or an India-region container host.
- **Data:** PostgreSQL (with pgvector for skill/role matching), Prisma or Drizzle.
- **Files:** S3-compatible private bucket (AWS Mumbai region).
- **Auth:** Supabase Auth (decided 2026-10-09), behind `src/lib/auth/` only. Our own `users.id` is the identity; no foreign key to the provider. Until its keys are added, preview and local builds offer a stand-in "Continue as test user" sign-in (name and email, no check; emails get a `.test` ending so they never meet a real account). It switches off once the keys are set and never runs in production (decided 2026-10-09).
- **AI:** Claude API (Anthropic SDK) with schema-validated outputs (Zod).
- **Jobs:** a queue for parsing and analysis (e.g. Inngest, BullMQ, or a managed queue).
- **Docs/PDF:** server-side PDF and DOCX generation for the resume export.
- **Testing:** Vitest, Playwright, plus the AI eval harness.
- **CI/CD:** GitHub Actions: lint, typecheck, tests, evals, dependency scan.

## 12. Phasing

1. **Phase 0 (week 0-2):** repo setup, design tokens and component library from the landing page, role-profile schema, 10 hand-built role profiles, eval set started. Waitlist live.
2. **Phase 1 (week 3-8):** resume ingest -> gap analysis -> upskilling path. Private beta with 50 users. Evals gate every release.
3. **Phase 2 (week 9-14):** resume builder, interview practice, readiness dashboard, 30+ role profiles, first 50 SEO pages.
4. **Phase 3 (week 15+):** B2B team shuttle, listing feed integration, voice interview practice.
5. **Later (not scheduled, added 2026-10-08):**
   - **Gaps per job description:** compare a resume with the job a user actually applies for, not only our role profiles, since requirements differ by company (for example, not every Cyber Security Analyst L1 job needs Python).
   - **More learning materials:** keep growing the resource catalog beyond the first set of free links.
   - **Elite tier (paid subscription):** paid learning materials, a community, deeper interview prep and similar extras. The free product stays free; billing code waits until this phase is scheduled.

## 13. Success metrics

- Activation: % of signups who see a gap analysis (target 60%).
- Perceived accuracy: % of users rating "these gaps are right" 4+ of 5 (target 75%).
- Completion: % starting a path who finish step 1 within 7 days.
- Growth: organic sessions from SEO pages; waitlist -> signup conversion.
- Quality: parse accuracy and gap precision/recall from the eval harness, tracked per release.
- Cost: AI cost per completed analysis.

## 14. Acceptance criteria (MVP)

- A new user can upload a resume, correct the parse, pick a role, and receive a gap analysis whose every gap cites resume evidence.
- The upskilling path contains only catalog resources with healthy links, within the user's weekly hours.
- Eval suite passes agreed thresholds (set in Phase 0) and runs in CI.
- Account deletion removes resume files, profiles and analyses within 24 hours.
- Lighthouse accessibility 95+ on the main screens; keyboard-only flow completes the full route.
- No resume content appears in logs or analytics.

## 15. Open questions (decide before Phase 1)

- **OQ-1: Market data source.** Where do role profiles and later listings come from: licensed data, partnerships, user-pasted job descriptions, or careful public sources? Scraping job boards likely violates their terms; do not build on it without legal review. This is the biggest product risk.
- **OQ-2: Monetization.** Free gap analysis plus paid path/interview pack, or subscription? Decide before building billing (Razorpay for India).
- **OQ-3: B2C first or B2B first?** The landing page shows both; engineering effort in Phase 1 should serve only one.
- **OQ-4: Domain experts.** Who reviews role profiles and eval labels so quality is real, not just plausible?
- **OQ-5: Resource catalog.** Who curates and maintains the courses and links, and how are affiliate relationships handled?

## 16. Claude Code working agreements

- Plan first (plan mode) for any feature touching the data model, auth, or AI pipeline; get approval before implementing.
- Write the schema (Zod/DB) and the eval cases before the prompt.
- Small PRs, one feature each; run lint, typecheck, tests and evals before declaring done.
- Never commit secrets or real resumes; use synthetic fixtures in `/fixtures`.
- Keep prompts in `/prompts` with version numbers; log prompt version on every AI call.
- Update this file when a requirement changes; it is the contract.
