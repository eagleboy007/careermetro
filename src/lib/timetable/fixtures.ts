import type { TimetableWhy } from "@/lib/schemas";
import { timetableFor, type TimetableEvent, type TimetablePerson } from "./match";
import { FAR_RADIUS_KM } from "./view";

/*
 * Example Timetable for the signed-out preview and /design (prototype v2 evt.js, docs/plans/timetable-plan.md section
 * 7). Every organiser, title and link here is made up. A fixed "now" keeps the groups the same on every render.
 */

/** Monday 12 October 2026, 12:00 IST. */
export const EXAMPLE_TIMETABLE_NOW = new Date("2026-10-12T06:30:00Z");

const at = (iso: string) => new Date(iso);
const id = (n: number) => `00000000-0000-4000-8000-0000000e${String(n).padStart(4, "0")}`;
const base = { status: "live" as const, rsvp: null };

export const exampleTimetableEvents: TimetableEvent[] = [
  {
    ...base,
    id: id(1),
    title: "Hunting with a SIEM: hands-on lab night",
    organiser: "Pune Security Meetup (example)",
    kind: "workshop",
    startsAt: at("2026-10-17T11:30:00Z"),
    endsAt: at("2026-10-17T14:30:00Z"),
    online: false,
    city: "Pune",
    venue: "Baner, Pune",
    cost: "Free",
    sourceUrl: "https://events.example.org/pune-security/siem-lab",
    topics: [{ kind: "skill", topic: "siem" }],
  },
  {
    ...base,
    id: id(2),
    title: "MITRE ATT&CK mapping for beginners",
    organiser: "Blue Team Circle (example)",
    kind: "online",
    startsAt: at("2026-10-13T13:30:00Z"),
    endsAt: at("2026-10-13T15:00:00Z"),
    online: true,
    city: null,
    venue: null,
    cost: "Free",
    sourceUrl: "https://events.example.org/blue-team/attack-mapping",
    topics: [{ kind: "skill", topic: "threat-detection" }],
    rsvp: "saved",
  },
  {
    ...base,
    id: id(3),
    title: "AI Builders Pune: monthly demo night",
    organiser: "AI Builders Pune (example)",
    kind: "meetup",
    startsAt: at("2026-10-24T12:30:00Z"),
    endsAt: at("2026-10-24T15:30:00Z"),
    online: false,
    city: "Pune",
    venue: "Kharadi, Pune",
    cost: "Free",
    sourceUrl: "https://events.example.org/ai-builders/demo-night",
    topics: [{ kind: "interest", topic: "ai" }],
  },
  {
    ...base,
    id: id(4),
    title: "Open source contribution sprint",
    organiser: "Kothrud Code Club (example)",
    kind: "meetup",
    startsAt: at("2026-10-25T04:30:00Z"),
    endsAt: at("2026-10-25T06:30:00Z"),
    online: false,
    city: "Pune",
    venue: "Kothrud",
    cost: "₹200",
    sourceUrl: "https://events.example.org/kothrud-code/sprint",
    topics: [{ kind: "interest", topic: "open-source" }],
  },
  {
    ...base,
    id: id(5),
    title: "West India Cyber Security Summit",
    organiser: "Two days, 40 talks (example)",
    kind: "conference",
    startsAt: at("2026-11-13T03:30:00Z"),
    endsAt: at("2026-11-14T12:30:00Z"),
    online: false,
    city: "Mumbai",
    venue: "Powai, Mumbai",
    cost: "₹1,500 student pass",
    sourceUrl: "https://events.example.org/west-india-cyber/2026",
    topics: [
      { kind: "skill", topic: "siem" },
      { kind: "skill", topic: "threat-detection" },
      { kind: "skill", topic: "aws" },
    ],
  },
  {
    ...base,
    id: id(6),
    title: "Python for log analysis",
    organiser: "PyData Pune volunteers (example)",
    kind: "workshop",
    startsAt: at("2026-11-21T08:30:00Z"),
    endsAt: at("2026-11-21T11:30:00Z"),
    online: false,
    city: "Pune",
    venue: "Hinjewadi, Pune",
    cost: "Free",
    sourceUrl: "https://events.example.org/pydata-pune/log-analysis",
    topics: [
      { kind: "skill", topic: "python" },
      { kind: "skill", topic: "siem" },
      { kind: "interest", topic: "python" },
    ],
    rsvp: "going",
    // Made a prep task for the SIEM goal: the card says so, and the ride shows it on the day.
    prep: "siem",
  },
  {
    ...base,
    id: id(7),
    title: "Design for non-designers",
    organiser: "Design Circle India (example)",
    kind: "online",
    startsAt: at("2026-11-26T13:00:00Z"),
    endsAt: at("2026-11-26T14:30:00Z"),
    online: true,
    city: null,
    venue: null,
    cost: "Free",
    sourceUrl: "https://events.example.org/design-circle/non-designers",
    topics: [{ kind: "interest", topic: "ui-ux" }],
  },
  {
    // Matches nothing the example person has, so it never shows: nothing else gets in.
    ...base,
    id: id(8),
    title: "Weekend cricket for tech teams",
    organiser: "Pune Sports Club (example)",
    kind: "meetup",
    startsAt: at("2026-10-18T02:30:00Z"),
    endsAt: at("2026-10-18T05:30:00Z"),
    online: false,
    city: "Pune",
    venue: "Aundh, Pune",
    cost: "Free",
    sourceUrl: "https://events.example.org/pune-sports/cricket",
    topics: [],
  },
];

/** The example person: Pune, four goals and four interests ("Public speaking" maps to no topic, so it matches nothing). */
export const exampleTimetablePerson: TimetablePerson = {
  city: "Pune",
  radiusKm: 25,
  online: true,
  goalSkillIds: ["siem", "threat-detection", "python", "aws"],
  interestKeys: ["ai", "ui/ux", "open source", "public speaking"],
};

export const exampleTimetableWhy: TimetableWhy = {
  goals: ["SIEM and log analysis", "Threat detection and hunting", "Python", "AWS"],
  interests: ["AI", "UI/UX", "Open source", "Public speaking"],
};

/** The example view, read as the store reads one: every match within FAR_RADIUS_KM, online ones in. */
export const exampleTimetable = timetableFor(exampleTimetableEvents, { ...exampleTimetablePerson, radiusKm: FAR_RADIUS_KM, online: true }, EXAMPLE_TIMETABLE_NOW);

/** A person with no profile city: online events only, and the line asking for a city. */
export const exampleTimetableNoCity = timetableFor(exampleTimetableEvents, { ...exampleTimetablePerson, city: null, radiusKm: FAR_RADIUS_KM, online: true }, EXAMPLE_TIMETABLE_NOW);

/** Nothing matches: no goals, and an interest that maps to no topic. */
export const exampleTimetableEmpty = timetableFor(exampleTimetableEvents, { ...exampleTimetablePerson, goalSkillIds: [], interestKeys: ["public speaking"] }, EXAMPLE_TIMETABLE_NOW);

export const exampleTimetableChoices = { radiusKm: exampleTimetablePerson.radiusKm, online: exampleTimetablePerson.online };
