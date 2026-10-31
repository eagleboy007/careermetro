import { EMAIL_TOKENS as T, escapeHtml as escape } from "@/lib/email/look";
import { indiaDay, mondayOf } from "@/lib/ride/days";
import { eventsDigestEvent, type EventCard, type EventsDigestEvent, type EventsDigestView } from "@/lib/schemas";
import { EVENTS_DIGEST_DAYS, EVENTS_DIGEST_EVENTS_MAX } from "@/lib/schemas/constants";
import { dateBlock, eventWhen } from "./view";

/*
 * The Monday events digest (Timetable PR 5, docs/plans/timetable-plan.md section 5), in plain code: the person's
 * timetable cards in, the digest and the email's text and HTML out. It lists only our short summary of each event
 * (title, organiser, day and time in IST, city or Online, and the organiser's link), never the organiser's description,
 * and names no other person. No event in the next 7 days gives no email.
 */

const DAY_MS = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the email and the Timetable say every time: going is never proof. */
export const DIGEST_GAP_NOTE = "Going to an event never fills a gap on its own.";
export const DIGEST_PREHEADER = "Picked only from your goals and interests. Nothing sponsored.";

/** "Sat 7 Nov, 6 to 8 pm IST" on one day; "14 to 15 Nov" across days (the dates already say when). */
export function digestWhen(startsAt: string, endsAt: string): string {
  const span = eventWhen(startsAt, endsAt);
  if (!span.endsWith("IST")) return span;
  const d = dateBlock(startsAt);
  return `${d.weekday} ${d.day} ${d.month}, ${span}`;
}

/**
 * The digest for one person from their timetable cards (already only live events that match a goal or interest, near
 * enough or online as they chose, in start order): the events that start from `now` to EVENTS_DIGEST_DAYS days on, the
 * soonest EVENTS_DIGEST_EVENTS_MAX of them, and how many more. A card that can't be listed as plain text is left out.
 * Null when none is left: no email that week.
 */
export function digestView(cards: readonly EventCard[], now: Date): EventsDigestView | null {
  const from = now.getTime();
  const until = from + EVENTS_DIGEST_DAYS * DAY_MS;
  const listed: EventsDigestEvent[] = [];
  const ordered = cards
    .filter((c) => {
      const start = Date.parse(c.startsAt);
      return start >= from && start < until;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (const c of ordered) {
    const event = eventsDigestEvent.safeParse({
      title: c.title,
      organiser: c.organiser,
      when: digestWhen(c.startsAt, c.endsAt),
      place: c.online ? "Online" : c.city,
      sourceUrl: c.sourceUrl,
    });
    if (event.success) listed.push(event.data);
  }
  if (!listed.length) return null;
  return { week: mondayOf(indiaDay(now)), events: listed.slice(0, EVENTS_DIGEST_EVENTS_MAX), more: listed.length - Math.min(listed.length, EVENTS_DIGEST_EVENTS_MAX) };
}

/** "3 events in the next 7 days for your goals and interests". */
export function digestSubject(view: EventsDigestView): string {
  return `${plural(view.events.length + view.more, "event")} in the next ${EVENTS_DIGEST_DAYS} days for your goals and interests`;
}

export type DigestEmail = { subject: string; preheader: string; text: string; html: string };

/**
 * The email for one digest: plain text and HTML with the same words, in the weekly My jobs email's look (ink links,
 * never cobalt). `site` is the app's address; `offUrl` turns the digest off with one tap and needs no sign-in. `name`
 * is the person's first name, when we have one.
 */
export function digestEmail(view: EventsDigestView, { name, site, offUrl }: { name: string | null; site: string; offUrl: string }): DigestEmail {
  const subject = digestSubject(view);
  const hello = name ? `${name}, your events for the week.` : "Your events for the week.";
  const timetable = `${site}/timetable`;
  const heading = `In the next ${EVENTS_DIGEST_DAYS} days`;
  const more = view.more ? `${plural(view.more, "more event")} on your Timetable.` : "";
  const why = "You get this because you turned on “Send me this week's events” on Timetable or in Settings. Sent only on weeks when an event matches your goals or interests.";

  const text = [
    hello,
    "",
    heading.toUpperCase(),
    ...view.events.flatMap((e) => [`${e.title}, ${e.organiser}`, `  ${e.when} · ${e.place}`, `  Organiser's page: ${e.sourceUrl}`]),
    "",
    ...(more ? [more] : []),
    `See them all on Timetable: ${timetable}`,
    "",
    DIGEST_GAP_NOTE,
    "",
    "--",
    why,
    `Turn it off (no sign-in): ${offUrl}`,
  ].join("\n");

  const p = (s: string, style = "") => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${T.ink};${style}">${s}</p>`;
  const h = (s: string) => `<h2 style="margin:20px 0 8px;font-family:monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${T.muted}">${escape(s)}</h2>`;
  const a = (href: string, label: string) => `<a href="${escape(href)}" style="color:${T.ink};font-weight:600">${escape(label)}</a>`;
  const card = (e: EventsDigestEvent) =>
    `<div style="margin:0 0 8px;padding:12px 14px;border:1px solid ${T.line};border-radius:12px;background:${T.surface}">` +
    p(`<b>${escape(e.title)}</b> · ${escape(e.organiser)}`, "margin:0 0 4px") +
    p(escape(`${e.when} · ${e.place}`), `margin:0 0 6px;color:${T.muted}`) +
    p(a(e.sourceUrl, "Organiser's page"), "margin:0") +
    `</div>`;
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:${T.bg}">` +
    `<div style="display:none;max-height:0;overflow:hidden">${escape(DIGEST_PREHEADER)}</div>` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:${T.ink}">` +
    `<p style="margin:0 0 4px;font-family:monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${T.muted}">CareerMetro · Timetable</p>` +
    `<h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;color:${T.ink}">${escape(hello)}</h1>` +
    h(heading) +
    view.events.map(card).join("") +
    (more ? p(escape(more), `margin-top:12px;color:${T.muted}`) : "") +
    p(a(timetable, "See them all on Timetable")) +
    p(escape(DIGEST_GAP_NOTE), `margin-top:16px;color:${T.muted}`) +
    `<hr style="border:0;border-top:1px solid ${T.line};margin:20px 0 12px">` +
    p(escape(why), `font-size:12px;color:${T.muted}`) +
    p(a(offUrl, "Turn it off"), "font-size:12px") +
    `</div></body></html>`;
  return { subject, preheader: DIGEST_PREHEADER, text, html };
}
