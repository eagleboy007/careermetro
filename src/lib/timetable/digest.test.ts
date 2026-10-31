import { describe, expect, it } from "vitest";
import { eventsDigestView, type EventCard } from "@/lib/schemas";
import { EVENTS_DIGEST_EVENTS_MAX } from "@/lib/schemas/constants";
import { DIGEST_GAP_NOTE, digestEmail, digestSubject, digestView, digestWhen } from "./digest";

// Synthetic cards only: every organiser, link and event here is made up.
// Monday 2 Nov 2026, 07:00 IST.
const MONDAY = new Date("2026-11-02T01:30:00Z");
let n = 0;
const card = (over: Partial<EventCard> = {}): EventCard => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  title: "Hunting with a SIEM",
  organiser: "Example Security Circle",
  kind: "meetup",
  // Sat 7 Nov, 6 to 8 pm IST.
  startsAt: "2026-11-07T12:30:00.000Z",
  endsAt: "2026-11-07T14:30:00.000Z",
  online: false,
  city: "Pune",
  venue: "Baner, Pune",
  cost: "Free",
  sourceUrl: "https://events.example.org/siem",
  tags: [{ kind: "goal", topic: "siem", label: "Goal: SIEM and log analysis" }],
  distanceKm: 0,
  rsvp: null,
  ...over,
});
const hoursFrom = (at: Date, h: number) => new Date(at.getTime() + h * 3600_000).toISOString();

describe("digestWhen", () => {
  it("gives the day and the times in IST, and a span of days by date only", () => {
    expect(digestWhen("2026-11-07T12:30:00Z", "2026-11-07T14:30:00Z")).toBe("Sat 7 Nov, 6 to 8 pm IST");
    // 00:30 IST on Sunday 8 November.
    expect(digestWhen("2026-11-07T19:00:00Z", "2026-11-07T20:00:00Z")).toBe("Sun 8 Nov, 12:30 to 1:30 am IST");
    expect(digestWhen("2026-11-13T03:30:00Z", "2026-11-14T12:30:00Z")).toBe("13 to 14 Nov");
  });
});

describe("digestView: what goes in", () => {
  it("is empty, so no email, when nothing matches in the next 7 days", () => {
    expect(digestView([], MONDAY)).toBeNull();
    // Started already (the screen's two-hour grace doesn't count here), and 7 days or more away.
    expect(digestView([card({ startsAt: hoursFrom(MONDAY, -1), endsAt: hoursFrom(MONDAY, 1) }), card({ startsAt: hoursFrom(MONDAY, 7 * 24), endsAt: hoursFrom(MONDAY, 7 * 24 + 2) })], MONDAY)).toBeNull();
  });

  it("lists the soonest five, in start order, and counts the rest", () => {
    const cards = Array.from({ length: 8 }, (_, i) => card({ title: `Event ${i + 1}`, startsAt: hoursFrom(MONDAY, 10 + i), endsAt: hoursFrom(MONDAY, 12 + i) }));
    const view = digestView(cards, MONDAY)!;
    expect(view.week).toBe("2026-11-02");
    expect(view.events).toHaveLength(EVENTS_DIGEST_EVENTS_MAX);
    expect(view.events.map((e) => e.title)).toEqual(["Event 1", "Event 2", "Event 3", "Event 4", "Event 5"]);
    expect(view.more).toBe(3);
    expect(eventsDigestView.safeParse(view).success).toBe(true);
  });

  it("names the city or Online, the organiser and the organiser's link, and nobody else", () => {
    const view = digestView([card(), card({ online: true, city: null, venue: null, distanceKm: null, title: "Detection rules, online" })], MONDAY)!;
    expect(view.events).toEqual([
      { title: "Hunting with a SIEM", organiser: "Example Security Circle", when: "Sat 7 Nov, 6 to 8 pm IST", place: "Pune", sourceUrl: "https://events.example.org/siem" },
      { title: "Detection rules, online", organiser: "Example Security Circle", when: "Sat 7 Nov, 6 to 8 pm IST", place: "Online", sourceUrl: "https://events.example.org/siem" },
    ]);
    expect(view.more).toBe(0);
  });

  it("drops a card that can't be listed safely instead of failing the person's digest", () => {
    const view = digestView([card({ title: "Bad <b>title</b>" }), card({ title: "Fine" })], MONDAY)!;
    expect(view.events.map((e) => e.title)).toEqual(["Fine"]);
  });

  it("works out the week on Tuesday's catch-up as that India week's Monday", () => {
    const tuesday = new Date("2026-11-03T01:30:00Z");
    expect(digestView([card()], tuesday)!.week).toBe("2026-11-02");
  });
});

describe("the digest email", () => {
  const site = "https://careermetro.test";
  const offUrl = `${site}/api/email/off?t=${"T".repeat(43)}&k=events`;
  const view = digestView([card(), card({ title: "Logs & alerts <101>", online: true, city: null, venue: null, distanceKm: null })], MONDAY)!;

  it("has a plain subject with the count", () => {
    expect(digestSubject(view)).toBe("2 events in the next 7 days for your goals and interests");
    expect(digestSubject({ ...view, events: view.events.slice(0, 1), more: 0 })).toBe("1 event in the next 7 days for your goals and interests");
    expect(digestSubject({ ...view, more: 4 })).toBe("6 events in the next 7 days for your goals and interests");
  });

  it("says the same words in text and HTML, with the organiser's link, the Timetable link and a one-tap off link", () => {
    const email = digestEmail(view, { name: "Priya", site, offUrl });
    expect(email.subject).toBe(digestSubject(view));
    for (const words of ["Priya, your events for the week.", "Hunting with a SIEM", "Example Security Circle", "Sat 7 Nov, 6 to 8 pm IST", "Pune", "Online", DIGEST_GAP_NOTE]) {
      expect(email.text).toContain(words);
    }
    expect(email.text).toContain("https://events.example.org/siem");
    expect(email.text).toContain(`${site}/timetable`);
    expect(email.text).toContain(`Turn it off (no sign-in): ${offUrl}`);
    expect(email.html).toContain("Hunting with a SIEM");
    expect(email.html).toContain('href="https://events.example.org/siem"');
    expect(email.html).toContain(`href="${site}/timetable"`);
    expect(email.html).toContain(offUrl.replace(/&/g, "&amp;"));
    // Escaped, never raw markup from an event.
    expect(email.html).toContain("Logs &amp; alerts &lt;101&gt;");
    expect(email.html).not.toContain("<101>");
  });

  it("follows the other emails' look: ink links, no cobalt, and no name when we have none", () => {
    const email = digestEmail(view, { name: null, site, offUrl });
    expect(email.text.startsWith("Your events for the week.")).toBe(true);
    expect(email.html).toContain("CareerMetro · Timetable");
    expect(email.html).toContain("color:#12151c;font-weight:600");
    // The accent (cobalt) tokens never appear: progress only, and an email isn't progress.
    expect(email.html.toLowerCase()).not.toMatch(/#2448f5|#e6ebff|#7e94ff|cobalt|accent/);
  });

  it("says how many more are on the Timetable when it lists only five", () => {
    const email = digestEmail({ ...view, more: 3 }, { name: "Priya", site, offUrl });
    expect(email.text).toContain("3 more events on your Timetable.");
    expect(email.html).toContain("3 more events on your Timetable.");
  });
});
