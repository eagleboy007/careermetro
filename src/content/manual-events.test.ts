import { describe, expect, it } from "vitest";
import { manualEventsJson, skills } from "@/content";
import { isListingHost, manualEventsFile, manualKey } from "@/lib/schemas";
import { EVENT_LISTING_HOSTS, PERSON_CITIES } from "@/lib/schemas/constants";

// The hand-entered Timetable events (docs/timetable-sources.md): typed in by the team from organisers' own pages.
describe("hand-entered events (src/content/manual-events.json)", () => {
  const events = manualEventsFile.parse(manualEventsJson);
  const skillIds = new Set(skills.map((s) => s.id));

  it("parses as a whole, each event once by its key", () => {
    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events.map(manualKey)).size).toBe(events.length);
    for (const e of events) expect(manualKey(e)).toMatch(/^manual:[a-z0-9]+(-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}$/);
  });

  it("names only skills in the taxonomy and profile cities", () => {
    for (const e of events) {
      for (const t of e.topics) expect(skillIds.has(t), `${manualKey(e)}: ${t}`).toBe(true);
      if (!e.online) expect(PERSON_CITIES).toContain(e.city);
      else expect(e.city).toBeNull();
    }
  });

  it("links to the organiser's own https page, never a listing or job site", () => {
    const banned = /linkedin|naukri|indeed|glassdoor|ambitionbox|wellfound|meetup|lu\.ma|luma\.com|townscript|allevents|eventbrite/i;
    for (const e of events) {
      expect(new URL(e.sourceUrl).protocol).toBe("https:");
      expect(e.sourceUrl).not.toMatch(banned);
      expect(isListingHost(e.sourceUrl)).toBe(false);
    }
  });

  it("is in India time, with the day each date was checked and a short quote of it", () => {
    for (const e of events) {
      expect(e.startsAt.endsWith("+05:30") && e.endsAt.endsWith("+05:30")).toBe(true);
      expect(e.checkedOn <= e.startsAt.slice(0, 10)).toBe(true);
      expect(e.dateEvidence.length).toBeGreaterThan(0);
    }
  });

  it("holds Data research's 8 events of November 2026, both Bengaluru DevFests, not DevFest Nagpur and no sponsor deck", () => {
    expect(events).toHaveLength(8);
    const devfests = events.filter((e) => e.city === "Bengaluru" && /devfest/i.test(e.title));
    expect(devfests.map((e) => [e.organiser, e.startsAt.slice(0, 10)]).sort()).toEqual([
      ["GDG Bangalore", "2026-12-05"],
      ["GDG Cloud Bengaluru", "2026-11-21"],
    ]);
    // Held until its date is confirmed: the event page and the chapter page disagree (docs/timetable-sources.md).
    expect(events.some((e) => /nagpur/i.test(e.title) || e.city === "Nagpur")).toBe(false);
    // The Fifth Elephant is held until it has an edition page: its only link was a sponsor deck (T175).
    expect(events.filter((e) => /sponsor/i.test(e.sourceUrl))).toEqual([]);
  });

  it("keeps India times that match a UTC range quoted in the evidence (T175)", () => {
    const utc = /(\d{1,2}):(\d{2}) to (\d{1,2}):(\d{2}) (AM|PM) UTC/;
    const minutes = (h: string, m: string, half: string) => ((Number(h) % 12) + (half === "PM" ? 12 : 0)) * 60 + Number(m);
    const ist = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
    for (const e of events) {
      const m = utc.exec(e.dateEvidence);
      if (!m) continue;
      const [, sh, sm, eh, em, half] = m;
      const startUtc = minutes(sh, sm, half);
      // "3:00 to 11:00 AM": an end hour below the start hour is past noon.
      const endUtc = minutes(eh, em, Number(eh) % 12 < Number(sh) % 12 ? "PM" : half);
      expect([ist(e.startsAt), ist(e.endsAt)], manualKey(e)).toEqual([startUtc + 330, endUtc + 330]);
    }
  });

  it("refuses a listing site, a time outside India time, the same event twice and a topic twice", () => {
    const one = events[0];
    for (const host of EVENT_LISTING_HOSTS) {
      expect(manualEventsFile.safeParse([{ ...one, sourceUrl: `https://${host}/e/1` }]).success, host).toBe(false);
      expect(manualEventsFile.safeParse([{ ...one, sourceUrl: `https://www.${host}/e/1` }]).success, host).toBe(false);
    }
    expect(manualEventsFile.safeParse([{ ...one, sourceUrl: "http://example.org/e" }]).success).toBe(false);
    expect(manualEventsFile.safeParse([{ ...one, startsAt: "2026-11-13T03:30:00Z" }]).success).toBe(false);
    expect(manualEventsFile.safeParse([one, one]).success).toBe(false);
    expect(manualEventsFile.safeParse([{ ...one, topics: ["python", "python"] }]).success).toBe(false);
    expect(manualEventsFile.safeParse([{ ...one, online: true }]).success).toBe(false);
    expect(manualEventsFile.safeParse([{ ...one, extra: 1 }]).success).toBe(false);
  });
});
