import { describe, expect, it } from "vitest";
import { cityCentres, interestTopics, skills } from "@/content";
import { eventTopicList, timetableView, type EventTopic } from "@/lib/schemas";
import { cityDistanceKm, groupByWhen, haversineKm, interestTopicsFor, timetableFor, topicMatchersFor, topicsOf, type TimetableEvent, type TimetablePerson } from "./match";

// Synthetic events only: every organiser and title here is made up.
const NOW = new Date("2026-10-14T06:30:00Z"); // Wednesday 12:00 IST
const HOUR = 3600_000;
const DAY = 24 * HOUR;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const event = (over: Partial<TimetableEvent> = {}): TimetableEvent => {
  const startsAt = over.startsAt ?? new Date(NOW.getTime() + 2 * DAY);
  return {
    id: uuid(),
    title: "Hunting with a SIEM",
    organiser: "Example Security Circle",
    kind: "meetup",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * HOUR),
    online: false,
    city: "Pune",
    venue: "Baner, Pune",
    cost: "Free",
    sourceUrl: "https://events.example.org/siem-hunt",
    status: "live",
    topics: [{ kind: "skill", topic: "siem" }],
    rsvp: null,
    ...over,
  };
};

const person = (over: Partial<TimetablePerson> = {}): TimetablePerson => ({
  city: "Pune",
  radiusKm: 25,
  online: true,
  goalSkillIds: ["siem"],
  interestKeys: [],
  ...over,
});

const allCards = (v: ReturnType<typeof timetableFor>) => v.groups.flatMap((g) => g.events);

describe("topicsOf", () => {
  it("finds skills by the taxonomy's names and aliases and interests by the topic list, whole words only", () => {
    const topics = topicsOf("Splunk night: hunting threats", "Bring a laptop with Python 3. We cover generative AI for analysts.");
    expect(topics).toContainEqual({ kind: "skill", topic: "siem" });
    expect(topics).toContainEqual({ kind: "skill", topic: "python" });
    expect(topics).toContainEqual({ kind: "interest", topic: "ai" });
    expect(topicsOf("Pythonic patterns", "").some((t) => t.topic === "python")).toBe(false);
    expect(eventTopicList.safeParse(topics).success).toBe(true);
  });

  it("returns skills first, then interests, each once", () => {
    const topics = topicsOf("Kubernetes and k8s for cloud native teams", "Kubernetes again, and cloud computing.");
    const kinds = topics.map((t) => t.kind);
    expect(kinds.indexOf("interest")).toBeGreaterThan(kinds.lastIndexOf("skill"));
    expect(new Set(topics.map((t) => `${t.kind}:${t.topic}`)).size).toBe(topics.length);
    expect(topics).toContainEqual({ kind: "skill", topic: "kubernetes" });
    expect(topics).toContainEqual({ kind: "interest", topic: "cloud" });
  });

  it("never takes a topic from an ambiguous word", () => {
    const matchers = topicMatchersFor(skills, interestTopics);
    const topics = topicsOf("Product meetup", "We share data about the venue and there is networking after.", matchers);
    expect(topics.filter((t) => t.kind === "interest").map((t) => t.topic)).toEqual([]);
    expect(topicsOf("Team lunch", "Spreadsheets of containers", matchers).some((t) => t.topic === "docker")).toBe(false);
  });

  it("finds nothing in text about nothing it knows", () => {
    expect(topicsOf("Weekend run", "Meet at the park gate.")).toEqual([]);
  });

  it("keeps at most 100 topics", () => {
    const text = skills.map((s) => s.name).join(", ");
    expect(topicsOf(text, text).length).toBeLessThanOrEqual(100);
  });
});

describe("interestTopicsFor", () => {
  it("maps an interest by key, label or alias, exactly", () => {
    expect(interestTopicsFor(["artificial intelligence", "genai", "open source", "ui/ux"])).toEqual(["ai", "open-source", "ui-ux"]);
    expect(interestTopicsFor(["machine learning"])).toEqual(["machine-learning"]);
  });

  it("matches nothing for an interest it doesn't know, and never guesses", () => {
    expect(interestTopicsFor(["cooking", "artificial", "ai stuff"])).toEqual([]);
  });
});

describe("distance", () => {
  it("counts the same city as 0 km", () => {
    expect(cityDistanceKm("Pune", "Pune")).toBe(0);
  });

  it("works out km between city centres", () => {
    const km = cityDistanceKm("Pune", "Mumbai")!;
    expect(km).toBeGreaterThan(100);
    expect(km).toBeLessThan(140);
    expect(cityDistanceKm("Noida", "New Delhi")!).toBeLessThan(25);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
  });

  it("is null for a city with no centre", () => {
    expect(cityDistanceKm("Pune", "Atlantis", cityCentres)).toBeNull();
  });
});

describe("timetableFor", () => {
  it("shows only events matching a goal or an interest, tagged with why", () => {
    const goal = event();
    const interest = event({ title: "GenAI evening", topics: [{ kind: "interest", topic: "ai" }] });
    const neither = event({ title: "Excel tips", topics: [{ kind: "skill", topic: "excel" }] });
    const none = event({ title: "Untagged", topics: [] });
    const view = timetableFor([goal, interest, neither, none], person({ interestKeys: ["artificial intelligence"] }), NOW);
    expect(timetableView.safeParse(view).error).toBeUndefined();
    const cards = allCards(view);
    expect(cards.map((c) => c.id).sort()).toEqual([goal.id, interest.id].sort());
    expect(cards.find((c) => c.id === goal.id)!.tags).toEqual([{ kind: "goal", topic: "siem", label: "Goal: SIEM and log analysis" }]);
    expect(cards.find((c) => c.id === interest.id)!.tags).toEqual([{ kind: "interest", topic: "ai", label: "Interest: AI" }]);
    for (const c of cards) expect(c.tags.length).toBeGreaterThan(0);
  });

  it("puts goal tags before interest tags", () => {
    const both = event({ topics: [{ kind: "interest", topic: "security" }, { kind: "skill", topic: "siem" }] });
    const [card] = allCards(timetableFor([both], person({ interestKeys: ["cybersecurity"] }), NOW));
    expect(card.tags.map((t) => t.label)).toEqual(["Goal: SIEM and log analysis", "Interest: Security"]);
  });

  it("filters to My goals or My interests", () => {
    const goal = event();
    const interest = event({ topics: [{ kind: "interest", topic: "ai" }] });
    const p = person({ interestKeys: ["ai"] });
    expect(allCards(timetableFor([goal, interest], p, NOW, "goals")).map((c) => c.id)).toEqual([goal.id]);
    expect(allCards(timetableFor([goal, interest], p, NOW, "interests")).map((c) => c.id)).toEqual([interest.id]);
  });

  it("keeps the next 60 days and drops what started more than 2 hours ago", () => {
    const started1h = event({ startsAt: new Date(NOW.getTime() - HOUR) });
    const started3h = event({ startsAt: new Date(NOW.getTime() - 3 * HOUR) });
    const day59 = event({ startsAt: new Date(NOW.getTime() + 59 * DAY) });
    const day61 = event({ startsAt: new Date(NOW.getTime() + 61 * DAY) });
    const ids = allCards(timetableFor([started1h, started3h, day59, day61], person(), NOW)).map((c) => c.id);
    expect(ids).toEqual([started1h.id, day59.id]);
  });

  it("shows only live events", () => {
    const events = (["pending", "live", "hidden", "cancelled"] as const).map((status) => event({ status }));
    expect(allCards(timetableFor(events, person(), NOW)).map((c) => c.id)).toEqual([events[1].id]);
  });

  it("keeps in-person events within the radius and counts the rest", () => {
    const pune = event({ city: "Pune" });
    const mumbai = event({ city: "Mumbai", venue: null });
    const view = timetableFor([pune, mumbai], person({ radiusKm: 25 }), NOW);
    expect(allCards(view).map((c) => [c.id, c.distanceKm])).toEqual([[pune.id, 0]]);
    expect(view.outsideRadius).toBe(1);
    const wide = timetableFor([pune, mumbai], person({ radiusKm: 100 }), NOW);
    expect(wide.outsideRadius).toBe(1);
    const delhi = timetableFor([event({ city: "Noida" })], person({ city: "New Delhi" }), NOW);
    expect(allCards(delhi)[0].distanceKm).toBeGreaterThan(0);
    expect(allCards(delhi)[0].distanceKm).toBeLessThanOrEqual(25);
  });

  it("counts outside the radius only events that match", () => {
    const view = timetableFor([event({ city: "Mumbai", topics: [{ kind: "skill", topic: "excel" }] })], person(), NOW);
    expect(view.outsideRadius).toBe(0);
  });

  it("includes online events only with Include online", () => {
    const online = event({ online: true, city: null, venue: null, kind: "online" });
    expect(allCards(timetableFor([online], person({ online: true }), NOW))).toEqual([expect.objectContaining({ id: online.id, distanceKm: null, city: null })]);
    expect(allCards(timetableFor([online], person({ online: false }), NOW))).toEqual([]);
  });

  it("with no profile city shows online events only and asks for a city", () => {
    const online = event({ online: true, city: null, venue: null });
    const pune = event();
    const view = timetableFor([online, pune], person({ city: null }), NOW);
    expect(view.noCity).toBe(true);
    expect(view.city).toBeNull();
    expect(allCards(view).map((c) => c.id)).toEqual([online.id]);
    expect(view.outsideRadius).toBe(0);
    expect(timetableView.safeParse(view).error).toBeUndefined();
    expect(timetableFor([pune], person(), NOW).noCity).toBe(false);
  });

  it("orders by start and groups as This week, Later this month, then by month, in IST", () => {
    const at = (iso: string) => event({ startsAt: new Date(iso), title: iso });
    const events = [
      at("2026-12-10T06:30:00Z"),
      at("2026-11-05T06:30:00Z"),
      at("2026-10-31T19:00:00Z"), // 1 November, 00:30 IST
      at("2026-10-18T18:30:00Z"), // Monday 19 October, 00:00 IST
      at("2026-10-18T18:00:00Z"), // Sunday 18 October, 23:30 IST
      at("2026-10-16T12:30:00Z"),
    ];
    const view = timetableFor(events, person(), NOW);
    expect(timetableView.safeParse(view).error).toBeUndefined();
    expect(view.groups.map((g) => [g.key, g.label, g.events.map((e) => e.title)])).toEqual([
      ["week", "This week", ["2026-10-16T12:30:00Z", "2026-10-18T18:00:00Z"]],
      ["later", "Later this month", ["2026-10-18T18:30:00Z"]],
      ["2026-11", "November", ["2026-10-31T19:00:00Z", "2026-11-05T06:30:00Z"]],
      ["2026-12", "December", ["2026-12-10T06:30:00Z"]],
    ]);
  });

  it("names the year on a month group in another year", () => {
    const now = new Date("2026-12-20T06:30:00Z");
    const view = timetableFor([event({ startsAt: new Date("2027-01-10T06:30:00Z") })], person(), now);
    expect(view.groups.map((g) => g.label)).toEqual(["January 2027"]);
  });

  it("clips a long title with …", () => {
    const [card] = allCards(timetableFor([event({ title: "A".repeat(200) })], person(), NOW));
    expect(card.title).toHaveLength(160);
    expect(card.title.endsWith("…")).toBe(true);
  });

  it("carries the person's own Save or I'm going", () => {
    const [card] = allCards(timetableFor([event({ rsvp: "going" })], person(), NOW));
    expect(card.rsvp).toBe("going");
  });

  it("returns an empty timetable when nothing matches", () => {
    const view = timetableFor([event()], person({ goalSkillIds: [], interestKeys: ["cooking"] }), NOW);
    expect(view.groups).toEqual([]);
    expect(timetableView.safeParse(view).error).toBeUndefined();
  });

  it("builds a valid view from 2,000 matching events, the cap", () => {
    const topics: EventTopic[] = [{ kind: "skill", topic: "siem" }];
    const many = Array.from({ length: 2000 }, (_, i) => event({ startsAt: new Date(NOW.getTime() + (i % 59) * DAY + HOUR), topics }));
    const view = timetableFor(many, person(), NOW);
    expect(allCards(view)).toHaveLength(2000);
    expect(timetableView.safeParse(view).error).toBeUndefined();
  });
});

describe("groupByWhen", () => {
  it("returns no groups for no cards", () => {
    expect(groupByWhen([], NOW)).toEqual([]);
  });
});
