import { Clock, ExternalLink, Lock, Zap } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { lengthLabel } from "@/lib/library/filter";
import type { EliteShelfCard, EliteShelfView } from "@/lib/schemas";
import { ELITE_SHELF_GROUP_LABELS, ELITE_SHELF_GROUPS, LIBRARY_KIND_LABELS } from "@/lib/schemas/constants";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const btn = "inline-flex min-h-9 items-center gap-1.5 self-start rounded-full border border-line-strong bg-surface px-3 text-[0.8rem] font-[550] text-ink hover:bg-surface-2";

/**
 * The Library's Elite tab (handoff 12l, prototype v44, Elite part 5): Paid courses, Playbooks and walkthroughs, and
 * Drills and labs. Until licensing deals exist the paid courses are "Coming soon" slots with no maker, price or link;
 * the rest are free sources from the reviewed catalog and playbooks and drills CareerMetro wrote. With Elite off every
 * card says what it is and "Opens with Elite", and the locked panel links to /elite; no link or step reaches the
 * browser. Elite violet marks Elite only.
 */
export function EliteShelf({ shelf, role }: { shelf: EliteShelfView; role: string | null }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id={`${id}-h`} className="font-sans text-[1.1rem] font-semibold">
          Elite shelf
        </h2>
        <span className="rounded-full bg-elite-soft px-2 py-0.5 font-mono text-[0.66rem] font-medium uppercase tracking-[0.06em] text-elite">Elite</span>
        <span className={`${LABEL} ml-auto`}>{role ? `For ${role}` : "For your goals"}</span>
      </div>
      <p className="max-w-[66ch] text-[0.86rem] text-muted">
        Playbooks, drills and labs, with paid courses to come, included with Elite. You never buy anything here, there are no ads or affiliate links, and
        we earn nothing from what you open. Like everything in the Library, finishing one moves your train, but only proof fills a gap.
      </p>

      {!shelf.elite && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-line-strong bg-surface px-4 py-3 text-[0.86rem]">
          <Lock size={18} {...ICON} className="shrink-0 text-elite" />
          <span className="min-w-[200px] flex-1">
            <b className="font-semibold">Opens with Elite.</b> Free during the beta.
          </span>
          <Link href="/elite" className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-elite px-3.5 text-[0.84rem] font-[550] text-on-elite hover:opacity-90">
            <Zap size={15} {...ICON} />
            Turn on Elite
          </Link>
        </div>
      )}

      {ELITE_SHELF_GROUPS.map((g) => {
        const cards = shelf.cards.filter((c) => c.group === g);
        if (!cards.length) return null;
        return (
          <section key={g} aria-labelledby={`${id}-${g}`} className="flex flex-col gap-2.5">
            <h3 id={`${id}-${g}`} className={`${LABEL} mt-1.5`}>
              {ELITE_SHELF_GROUP_LABELS[g]}
            </h3>
            <ul className="grid gap-3 min-[560px]:grid-cols-2 min-[1180px]:grid-cols-3">
              {cards.map((c) => (
                <ShelfCard key={c.id} card={c} elite={shelf.elite} />
              ))}
            </ul>
          </section>
        );
      })}

      <p className="max-w-[66ch] text-[0.8rem] text-muted">
        How the Elite shelf is picked: free sources from the same reviewed list as the rest of the Library, and playbooks and drills we write ourselves,
        each checked by someone who works in the role before it shows. Paid courses come only once we have agreements with their makers. Nobody pays us
        to be listed, and the order follows your goals, never who made it.
      </p>
    </section>
  );
}

const Opens = () => (
  <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[0.78rem] text-muted">
    <Lock size={13} {...ICON} className="text-elite" />
    Opens with Elite
  </span>
);

function ShelfCard({ card, elite }: { card: EliteShelfCard; elite: boolean }) {
  const frame = `flex min-w-0 flex-col gap-1.5 rounded-md border bg-surface p-3.5 ${card.type === "slot" ? "border-dashed border-line-strong" : elite ? "border-elite/35" : "border-dashed border-line-strong"}`;

  if (card.type === "slot") {
    return (
      <li className={frame} data-shelf-card="slot">
        <span className={LABEL}>Coming soon</span>
        <b className="text-[0.92rem] font-semibold">{card.label}</b>
        <small className="text-[0.78rem] leading-[1.45] text-muted">{card.summary}</small>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[0.78rem] text-muted">
          <Clock size={13} {...ICON} />
          Not open yet
        </span>
      </li>
    );
  }

  const goal = card.goal && <span className={`${LABEL} text-[0.66rem]`}>Goal: {card.goal}</span>;

  if (card.type === "free") {
    return (
      <li className={frame} data-shelf-card="free">
        <span className={LABEL}>
          Free · {LIBRARY_KIND_LABELS[card.kind]} · {lengthLabel(card.minutes)}
        </span>
        <b className="text-[0.92rem] font-semibold">{card.title}</b>
        <small className="text-[0.78rem] leading-[1.45] text-muted">
          {card.why} From {card.provider}.
        </small>
        {goal}
        {card.url ? (
          <a href={card.url} target="_blank" rel="noopener noreferrer" className={`${btn} mt-auto`} aria-label={`Open on ${card.provider}: ${card.title}, opens in a new tab`}>
            <ExternalLink size={14} {...ICON} />
            Open on {card.provider}
          </a>
        ) : (
          <Opens />
        )}
      </li>
    );
  }

  const drill = card.group === "drill";
  return (
    <li className={frame} data-shelf-card="own">
      <span className={`${LABEL} flex flex-wrap items-center gap-x-2 gap-y-1`}>
        {drill ? `Drill set · ${card.count} drills` : `Playbook · ${card.minutes} min read`}
        {!card.reviewed && <span className="rounded-full bg-surface-2 px-2 py-px font-sans text-[0.7rem] normal-case tracking-normal">Not yet checked</span>}
      </span>
      <b className="text-[0.92rem] font-semibold">{card.title}</b>
      <small className="text-[0.78rem] leading-[1.45] text-muted">{card.summary}</small>
      {goal}
      {card.parts ? (
        <details className="mt-auto pt-1">
          <summary className={`${btn} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{drill ? "Start drills" : "Read"}</summary>
          <ol className="mt-2.5 flex list-decimal flex-col gap-2 pl-5 text-[0.84rem]">
            {card.parts.map((p, i) => (
              <li key={i}>
                <span>{p.text}</span>
                {p.answer && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[0.8rem] font-[550] text-ink underline underline-offset-2">Show answer</summary>
                    <p className="mt-1 break-words text-[0.82rem] text-muted">{p.answer}</p>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <Opens />
      )}
    </li>
  );
}
