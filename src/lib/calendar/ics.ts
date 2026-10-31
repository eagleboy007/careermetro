/*
 * A calendar file for one interview (v44 gap list item 46, "Add to calendar" on Arrivals): plain RFC 5545 text built in
 * code, no keys and no service. Times are UTC, lines end in CRLF and are folded at 75 octets, and text is escaped. It
 * holds the interview's round, the job title and the company only: never the person's name, email or phone. The UID
 * comes from the interview id, so it is the same on every download (calendars that match on UID can treat a second
 * download as the same event).
 */

const IST_OFFSET_MS = 5.5 * 3600_000;
/** The evening reminder: 19:00 India time on the day before. */
const REMINDER_HOUR_IST = 19;

export type InterviewIcs = {
  interviewId: string;
  startsAt: Date;
  minutes: number;
  /** "Level 2 team interview for SOC Analyst L1 at Example Labs". */
  summary: string;
  /** When the file is made (DTSTAMP). */
  now: Date;
};

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** A moment as an iCalendar UTC date-time: 20261014T053000Z. */
export function icsUtc(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Folds a content line at 75 octets (UTF-8), never inside a character; each continuation starts with a space. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** 19:00 India time on the India day before the interview starts. */
export function eveningBefore(startsAt: Date): Date {
  const day = new Date(startsAt.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const midnightUtc = Date.parse(`${day}T00:00:00.000Z`);
  return new Date(midnightUtc - 24 * 3600_000 + REMINDER_HOUR_IST * 3600_000 - IST_OFFSET_MS);
}

export type EventIcs = {
  eventId: string;
  startsAt: Date;
  endsAt: Date;
  /** The event's title. */
  summary: string;
  organiser: string;
  /** "Baner, Pune" or "Online". */
  location: string;
  /** The organiser's https page, always the event's link. */
  url: string;
  now: Date;
};

/**
 * The .ics file for one Timetable event ("Add to calendar", docs/plans/timetable-plan.md section 4), built the same way
 * as an interview's: the title, organiser, place and the organiser's link, and a reminder at 19:00 IST the evening
 * before. Nothing about the person.
 */
export function eventIcs(ev: EventIcs): string {
  const summary = escapeIcsText(ev.summary);
  const end = ev.endsAt.getTime() > ev.startsAt.getTime() ? ev.endsAt : new Date(ev.startsAt.getTime() + 3600_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CareerMetro//Timetable//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:event-${ev.eventId.replace(/[^A-Za-z0-9-]/g, "")}@careermetro.app`,
    "SEQUENCE:0",
    `DTSTAMP:${icsUtc(ev.now)}`,
    `DTSTART:${icsUtc(ev.startsAt)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${escapeIcsText(ev.location)}`,
    `DESCRIPTION:${escapeIcsText(`By ${ev.organiser}. Details and any change are on the organiser's page: ${ev.url}`)}`,
    // A URI value: not TEXT-escaped. Line breaks can't be in an https link that passed the event's checks.
    `URL:${ev.url.replace(/[\r\n]/g, "")}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:Tomorrow: ${summary}`,
    `TRIGGER;VALUE=DATE-TIME:${icsUtc(eveningBefore(ev.startsAt))}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** The .ics file for one interview, with a display reminder the evening before. */
export function interviewIcs(iv: InterviewIcs): string {
  const end = new Date(iv.startsAt.getTime() + iv.minutes * 60_000);
  const summary = escapeIcsText(iv.summary);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CareerMetro//Arrivals//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:interview-${iv.interviewId.replace(/[^A-Za-z0-9-]/g, "")}@careermetro.app`,
    "SEQUENCE:0",
    `DTSTAMP:${icsUtc(iv.now)}`,
    `DTSTART:${icsUtc(iv.startsAt)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${summary}`,
    "DESCRIPTION:Details and any change are on Arrivals in CareerMetro.",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:Tomorrow: ${summary}`,
    `TRIGGER;VALUE=DATE-TIME:${icsUtc(eveningBefore(iv.startsAt))}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
