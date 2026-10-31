import { CalendarClock, ExternalLink } from "lucide-react";
import type { EventSuggestionQueue as Queue } from "@/lib/schemas";
import { EVENT_KIND_LABELS } from "@/lib/schemas/constants";
import { eventPlace, eventWhen } from "@/lib/timetable/view";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";

/** "12 Oct" for when a suggestion came in, in IST. */
function sentOn(iso: string): string {
  const d = new Date(Date.parse(iso) + 5.5 * 3600_000);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

/**
 * Event suggestions on /admin/reports (Timetable PR 6, docs/plans/timetable-plan.md section 6), for admins only: the
 * pending queue, oldest first, read only. Members' suggestions need a grievance officer (pending item 15), so there is
 * no button that publishes, declines or edits one, and the page says so. Each row shows what was sent (name, organiser,
 * kind, India time, place, cost and the link's host) and when, never who sent it. The link opens in a new tab with no
 * referrer; the server never fetches it. Neutral colours only.
 */
export function EventSuggestionQueue({ queue }: { queue: Queue }) {
  return (
    <section aria-labelledby="event-suggestions-h" className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="event-suggestions-h" className="text-[1.1rem] font-semibold">
          Event suggestions
        </h2>
        <span className={LABEL}>{queue.total === 1 ? "1 pending" : `${queue.total} pending`}</span>
      </div>
      <p className="text-[0.84rem] text-muted">
        Read only. Members&apos; suggestions stay pending until a grievance officer is named, so none can go live from here yet. They never show on
        anyone&apos;s Timetable or in the Monday email.
      </p>
      {queue.rows.length === 0 ? (
        <p className="text-[0.84rem] text-muted">No suggestions waiting.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {queue.rows.map((r) => (
            <li key={r.id} className="flex min-w-0 flex-col gap-1 py-3 text-[0.86rem]">
              <b className="font-semibold text-ink [overflow-wrap:anywhere]">{r.title}</b>
              <span className="text-muted [overflow-wrap:anywhere]">
                {r.organiser} · {EVENT_KIND_LABELS[r.kind]} · {eventPlace({ ...r, distanceKm: null })}
                {r.cost ? ` · ${r.cost}` : ""}
              </span>
              <span className="inline-flex items-center gap-1.5 text-muted">
                <CalendarClock {...ICON} />
                {sentOn(r.startsAt)}, {eventWhen(r.startsAt, r.endsAt)}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  referrerPolicy="no-referrer"
                  className="inline-flex min-h-11 items-center gap-1.5 font-[550] text-ink underline underline-offset-2"
                >
                  {r.host}
                  <ExternalLink {...ICON} />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <small className="text-[0.78rem] text-muted">Sent {sentOn(r.createdAt)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {queue.total > queue.rows.length && <p className="text-[0.8rem] text-muted">Showing the oldest {queue.rows.length}.</p>}
    </section>
  );
}
