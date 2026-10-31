import { CalendarClock, ExternalLink } from "lucide-react";
import type { ManualEventAdminRow } from "@/lib/schemas";
import { eventPlace, eventWhen } from "@/lib/timetable/view";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7 Nov 2026" for an India date or the India day of an instant. */
function day(isoOrDate: string): string {
  const d = new Date(isoOrDate.length === 10 ? `${isoOrDate}T00:00:00Z` : Date.parse(isoOrDate) + 5.5 * 3600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const STATE_LABEL: Record<ManualEventAdminRow["state"], string> = {
  live: "Live",
  hidden: "Hidden",
  cancelled: "Cancelled",
  pending: "Pending",
  over: "Over",
  waiting: "Loads on the next daily run",
};

/**
 * Hand-entered events on /admin/reports (docs/timetable-sources.md), for admins only, read only: each event in
 * src/content/manual-events.json with its India time, place, the organiser's page, the day its date was checked and
 * whether it is live. Events are added, changed or taken out by editing that file in a PR; there is no form here.
 * The date evidence stays in the file. Neutral colours only: a state is not a gap or progress.
 */
export function ManualEventList({ rows }: { rows: ManualEventAdminRow[] }) {
  const live = rows.filter((r) => r.state === "live").length;
  return (
    <section aria-labelledby="manual-events-h" className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="manual-events-h" className="text-[1.1rem] font-semibold">
          Hand-entered events
        </h2>
        <span className={LABEL}>
          {live} live of {rows.length}
        </span>
      </div>
      <p className="text-[0.84rem] text-muted">
        Added by the team from organisers&apos; own pages. Read only: to add, change or take one out, edit src/content/manual-events.json in a pull
        request, and recheck each date on the organiser&apos;s page before the event. The daily event feed loads the file.
      </p>
      {rows.length === 0 ? (
        <p className="text-[0.84rem] text-muted">No hand-entered events.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key} className="flex min-w-0 flex-col gap-1 py-3 text-[0.86rem]">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="font-semibold text-ink [overflow-wrap:anywhere]">{r.title}</b>
                <span className={LABEL}>{STATE_LABEL[r.state]}</span>
              </span>
              <span className="text-muted [overflow-wrap:anywhere]">
                {r.organiser} · {eventPlace({ online: r.online, city: r.city, venue: null, distanceKm: null })}
              </span>
              <span className="inline-flex items-center gap-1.5 text-muted">
                <CalendarClock {...ICON} />
                {day(r.startsAt)}, {eventWhen(new Date(r.startsAt).toISOString(), new Date(r.endsAt).toISOString())}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  referrerPolicy="no-referrer"
                  className="inline-flex min-h-11 items-center gap-1.5 font-[550] text-ink underline underline-offset-2"
                >
                  {new URL(r.sourceUrl).hostname}
                  <ExternalLink {...ICON} />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <small className="text-[0.78rem] text-muted">Date checked {day(r.checkedOn)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
