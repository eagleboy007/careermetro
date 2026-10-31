import { Users } from "lucide-react";
import Link from "next/link";
import { ridersCount, ridersMore } from "@/lib/map/riders-text";
import type { PitstopRiders } from "@/lib/schemas";
import { ICON } from "./map-parts";

/**
 * On your line (C13, docs/plans/on-your-line-plan.md): the people on a pitstop, in the Map's side panel only, never on
 * the drawing. "N people on this pitstop" (the server sends it only at 3 or more, opted-in people only), then up to
 * three of the viewer's connections by name, each a link to their profile when it has one, and how many more. Neutral
 * text: never cobalt (progress) or a gap colour. Nothing at all below 3 people.
 */
export function PitstopPeople({ riders }: { riders: PitstopRiders | undefined }) {
  if (!riders) return null;
  const more = ridersMore(riders);
  return (
    <div className="flex min-w-0 flex-col gap-1" data-pitstop-people>
      <p className="inline-flex items-center gap-2 text-[0.84rem] font-medium text-ink">
        <Users size={16} className="shrink-0 text-muted" {...ICON} />
        {ridersCount(riders)}
      </p>
      {riders.names.length > 0 && (
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Your connections on it</span>
          <ul className="flex flex-wrap items-center gap-x-3 text-[0.84rem] [overflow-wrap:anywhere]">
            {riders.names.map((p, i) => (
              <li key={`${p.name}-${i}`}>
                {p.handle ? (
                  <Link href={`/u/${p.handle}`} className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2 hover:text-muted">
                    {p.name}
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center text-ink">{p.name}</span>
                )}
              </li>
            ))}
            {more && <li className="inline-flex min-h-11 items-center text-muted">{more}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
