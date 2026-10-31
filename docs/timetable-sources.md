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

## Never used

Meetup (API needs Pro; commercial use needs written consent), Microsoft Reactor and Learn events (non-commercial only), NASSCOM FutureSkills Prime (no reproduction without consent), and LinkedIn, Naukri, Indeed, Glassdoor, AmbitionBox and Wellfound. Luma calendars of local groups (AWS User Group Pune, MumPy, GDG Cloud Mumbai) and the null community chapters need each organiser's written OK first; asking them is Milin's call, and none of them is in `event-feeds.json`.
