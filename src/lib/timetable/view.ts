import type { EventCard, EventTeaser, TimetableFilter, TimetableGroup } from "@/lib/schemas";
import { EVENT_KIND_LABELS, EVENT_RADIUS_DEFAULT_KM } from "@/lib/schemas/constants";

/*
 * What the /timetable screen and Today's teaser show of an event card (docs/plans/timetable-plan.md section 7). Pure and
 * free of content files, so the screen's client code can use it. Times are worked out in IST by offset, not by the
 * device's time zone, so the server and the browser write the same words.
 */

const IST_MS = 5.5 * 3600_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A moment's India wall clock, read from the UTC fields of the shifted date. */
const ist = (iso: string) => new Date(Date.parse(iso) + IST_MS);

/** The date block on a card: "Sat", 17, "Oct", in IST. */
export function dateBlock(iso: string): { weekday: string; day: number; month: string } {
  const d = ist(iso);
  return { weekday: WEEKDAYS[d.getUTCDay()], day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] };
}

/** "5 pm", "5:30 pm", "12 pm" from an India wall clock. */
function clock(d: Date): { text: string; half: "am" | "pm" } {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const half = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { text: m ? `${h12}:${String(m).padStart(2, "0")}` : String(h12), half };
}

const sameIndiaDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/**
 * When an event runs, in IST: "5 to 8 pm IST", "10 am to 12 pm IST" and "7 pm IST" on one day; "14 to 15 Nov" and
 * "30 Nov to 1 Dec" across days.
 */
export function eventWhen(startsAt: string, endsAt: string): string {
  const s = ist(startsAt);
  const e = ist(endsAt);
  if (!sameIndiaDay(s, e)) {
    const sm = MONTHS[s.getUTCMonth()];
    const em = MONTHS[e.getUTCMonth()];
    return sm === em && s.getUTCFullYear() === e.getUTCFullYear() ? `${s.getUTCDate()} to ${e.getUTCDate()} ${em}` : `${s.getUTCDate()} ${sm} to ${e.getUTCDate()} ${em}`;
  }
  const a = clock(s);
  if (s.getTime() === e.getTime()) return `${a.text} ${a.half} IST`;
  const b = clock(e);
  return a.half === b.half ? `${a.text} to ${b.text} ${b.half} IST` : `${a.text} ${a.half} to ${b.text} ${b.half} IST`;
}

/**
 * Where: "Online", or the area with its city ("Baner, Pune"), and how far when it is beyond the usual 25 km ("Mumbai ·
 * 120 km away"). An area that already names the city is not given it twice.
 */
export function eventPlace(card: Pick<EventCard, "online" | "city" | "venue" | "distanceKm">): string {
  if (card.online) return "Online";
  const city = card.city ?? "";
  const venue = card.venue?.trim();
  const place = venue ? (city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue) : city;
  return card.distanceKm !== null && card.distanceKm > EVENT_RADIUS_DEFAULT_KM ? `${place} · ${card.distanceKm} km away` : place;
}

export const kindLabel = (card: Pick<EventCard, "kind">) => EVENT_KIND_LABELS[card.kind];

/** A goal tag's name without its "Goal: " lead, for "Add it as a prep task for your SIEM goal?". */
export const goalTagName = (label: string) => label.replace(/^Goal:\s*/, "");

/** What the filter row has picked. `far` is "Show outside 25 km" for this visit; `radiusKm` is the saved radius. */
export type TimetableShown = { filter: TimetableFilter; online: boolean; far: boolean; radiusKm: number };

/** The radius "Show outside 25 km" opens for one visit (the store reads this far). */
export const FAR_RADIUS_KM = 100;

/**
 * The groups the screen shows for the filter row's choices, from a view the store read with every match within
 * FAR_RADIUS_KM and online events in. My goals or My interests keep only cards with that kind of tag, and only those
 * tags; Include online off drops online events; in-person events beyond the saved radius show only with `far`, and are
 * counted in `outside` until then. Groups left empty go.
 */
export function shownGroups(groups: readonly TimetableGroup[], shown: TimetableShown): { groups: TimetableGroup[]; outside: number; total: number } {
  const limit = shown.far ? Math.max(shown.radiusKm, FAR_RADIUS_KM) : shown.radiusKm;
  let outside = 0;
  let total = 0;
  const out: TimetableGroup[] = [];
  for (const g of groups) {
    const events: EventCard[] = [];
    for (const card of g.events) {
      const tags = shown.filter === "all" ? card.tags : card.tags.filter((t) => (shown.filter === "goals" ? t.kind === "goal" : t.kind === "interest"));
      if (!tags.length) continue;
      if (card.online && !shown.online) continue;
      if (!card.online && card.distanceKm !== null && card.distanceKm > limit) {
        outside++;
        continue;
      }
      if (tags.length === card.tags.length) events.push(card);
      else {
        // My interests hides the goal tags, and with them the prep task's line, so the card stays one the schema takes.
        const { prepGoal, ...rest } = card;
        events.push(prepGoal && tags.some((t) => t.kind === "goal" && t.topic === prepGoal) ? { ...rest, tags, prepGoal } : { ...rest, tags });
      }
    }
    total += events.length;
    if (events.length) out.push({ ...g, events });
  }
  return { groups: out, outside, total };
}

/** Where Suggest an event sits on the Timetable rail, for a link from the empty state. */
export const SUGGEST_EVENT_ANCHOR = "suggest-event";

/** What the empty Timetable says: a heading, a line, and links to what the person can do. */
export type NothingYetCopy = { title: string; body: string; links: { href: string; label: string }[] };

/**
 * The empty state's words (T181). `covered` is whether any event source covers the person's goals or interests
 * (src/lib/timetable/coverage.ts). Covered: nothing is on yet, and goals, interests and the city are what pick events,
 * so it points to Me and Settings. Not covered: no source lists this field yet, so it says so and offers what works
 * now (Suggest an event, Practice, the Map), never Me, where adding an interest can't help.
 */
export function nothingYetCopy(covered: boolean): NothingYetCopy {
  if (covered) {
    return {
      title: "No events match your goals or interests yet.",
      body: "We only show events on your goals and interests, near your city or online.",
      links: [
        { href: "/me", label: "Add interests on Me" },
        { href: "/settings#acc-pay", label: "Set your city in Settings" },
      ],
    };
  }
  return {
    title: "Events for your field aren't listed yet.",
    body: "We list mostly tech events for now, and events for your field are coming. Until then, suggest one you know, or keep going on your path.",
    links: [
      { href: `#${SUGGEST_EVENT_ANCHOR}`, label: "Suggest an event" },
      { href: "/practice", label: "Practise on your goals" },
      { href: "/map", label: "Follow your path on Map" },
    ],
  };
}

/** "SIEM, Python and 3 more": the first `max` names, then a count. */
export function namesLine(names: readonly string[], max = 6): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** The teaser's rows on Today: the first `n` cards as a date block, the title and "Baner, Pune · 5 to 8 pm IST · Goal: SIEM". */
export function teaserRows(cards: readonly EventCard[], n = 2): EventTeaser[] {
  return cards.slice(0, n).map((c) => {
    const { weekday, day } = dateBlock(c.startsAt);
    return { id: c.id, day: weekday, date: day, title: c.title, detail: clip([eventPlace(c), eventWhen(c.startsAt, c.endsAt), c.tags[0]?.label].filter(Boolean).join(" · "), 120) };
  });
}
