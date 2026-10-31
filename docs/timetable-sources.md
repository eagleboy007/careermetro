# Timetable event sources: terms read

The record of each event feed's terms, kept for `src/content/event-feeds.json` (Timetable PR 4, `docs/plans/timetable-plan.md` section 6). A feed goes on (`"on": true`) only once someone has read its terms, found that they allow reuse of event listings, and written here the page read, the date, what it says and the conclusion. The same date goes in the feed's `termsReadOn`; the content test refuses a feed that is on without one.

Data research's source review (`data/events/sources-2026-10-30.md` in the project files) is the starting point. It does not count as reading the terms: it says itself that FOSS United's terms text was not seen and that confs.tech's licence came from an index, not the repo.

## FOSS United (`foss-united`): off

- **Feed:** `https://fossunited.org/api/method/fossunited.api.chapter.upcoming_events_ics` (iCalendar, upcoming chapter events). The RSS timeline on `platform.fossunited.org` is not used.
- **Page tried, 2026-10-31:** `https://fossunited.org/terms` (Terms of Service). The host itself could not be reached, so its privacy, API and events pages could not be read either.
- **What they say:** not read. The build session could not reach `fossunited.org` at all (its network blocks the host), so no terms text was seen. Data research saw a "CC-BY-SA" footer on the site and a Terms of Service link, but not the terms themselves.
- **Conclusion:** off until the terms are read. Before turning it on: read the Terms of Service page in full, check that it allows reuse of event listings (title, time, place and link) by a commercial service, and note the attribution it asks for (likely "FOSS United, CC BY-SA" with a link to each event). Then fill in this section with the URL, the date, a quote of the relevant line and the conclusion, set `termsReadOn` and `on` in `src/content/event-feeds.json`, and open a PR. Asking foundation@fossunited.org is the fallback if the terms are silent; that email is Milin's call.

## confs.tech conference data (`confs-tech`): off

- **Feed:** JSON files per topic and year from `https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/{year}/<topic>.json` (12 topics, this year and next).
- **Page tried, 2026-10-31:** `https://github.com/tech-conferences/conference-data/blob/main/LICENSE`.
- **What it says:** not read. The build session could not reach `github.com` or `raw.githubusercontent.com` for this repository. Data research reports the licence as MIT from the ecosyste.ms index and a wrapper package, and asked for the LICENSE file to be confirmed.
- **Conclusion:** off until the LICENSE file is read. If it is MIT, reuse is allowed with the copyright and permission notice kept; we show only our own short summary and the conference's own link, so a credit line ("Conference data: confs.tech, MIT") on `/timetable` would cover it. Also check that the branch is `main` and the 12 topic file names in `event-feeds.json` exist; a missing file counts as empty.

## Hand-entered events (`src/content/manual-events.json`): on

Events the team types in from organisers' own pages, for events no feed we may read lists. They change only by editing `src/content/manual-events.json` in a pull request; `/admin/reports` lists them read only with their link, checked date and whether each is live ("Added by the team from organisers' own pages").

- **What qualifies:** a tech event in a profile city (`PERSON_CITIES`) or online, whose date, time and place are on the organiser's own page (the group's or conference's site, or its chapter page on its own platform, such as `gdg.community.dev` or `hasgeek.com`), with at least one skill from `skills.json` as a topic. Official notices count the same way (NPTEL and SWAYAM semester dates). Never a listing or job site: LinkedIn, Naukri, Indeed, Glassdoor, AmbitionBox, Wellfound, Meetup, Luma, Townscript, Allevents or Eventbrite (`EVENT_LISTING_HOSTS`; the schema and the content test refuse them). Never a page that needs a sign-in, and never a payment link.
- **What is typed:** title, organiser, kind, start and end in India time (`+05:30`), online or city and area (no street address), cost in words (`""` when the page names none), skill topics, the https link to that page, `checkedOn` and `dateEvidence`. `dateEvidence` is a short quote of the date from the page; it stays in the file and is never stored in the database, shown or logged.
- **checkedOn rule:** `checkedOn` is the day someone last read the date on the organiser's page, and it can't be after the event starts. When the page and another official page disagree, or the page says it isn't final, the event waits until they agree.
- **Recheck before the date:** reread each page in the week before its event, and again whenever a page changes. A changed date or place is edited in the file with a new `checkedOn`; a cancelled event is taken out of the file. The daily feed then cancels it, as long as the whole file still passes its checks (a file that fails loads the entries that pass and cancels nothing). Changing an event's title or start date gives it a new key, so the old row is cancelled and a new one goes live.
- **How it loads:** the daily event feed (`/api/cron/events-feed`) reads the file on every run, with no network call, as admin suggestions already checked (`source = suggestion`, `source_key = manual:<title slug>-<India start date>`, live). The file's skill topics are kept and the interest topics found in the title are added. Events that have ended are left out.
- **Loaded 2026-10-31:** 9 events from Data research's `data/events/manual-2026-11.json` (Rootconf, Cloud Community Days Mumbai, two Bengaluru DevFests run by different groups on different dates, Pre DevFest and DevFest Kolkata, The Fifth Elephant, DevFest Pune and SciPy India), each checked on 2026-10-31.
- **Held until the date is confirmed:** DevFest Nagpur 2026 (GDG Cloud Nagpur). The event page says 5 December and is marked "not ready"; the GDG Nagpur chapter page lists 12 December. It goes in once both pages agree.

## Never used

Meetup (API needs Pro; commercial use needs written consent), Microsoft Reactor and Learn events (non-commercial only), NASSCOM FutureSkills Prime (no reproduction without consent), and LinkedIn, Naukri, Indeed, Glassdoor, AmbitionBox and Wellfound. Luma calendars of local groups (AWS User Group Pune, MumPy, GDG Cloud Mumbai) and the null community chapters need each organiser's written OK first; asking them is Milin's call, and none of them is in `event-feeds.json`.
