# CareerMetro docs

Every confirmed design, plan and decision is kept here as a file, so nothing has to be dug out of chats. The same files are kept in the project's shared folder (`careermetro/` in the CareerMetro project), whose own index is `README-files.md`. When a design or plan changes, update both copies. Nothing is deleted from one copy without deleting it from the other.

## Rules and requirements

| File | What it is |
|---|---|
| `../CLAUDE.md` | Decisions already made, design rules, working agreements |
| `REQUIREMENTS.md` | Product requirements, the contract for all work |

## Design

| File | What it is | Published page |
|---|---|---|
| `design/careermetro-prototype-v2.html` | Post-login prototype v2, the fixed design for the signed-in app. Sources in `design/prototype-v2/source/` (`build.py` joins the parts) | https://claude.ai/artifact/WK113KMpYfq9FnmCPVXTFP |
| `design/post-login-handoff.md` | Build handoff for the signed-in app: screens, rules, fonts, tokens, build order | |
| `design/careermetro-corporate-v1.html` | Corporate (recruiter and HR) mockup v1. Sources in `design/corporate-mockup/source/` | https://claude.ai/artifact/X7dXtu2tpBaFD4KXm91PUk |
| `design/vision-map-v1.html` | Vision map, the pinned roadmap | https://claude.ai/artifact/UEfCX14mCSxL88qANMPxYk |
| `design/design-concept-v1.html` | First design concept: light, cobalt accent, plain step names | https://claude.ai/artifact/YEx76YhvpZXKQWy9VowzFy |
| `design/careermetro.html` | Original landing page prototype (marketing only) | |
| `design/post-login-home-v1.html` | Post-login home v1, card dashboard (rejected, kept for history) | https://claude.ai/artifact/L3uVYuyJH4rUUh829Vv3iJ |
| `design/post-login-home-fable-v1.html` | Post-login home exploration that led to v2 (kept for history) | |

## Brand (logo choice between A and B is pending)

| File | What it is | Published page |
|---|---|---|
| `brand/careermetro-brand.html`, `brand/*.svg` | Brand book and logo option A, the line. Sources in `brand/source/` (`gen.py` makes the SVGs, `page.py` the page) | https://claude.ai/artifact/79WUkGc2L7bRtRYK25JULK |
| `brand/concept-b/careermetro-logo-b.html`, `brand/concept-b/*.svg` | Logo option B, the board. Sources in `brand/concept-b/source/` | https://claude.ai/artifact/QatLEG7s2HaNMxaYXKZF3U |

## Plans

| File | What it is |
|---|---|
| `plans/phase-1-resume-plan.md` | Phase 1 plan: Resume |
| `plans/phase-1-gaps-plan.md` | Phase 1 plan: Gaps |
| `plans/phase-1-path-plan.md` | Phase 1 plan: Path |
| `plans/platform-plan-accounts-to-network.md` | Plan from accounts to the network (Practice, Match, portal) |
| `plans/signin-plan.md` | Sign-in plan (Supabase Auth) |
| `plans/signin-setup-steps.md` | Sign-in setup steps only Milin can do (Google, Supabase, Vercel) |
| `plans/pending-items.md` | Pending and future items |

The development plan is a Claude Doc: https://claude.ai/code/artifact/f5b7ea02-21cb-4efe-817a-32664252271d

## Expert review sheets

| File | What it is |
|---|---|
| `review/role-profiles-v1-review.csv` | Role profiles v1 for domain expert review |
| `review/resource-catalog-review.csv` | Learning resource catalog for review |
| `review/eval-set-v1-review.csv` | Synthetic eval resumes and expected gaps for review |
