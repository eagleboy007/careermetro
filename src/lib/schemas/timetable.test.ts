import { describe, expect, it } from "vitest";
import { EVENT_TOPICS_MAX, TIMETABLE_EVENTS_MAX } from "./constants";
import {
  cityCentre,
  cityCentresFile,
  DEFAULT_TIMETABLE_SETTINGS,
  eventCard,
  eventRow,
  eventRsvpExport,
  eventRsvpInput,
  eventTopic,
  eventTopicList,
  interestTopic,
  interestTopicsFile,
  timetableSettings,
  timetableView,
  timetableWhy,
  type EventCard,
} from "./timetable";

// Synthetic events only: every organiser here is made up.
const id = "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const at = new Date("2026-11-07T12:30:00Z");
const row = {
  id,
  source: "feed" as const,
  sourceKey: "foss-pune-2026-11-07",
  sourceUrl: "https://events.example.org/pune/nov",
  title: "Hunting with a SIEM",
  organiser: "Example Security Circle",
  kind: "meetup" as const,
  startsAt: at,
  endsAt: new Date(at.getTime() + 2 * 3600_000),
  online: false,
  city: "Pune" as const,
  venue: "Baner, Pune",
  cost: "Free",
  status: "live" as const,
  checkedAt: null,
  createdAt: at,
  updatedAt: at,
};
const card: EventCard = {
  id,
  title: "Hunting with a SIEM",
  organiser: "Example Security Circle",
  kind: "meetup",
  startsAt: "2026-11-07T12:30:00.000Z",
  endsAt: "2026-11-07T14:30:00.000Z",
  online: false,
  city: "Pune",
  venue: "Baner, Pune",
  cost: "Free",
  sourceUrl: "https://events.example.org/pune/nov",
  tags: [{ kind: "goal", topic: "siem", label: "Goal: SIEM and log analysis" }],
  distanceKm: 0,
  rsvp: null,
};

describe("eventRow", () => {
  it("takes a feed event as the table holds it", () => {
    expect(eventRow.safeParse(row).error).toBeUndefined();
    expect(eventRow.safeParse({ ...row, online: true, city: null, venue: null, kind: "online" }).success).toBe(true);
  });

  it("refuses what the table's checks refuse", () => {
    expect(eventRow.safeParse({ ...row, sourceUrl: "http://events.example.org/x" }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, endsAt: new Date(at.getTime() - 1) }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, online: true }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, title: "" }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, title: "x".repeat(161) }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, cost: "x".repeat(61) }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, city: "Atlantis" }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, status: "sponsored" }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, description: "kept?" }).success).toBe(false);
  });
});

describe("eventTopic", () => {
  it("takes a skill id or an interest key, each once, at most 100", () => {
    expect(eventTopic.safeParse({ kind: "skill", topic: "siem" }).success).toBe(true);
    expect(eventTopic.safeParse({ kind: "interest", topic: "open-source" }).success).toBe(true);
    expect(eventTopic.safeParse({ kind: "skill", topic: "Not A Key" }).success).toBe(false);
    expect(eventTopic.safeParse({ kind: "sponsor", topic: "siem" }).success).toBe(false);
    expect(eventTopicList.safeParse([{ kind: "skill", topic: "siem" }, { kind: "interest", topic: "siem" }]).success).toBe(true);
    expect(eventTopicList.safeParse([{ kind: "skill", topic: "siem" }, { kind: "skill", topic: "siem" }]).success).toBe(false);
    const many = Array.from({ length: EVENT_TOPICS_MAX + 1 }, (_, i) => ({ kind: "skill" as const, topic: `skill-${i}` }));
    expect(eventTopicList.safeParse(many.slice(0, EVENT_TOPICS_MAX)).success).toBe(true);
    expect(eventTopicList.safeParse(many).success).toBe(false);
  });
});

describe("eventCard", () => {
  it("takes an in-person card with its distance and an online one without", () => {
    expect(eventCard.safeParse(card).error).toBeUndefined();
    expect(eventCard.safeParse({ ...card, online: true, city: null, venue: null, distanceKm: null, rsvp: "going" }).success).toBe(true);
  });

  it("needs at least one tag: an event with no matching topic is never shown", () => {
    expect(eventCard.safeParse({ ...card, tags: [] }).success).toBe(false);
  });

  it("refuses a place and distance that disagree, a link that isn't https, and an end before the start", () => {
    expect(eventCard.safeParse({ ...card, distanceKm: null }).success).toBe(false);
    expect(eventCard.safeParse({ ...card, online: true, city: null }).success).toBe(false);
    expect(eventCard.safeParse({ ...card, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(eventCard.safeParse({ ...card, endsAt: "2026-11-07T12:00:00.000Z" }).success).toBe(false);
  });
});

describe("timetableView", () => {
  const view = { city: "Pune" as const, noCity: false, radiusKm: 25, online: true, filter: "all" as const, groups: [{ key: "week", label: "This week", events: [card] }], outsideRadius: 3 };

  it("takes a grouped timetable", () => {
    expect(timetableView.safeParse(view).error).toBeUndefined();
    expect(timetableView.safeParse({ ...view, groups: [{ key: "2026-12", label: "December", events: [card] }] }).success).toBe(true);
    expect(timetableView.safeParse({ ...view, city: null, noCity: true, groups: [] }).success).toBe(true);
  });

  it("keeps noCity with the city, each group once and no empty group", () => {
    expect(timetableView.safeParse({ ...view, noCity: true }).success).toBe(false);
    expect(timetableView.safeParse({ ...view, groups: [view.groups[0], view.groups[0]] }).success).toBe(false);
    expect(timetableView.safeParse({ ...view, groups: [{ key: "week", label: "This week", events: [] }] }).success).toBe(false);
    expect(timetableView.safeParse({ ...view, groups: [{ key: "next", label: "Next", events: [card] }] }).success).toBe(false);
  });

  it("holds up to 200 events across its groups (T165)", () => {
    expect(TIMETABLE_EVENTS_MAX).toBe(200);
    const cards = Array.from({ length: TIMETABLE_EVENTS_MAX }, () => card);
    const groups = [
      { key: "week", label: "This week", events: cards.slice(0, 100) },
      { key: "later", label: "Later this month", events: cards.slice(100) },
    ];
    expect(timetableView.safeParse({ ...view, groups }).success).toBe(true);
    expect(timetableView.safeParse({ ...view, groups: [...groups, { key: "2026-12", label: "December", events: [card] }] }).success).toBe(false);
  });
});

describe("timetableSettings", () => {
  it("takes 25 or 100 km, and defaults to 25 km, online on and the digest off", () => {
    expect(timetableSettings.parse(DEFAULT_TIMETABLE_SETTINGS)).toEqual({ radiusKm: 25, online: true, digest: false });
    expect(timetableSettings.safeParse({ radiusKm: 100, online: false, digest: true }).success).toBe(true);
    expect(timetableSettings.safeParse({ radiusKm: 50, online: true, digest: false }).success).toBe(false);
    expect(timetableSettings.safeParse({ radiusKm: 25, online: true }).success).toBe(false);
  });
});

describe("interestTopic", () => {
  it("takes a key, a label and lowercase aliases, with ambiguous ones among them", () => {
    expect(interestTopic.parse({ key: "ai", label: "AI", aliases: ["ai", "genai"] }).ambiguous).toEqual([]);
    expect(interestTopic.safeParse({ key: "data", label: "Data", aliases: ["data"], ambiguous: ["data"] }).success).toBe(true);
    expect(interestTopic.safeParse({ key: "data", label: "Data", aliases: ["data"], ambiguous: ["analytics"] }).success).toBe(false);
    expect(interestTopic.safeParse({ key: "ai", label: "AI", aliases: ["GenAI"] }).success).toBe(false);
    expect(interestTopic.safeParse({ key: "ai", label: "AI", aliases: [" ai"] }).success).toBe(false);
    expect(interestTopic.safeParse({ key: "ai", label: "AI", aliases: [] }).success).toBe(false);
  });

  it("refuses a topic listed twice", () => {
    const t = { key: "ai", label: "AI", aliases: ["ai"] };
    expect(interestTopicsFile.safeParse([t]).success).toBe(true);
    expect(interestTopicsFile.safeParse([t, t]).success).toBe(false);
  });
});

describe("cityCentre", () => {
  it("takes a listed city inside India's bounds, each once", () => {
    const pune = { city: "Pune", lat: 18.5204, lng: 73.8567 };
    expect(cityCentre.safeParse(pune).success).toBe(true);
    expect(cityCentre.safeParse({ ...pune, city: "Atlantis" }).success).toBe(false);
    expect(cityCentre.safeParse({ ...pune, lat: 51.5 }).success).toBe(false);
    expect(cityCentresFile.safeParse([pune, pune]).success).toBe(false);
  });
});

describe("eventRsvpExport", () => {
  it("is the person's own row with the event's summary and link", () => {
    expect(
      eventRsvpExport.safeParse({ title: "Hunting with a SIEM", organiser: "Example Security Circle", startsAt: at, sourceUrl: row.sourceUrl, state: "going", goalSkillId: "siem", createdAt: at }).success,
    ).toBe(true);
    expect(eventRsvpExport.safeParse({ title: "x", organiser: "y", startsAt: at, sourceUrl: row.sourceUrl, state: "maybe", goalSkillId: null, createdAt: at }).success).toBe(false);
  });

  it("keeps the table's limits and an https link (T166)", () => {
    const ok = { title: "x", organiser: "y", startsAt: at, sourceUrl: row.sourceUrl, state: "saved" as const, goalSkillId: null, createdAt: at };
    expect(eventRsvpExport.safeParse(ok).success).toBe(true);
    expect(eventRsvpExport.safeParse({ ...ok, title: "x".repeat(161) }).success).toBe(false);
    expect(eventRsvpExport.safeParse({ ...ok, organiser: "y".repeat(121) }).success).toBe(false);
    expect(eventRsvpExport.safeParse({ ...ok, sourceUrl: "http://events.example.org/x" }).success).toBe(false);
    expect(eventRsvpExport.safeParse({ ...ok, goalSkillId: "Not A Key" }).success).toBe(false);
  });
});

describe("event text (T166)", () => {
  it("refuses tags, entities and control characters in the summary", () => {
    for (const title of ["<b>SIEM</b> night", "SIEM &amp; logs", "SIEM &#60; night", "SIEM\u0000night", "SIEM\nnight"]) {
      expect(eventRow.safeParse({ ...row, title }).success).toBe(false);
      expect(eventCard.safeParse({ ...card, title }).success).toBe(false);
    }
    expect(eventRow.safeParse({ ...row, organiser: "<script>x</script>" }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, venue: "Baner &nbsp;Pune" }).success).toBe(false);
    expect(eventRow.safeParse({ ...row, cost: "Free\t" }).success).toBe(false);
    for (const title of ["Q&A with SOC analysts", "C++ & Rust", "AI < 5 years", "₹1,500 student pass", "डेटा विश्लेषण 🚀"]) expect(eventRow.safeParse({ ...row, title }).success).toBe(true);
  });

  it("refuses an in-person event with no city", () => {
    expect(eventRow.safeParse({ ...row, city: null }).success).toBe(false);
  });
});

describe("eventRsvpInput", () => {
  it("takes an event id and Save, I'm going or neither", () => {
    for (const state of ["saved", "going", null]) expect(eventRsvpInput.safeParse({ eventId: id, state }).success).toBe(true);
    expect(eventRsvpInput.safeParse({ eventId: id, state: "maybe" }).success).toBe(false);
    expect(eventRsvpInput.safeParse({ eventId: "e1", state: "saved" }).success).toBe(false);
    expect(eventRsvpInput.safeParse({ eventId: id, state: "going", goalSkillId: "siem" }).success).toBe(false);
  });
});

describe("timetableWhy", () => {
  it("takes the goals' names and the interests as typed, within the interest caps", () => {
    expect(timetableWhy.safeParse({ goals: ["SIEM and log analysis"], interests: ["AI", "Public speaking"] }).success).toBe(true);
    expect(timetableWhy.safeParse({ goals: [], interests: [] }).success).toBe(true);
    expect(timetableWhy.safeParse({ goals: [], interests: ["x".repeat(41)] }).success).toBe(false);
    expect(timetableWhy.safeParse({ goals: [], interests: Array.from({ length: 31 }, (_, i) => `i${i}`) }).success).toBe(false);
  });
});
