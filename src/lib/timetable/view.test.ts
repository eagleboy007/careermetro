import { describe, expect, it } from "vitest";
import { eventCard, eventTeaser, timetableView, type EventCard, type TimetableGroup } from "@/lib/schemas";
import { exampleTimetable, exampleTimetableEmpty, exampleTimetableEvents, exampleTimetableNoCity } from "./fixtures";
import { dateBlock, eventPlace, eventWhen, namesLine, shownGroups, teaserRows } from "./view";

// Synthetic cards only.
let n = 0;
const card = (over: Partial<EventCard> = {}): EventCard => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  title: "Hunting with a SIEM",
  organiser: "Example Security Circle",
  kind: "meetup",
  startsAt: "2026-10-17T11:30:00.000Z",
  endsAt: "2026-10-17T14:30:00.000Z",
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

describe("dateBlock and eventWhen", () => {
  it("reads the date and times in IST, whatever the server's zone", () => {
    expect(dateBlock("2026-10-17T11:30:00Z")).toEqual({ weekday: "Sat", day: 17, month: "Oct" });
    // 00:30 IST on 1 November.
    expect(dateBlock("2026-10-31T19:00:00Z")).toEqual({ weekday: "Sun", day: 1, month: "Nov" });
  });

  it("writes one day's times as the prototype does, and a span of days by date", () => {
    expect(eventWhen("2026-10-17T11:30:00Z", "2026-10-17T14:30:00Z")).toBe("5 to 8 pm IST");
    expect(eventWhen("2026-10-25T04:30:00Z", "2026-10-25T06:30:00Z")).toBe("10 am to 12 pm IST");
    expect(eventWhen("2026-10-13T13:00:00Z", "2026-10-13T15:00:00Z")).toBe("6:30 to 8:30 pm IST");
    expect(eventWhen("2026-10-13T13:30:00Z", "2026-10-13T13:30:00Z")).toBe("7 pm IST");
    expect(eventWhen("2026-11-13T03:30:00Z", "2026-11-14T12:30:00Z")).toBe("13 to 14 Nov");
    expect(eventWhen("2026-11-30T03:30:00Z", "2026-12-01T12:30:00Z")).toBe("30 Nov to 1 Dec");
  });
});

describe("eventPlace", () => {
  it("says Online, the area with its city once, and how far beyond 25 km", () => {
    expect(eventPlace(card({ online: true, city: null, venue: null, distanceKm: null }))).toBe("Online");
    expect(eventPlace(card())).toBe("Baner, Pune");
    expect(eventPlace(card({ venue: "Kothrud" }))).toBe("Kothrud, Pune");
    expect(eventPlace(card({ venue: null }))).toBe("Pune");
    expect(eventPlace(card({ city: "Noida", venue: "Sector 62", distanceKm: 18 }))).toBe("Sector 62, Noida");
    expect(eventPlace(card({ city: "Faridabad", venue: null, distanceKm: 31 }))).toBe("Faridabad · 31 km away");
  });
});

describe("shownGroups", () => {
  const goal = card();
  const interest = card({ tags: [{ kind: "interest", topic: "ai", label: "Interest: AI" }] });
  const both = card({ tags: [goal.tags[0], interest.tags[0]] });
  const online = card({ online: true, city: null, venue: null, distanceKm: null });
  const far = card({ city: "Faridabad", venue: null, distanceKm: 31 });
  const groups: TimetableGroup[] = [
    { key: "week", label: "This week", events: [goal, interest, both] },
    { key: "later", label: "Later this month", events: [online, far] },
  ];
  const all = { filter: "all" as const, online: true, far: false, radiusKm: 25 };
  const ids = (r: ReturnType<typeof shownGroups>) => r.groups.flatMap((g) => g.events.map((e) => e.id));

  it("shows every match within the saved radius and counts the ones beyond it", () => {
    const r = shownGroups(groups, all);
    expect(ids(r)).toEqual([goal.id, interest.id, both.id, online.id]);
    expect(r.outside).toBe(1);
    expect(r.total).toBe(4);
  });

  it("shows the ones beyond 25 km with Show outside 25 km, up to 100", () => {
    const r = shownGroups(groups, { ...all, far: true });
    expect(ids(r)).toContain(far.id);
    expect(r.outside).toBe(0);
    expect(shownGroups([{ key: "week", label: "This week", events: [card({ distanceKm: 140, city: "Mumbai" })] }], { ...all, far: true }).outside).toBe(1);
  });

  it("keeps only goal or only interest cards, with only those tags", () => {
    const goals = shownGroups(groups, { ...all, filter: "goals" });
    expect(ids(goals)).toEqual([goal.id, both.id, online.id]);
    expect(goals.groups[0].events[1].tags.map((t) => t.kind)).toEqual(["goal"]);
    const interests = shownGroups(groups, { ...all, filter: "interests" });
    expect(ids(interests)).toEqual([interest.id, both.id]);
    // A group left empty goes.
    expect(interests.groups.map((g) => g.key)).toEqual(["week"]);
  });

  it("drops online events with Include online off", () => {
    expect(ids(shownGroups(groups, { ...all, online: false }))).not.toContain(online.id);
  });

  it("works from a saved 100 km radius without the switch", () => {
    expect(shownGroups(groups, { ...all, radiusKm: 100 }).outside).toBe(0);
  });
});

describe("teaserRows", () => {
  it("gives Today the first two cards as a date block, the title and place, time and first tag", () => {
    const rows = teaserRows([card(), card({ online: true, city: null, venue: null, distanceKm: null }), card()]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ day: "Sat", date: 17, title: "Hunting with a SIEM", detail: "Baner, Pune · 5 to 8 pm IST · Goal: SIEM and log analysis" });
    expect(rows[1].detail.startsWith("Online · ")).toBe(true);
    for (const r of rows) expect(eventTeaser.safeParse(r).error).toBeUndefined();
    expect(teaserRows([])).toEqual([]);
  });

  it("keeps a long title and cuts a long detail to fit", () => {
    const long = card({ title: "T".repeat(160), venue: "V".repeat(120) });
    const [row] = teaserRows([long]);
    expect(row.detail.length).toBeLessThanOrEqual(120);
    expect(eventTeaser.safeParse(row).error).toBeUndefined();
  });
});

describe("namesLine", () => {
  it("names a few, then counts the rest", () => {
    expect(namesLine(["SIEM", "Python"])).toBe("SIEM, Python");
    expect(namesLine(["a", "b", "c", "d"], 2)).toBe("a, b and 2 more");
    expect(namesLine([])).toBe("");
  });
});

describe("example timetable", () => {
  it("is a valid view that shows only the example person's matches", () => {
    for (const v of [exampleTimetable, exampleTimetableNoCity, exampleTimetableEmpty]) expect(timetableView.safeParse(v).error).toBeUndefined();
    const titles = exampleTimetable.groups.flatMap((g) => g.events.map((e) => e.title));
    expect(titles).not.toContain("Weekend cricket for tech teams");
    expect(titles).toContain("Hunting with a SIEM: hands-on lab night");
    // Mumbai is about 120 km from Pune, beyond even Show outside 25 km.
    expect(exampleTimetable.outsideRadius).toBe(1);
    expect(exampleTimetableNoCity.groups.flatMap((g) => g.events).every((e) => e.online)).toBe(true);
    expect(exampleTimetableEmpty.groups).toEqual([]);
    for (const e of exampleTimetable.groups.flatMap((g) => g.events)) expect(eventCard.safeParse(e).error).toBeUndefined();
    expect(exampleTimetableEvents.length).toBeGreaterThan(titles.length);
  });
});
