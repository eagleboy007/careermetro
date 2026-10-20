# Hardening pass: e2e and accessibility on #175 to #193 (2026-10-20)

Keyless: no migration, no new screens, no copy changes. The new e2e steps sit together at the end of `e2e/walk.mjs`
(the `hardening:` steps), just before the summary, so they rebase cleanly over the Today Track picker branch (#195).
Every dark check reloads after `emulateMedia` so colours are drawn dark from the start. Phone fit means
`document.documentElement.scrollWidth <= innerWidth` at 390 px.

## Inventory

"Before" is what the walk on `origin/main` (fb76af1) checked. "e2e step" names the existing step that reaches the
screen.

| Screen | PR | e2e step | Light / dark axe | Phone | Keyboard | Gaps found | What we did |
|---|---|---|---|---|---|---|---|
| Today, No resume: role chips, drop zone, reading steps | #175 | "fresh test user, no resume" (loads only) | none / none | none | none | No axe, phone or keyboard; the file box (an `sr-only` input in the drop zone) showed no focus ring | New step: Space and Enter on the chips, Tab between them, Paste text and back by keyboard, Tab reaches the file box and it shows a ring; axe light, dark (reload) and phone; 390 px in both schemes. Drop zone gets `focus-within` ring |
| Top bar Network and Library, Arrivals count, avatar menu with @username; Me's Resume card; Practice round; /elite links | #176 | "elite: turn it on" (menu axe light, Escape pressed); "open /me"; Arrivals interview steps | light / Arrivals only | Arrivals only | Escape pressed, focus return not checked | Avatar menu: no dark, no phone, no check that focus goes back to the avatar | New step: Enter opens the menu, Tab lands on Your profile, Escape closes it with focus on the avatar; light, dark and 390 px dark with Network and Library in the menu |
| Settings Privacy (Connection requests from, Who can open, Who sees what), Blocked people, Your plan | #177 | "account settings part 2"; "settings columns"; "elite" (Your plan) | light / dark (reload) | 360 px light | Save and Discard by click | No dark at phone width; Blocked people with a row is not reached (needs a block) | Phone sweep: /settings at 390 px dark with axe. Blocked people rows left to unit tests and /design |
| Departures: "Saw a role somewhere else?", Interview prep for this role | #178 | "departures: live roles…" (axe with the role open) | light / dark without reload | 390 px dark without reload | none needed (form fields and links) | The dark check skipped the reload | Fixed in place: reload, Saved tab again, closed row, 390 px fit, then axe |
| Builder review: Download PDF or DOCX | #179 | "builder: seven sections…" | light / dark without reload | 390 px light and dark | button by click | Dark is not reloaded, on purpose: the review lives in the page's state and a reload drops it (comment in the step) | Left as is; reviewer to decide |
| Job search switch, paused pages, notice card | #180 | "job search: off pauses…" | light / none | none | switch by click; focus stays on a switch | No dark, no phone, no keyboard on the switch | New step: Arrivals' notice card at 390 px dark with axe; on Departures Space turns job search off, focus is on the paused page's switch, dark axe after reload, 390 px fit, Space turns it back on; `finally` turns it on if a check failed |
| Map Life line (links, certificates, legend), Map copy, Match's N open jobs | #181 | none for the Life line; "match" (light) | Life line none; Match light | none | none | The Life line had no e2e at all; Match had no dark or phone | New step: Enter on Life line, Enter on a moment opens its panel; axe light, dark (fresh load) and 390 px dark. Match added to the phone sweep |
| Network Report, Find people filters; profile In common and Report | #182 | "open /network" (light); "notifications" opens a profile without axe | light / none | none | none | No dark, phone or keyboard; Cancel on Report, Block, Remove, Withdraw, Message and Connect dropped focus to the page; the Find people search box had `outline-none` and no ring | New steps: on a profile, Enter on Report focuses the first reason, Tab reaches Send report and Cancel, Cancel gives focus back to Report; the same for Connect; light, dark (reload) and 390 px both schemes. On /network, arrow keys reach Find people, Tab reaches the search box (ring checked), Search and a filter, Space toggles it; dark and 390 px. Fixes below |
| Arrivals: Offers group, Add to calendar; Settings Language | #183 | "corporate applications…"; "interviews…" | light / dark (reload) | 390 px dark | Accept and Not now focus checked | Add to calendar isn't pressed: the walk's interview is cancelled later, and a fresh one needs a company set-up | Left: it is a native button with a full aria-label |
| Departures live feed, Saved, Applied, closed roles | #184 | "departures: live roles…" | light / dark without reload | 390 px | Did you apply? by click | As #178 | Fixed with #178 |
| Library part 2: Save, I finished this, rides, Report a broken link, Suggest; /admin/library | #185 | "library: …"; "library review: …" | light per tab / dark via a fresh load (library), reload (admin) | 390 px dark | none | The broken-link menu had no Escape | Fix: Escape closes the reasons and puts focus back on its button. New step checks Enter, Tab into the reasons, Escape and focus return |
| Departures feed and board scripts | #186, #187, #189 | none needed | — | — | — | No screens | — |
| Me editing: roles, education, stories, interests | #188 | "me editing: …" | light / dark (reload) | 360 px | Cancel and Keep focus return checked | none | — |
| Notifications bell and panel | #190 | "notifications: …" | light / dark without reload | 360 px light and dark | Escape gives focus to the bell, checked | The dark check skipped the reload | Fixed in place: reload before opening the panel in each scheme |
| Mock interview follow-ups | #191 | "mock interview: a full round…" | light / none | none | none | No dark or phone on the round | Phone sweep covers /mock (the Free bank) in dark at 390 px. The round itself in dark needs Elite and a round in progress: left |
| Settings columns: message requests, Open to work in, Usually free | #192 | "settings columns: …" | light / dark (reload) | none | chips by click | No phone | Phone sweep: /settings and /inbox at 390 px dark. Usually free sits in a chat's panel, so the sweep doesn't open it |
| Today live cards: Signal check, board, On your line | #193 | "today: live signal check…"; "phone + dark today" | light / dark via a fresh load | 390 px dark | none | Signal check by keyboard not checked | Left for after #195, which edits Today |

## Static review of the components these PRs added

Checked: labels on controls, hints by `aria-describedby`, `aria-live` and `role="status"` only on lines that change,
buttons not divs, focus rings, tokens only, cobalt for progress, touch targets, lucide `strokeWidth={1.75}` and
`aria-hidden` on decorative icons.

- Icons: every lucide icon in the 33 files has `strokeWidth={1.75}`; the few without their own `aria-hidden` sit inside
  an `aria-hidden` span.
- Colours: no literal colours. The only arbitrary values are dashed gradients built from `var(--muted)` and
  `var(--accent)`.
- Click handlers are on buttons and links, except the Life line's SVG moments, which are `role="button"` with
  `tabIndex={0}` and Enter and Space.
- Touch targets: the smallest new controls (notice days, Practice a mock round, the job search buttons) are about
  29 to 33 px high, over 24 px.
- Contrast, from `src/app/globals.css`, small text (AA 4.5:1), light / dark:
  muted on surface-2 5.47 / 6.43; muted on bg 5.78 / 7.53; muted on accent-soft 5.31 / 5.74; muted on warn-soft
  5.62 / 5.43; muted on elite-soft 5.29 / 5.88; accent on accent-soft 5.33 / 5.30; elite on elite-soft 5.29 / 6.51;
  good on good-soft 4.67 / 6.72; warn on warn-soft 4.96 / 7.55; bad on bad-soft 4.71 / 6.32; board-dim on board
  5.93 / 6.51; on-elite on elite 6.30 / 8.24. Control edges, line-strong on surface 3.61 / 3.50 and on surface-2
  3.13 / 3.22 (3:1 for non-text). All pass. Faded text (`opacity-55`, `-60`, `-70`) is used only on disabled or
  `aria-disabled` controls, which WCAG exempts.

### Fixes made

1. `src/components/network/network-view.tsx`: Cancel on a person's Connect, Message, Remove, Withdraw, Block and Report
   panels puts focus back on the button that opened it (`data-opens`, moved in an effect keyed on a counter), instead
   of dropping it to the page.
2. `src/components/network/profile-connect.tsx`: the same on a profile.
3. `src/components/network/network-view.tsx`: the Find people search box shows a focus ring (`focus-within` outline on
   its label, as Departures' and the Library's search boxes do).
4. `src/components/resume/upload-form.tsx`: the drop zone shows a focus ring when its file input has focus.
5. `src/components/library/library-view.tsx`: Escape closes "Link broken or out of date?" and puts focus back on it.

### Seen, not changed

- No resume hero: "your resume." is set in `text-accent`, cobalt used for emphasis rather than progress. It is from the
  prototype (since 2026-10-13); a design call.
- The upload form's error line is `text-bad`, red outside gap status (since 2026-10-13); other forms use `text-ink`.
- Signal check marks the right answer with `accent`; it reads as progress, so it stays.
- The `Switch` hint is inside its label, so it is read as part of the name rather than as a description. Changing it
  would change names the walk matches on.
