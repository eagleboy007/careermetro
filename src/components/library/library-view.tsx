"use client";

import {
  Award,
  BookOpen,
  BriefcaseBusiness,
  Check,
  CirclePlay,
  ExternalLink,
  FileText,
  FlaskConical,
  Lightbulb,
  Route,
  Search,
  TrainFront,
  Upload,
  Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { ICON, seg } from "@/components/map/map-parts";
import { StatusChip } from "@/components/ui/status-chip";
import { filtersOn, goalCards, goalOf, lengthLabel, moreResults, NO_FILTERS, pick, readyToProve, type LibraryFilters } from "@/lib/library/filter";
import type { LibraryGoal, LibraryItem, LibraryKind, LibraryView as View } from "@/lib/schemas";
import { LIBRARY_KIND_LABELS, LIBRARY_KINDS, LIBRARY_LENGTHS, LIBRARY_TAB_LABELS, LIBRARY_TABS } from "@/lib/schemas/constants";

type Tab = (typeof LIBRARY_TABS)[number];

const KIND_ICON: Record<LibraryKind, LucideIcon> = { course: BookOpen, video: CirclePlay, docs: FileText, practice: FlaskConical };
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const pill =
  "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-[11px] py-1 text-[0.78rem] font-[550] text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink";
const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-[15px] py-[9px] text-[0.86rem] font-[550]";
const primary = `${btn} bg-accent text-on-accent hover:opacity-90`;
const ghost = `${btn} border border-line-strong bg-surface text-ink hover:bg-surface-2`;
const EMPTY = "rounded-lg border border-dashed border-line p-6 text-center text-[0.9rem] text-muted";
const LENGTH_LABELS: Record<(typeof LIBRARY_LENGTHS)[number], string> = { 60: "Under 1 h", 300: "Under 5 h" };

/**
 * The Library (handoff 12a, prototype v44): free resources grouped by the person's open goals in map order, each with
 * Learn (or Brush up) and Prove, plus Your interests, Saved and Finished, search, type, length and Hindi filters, and a
 * details panel. Read only: links open the source site in a new tab, and nothing here fills a gap.
 */
export function LibraryView({ view }: { view: View }) {
  const [tab, setTab] = useState<Tab>("goals");
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<string | null>(() => view.onRide[0] ?? view.goals[0]?.resourceIds[0] ?? null);
  const detailId = useId();
  const set = (patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const onRide = useMemo(() => new Set(view.onRide), [view.onRide]);
  const finished = useMemo(() => new Set(view.finished), [view.finished]);
  const cards = useMemo(() => goalCards(view, filters), [view, filters]);
  const shownOnCards = useMemo(() => new Set(cards.flatMap((c) => c.items.map((i) => i.id))), [cards]);
  const more = useMemo(() => moreResults(view.items, filters, tab === "goals" ? shownOnCards : new Set<string>()), [view.items, filters, tab, shownOnCards]);
  const done = useMemo(() => pick(view.items, finished, filters), [view.items, finished, filters]);
  const ready = useMemo(() => readyToProve(view), [view]);
  // Search on the Finished tab also looks through the rest of the Library.
  const notDone = more.filter((i) => !finished.has(i.id));
  const item = view.items.find((i) => i.id === selected) ?? null;
  const noResume = view.role === null;

  const open = (id: string) => {
    setSelected(id);
    if (window.matchMedia("(max-width: 759px)").matches) document.getElementById(detailId)?.scrollIntoView({ block: "start" });
  };
  const row = (i: LibraryItem) => (
    <ResourceRow key={i.id} item={i} selected={i.id === item?.id} detailId={detailId} onRide={onRide.has(i.id)} finished={finished.has(i.id)} onOpen={() => open(i.id)} />
  );
  const shownCount =
    tab === "goals" ? shownOnCards.size + more.length : tab === "finished" ? done.length + notDone.length : more.length;

  return (
    <div className="grid min-w-0 min-[760px]:min-h-[700px] min-[760px]:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4 pb-8 min-[760px]:pr-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[2rem] font-semibold leading-[1.1]">Library</h2>
            <p className="mt-1.5 max-w-[60ch] text-[0.92rem] text-muted">
              Free courses, docs, videos and practice, picked for your goals. We link to the source and never host or sell anything.
            </p>
          </div>
          {view.role && <span className={LABEL}>Picked for {view.role}</span>}
        </div>

        <div role="group" aria-label="Show" className="inline-flex max-w-full gap-0.5 self-start overflow-x-auto rounded-full bg-surface-2 p-[3px]">
          {LIBRARY_TABS.map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} className={`${seg} min-h-9 whitespace-nowrap`} onClick={() => setTab(t)}>
              {LIBRARY_TAB_LABELS[t]}
              {t === "finished" && <span className="ml-1 font-mono text-[0.72rem] text-muted">{view.finished.length}</span>}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2.5 rounded-full border border-line-strong bg-surface px-3.5 py-[11px] text-[0.9rem] text-muted focus-within:outline-2 focus-within:outline-accent">
          <Search size={18} {...ICON} />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search a skill, topic or source"
            aria-label="Search the Library"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none"
          />
        </label>

        <div role="group" aria-label="Filters" className="-mr-4 flex items-center gap-x-3.5 gap-y-2.5 overflow-x-auto pb-1 pr-4 min-[760px]:mr-0 min-[760px]:flex-wrap min-[760px]:pr-0">
          <div role="group" aria-label="Type" className="inline-flex flex-none gap-1">
            <button type="button" aria-pressed={filters.kind === null} className={pill} onClick={() => set({ kind: null })}>
              All
            </button>
            {LIBRARY_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button key={k} type="button" aria-pressed={filters.kind === k} className={pill} onClick={() => set({ kind: k })}>
                  <Icon size={14} {...ICON} />
                  {LIBRARY_KIND_LABELS[k]}
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Length" className="inline-flex flex-none gap-1">
            <button type="button" aria-pressed={filters.under === null} className={pill} onClick={() => set({ under: null })}>
              Any length
            </button>
            {LIBRARY_LENGTHS.map((m) => (
              <button key={m} type="button" aria-pressed={filters.under === m} className={pill} onClick={() => set({ under: m })}>
                {LENGTH_LABELS[m]}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Language" className="inline-flex flex-none gap-1">
            <button type="button" aria-pressed={!filters.hindi} className={pill} onClick={() => set({ hindi: false })}>
              Any language
            </button>
            <button type="button" aria-pressed={filters.hindi} className={pill} onClick={() => set({ hindi: true })}>
              Hindi
            </button>
          </div>
        </div>

        {noResume && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 text-[0.88rem]">
            <Upload size={18} {...ICON} className="shrink-0" />
            <span className="min-w-[200px] flex-1">
              <b className="font-semibold">Add your resume to get picks for your gaps.</b> Until then, search any topic.
            </span>
            <Link href="/today" className={`${ghost} px-3 py-1.5 text-[0.8rem]`}>
              Add resume
            </Link>
          </div>
        )}

        <div className="flex flex-col gap-[18px]">
          {tab === "goals" && (
            <>
              {cards.map((c) => (
                <GoalCard key={c.goal.goalId ?? c.goal.skillId} goal={c.goal} filtered={filtersOn(filters)}>
                  {c.items.map(row)}
                </GoalCard>
              ))}
              {!noResume && !view.goals.length && !filtersOn(filters) && (
                <p className={EMPTY}>Every goal on your line is proved or set aside. Search any topic above to keep learning.</p>
              )}
              {more.length > 0 && <ResultList title={cards.length ? "More in the Library" : "In the Library"}>{more.map(row)}</ResultList>}
              {filtersOn(filters) && !cards.length && !more.length && <p className={EMPTY}>Nothing matches. Try another word or clear a filter.</p>}
            </>
          )}

          {tab === "interests" && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">Your choice</span>
                <p className="basis-full text-[0.84rem] text-muted">From the interests on your profile. These never change your goals or your job matches.</p>
              </div>
              <p className={EMPTY}>Your profile has no interests yet, so there are no picks here. Search any topic above to look through the whole Library.</p>
              {more.length > 0 && <ResultList title="In the Library">{more.map(row)}</ResultList>}
            </>
          )}

          {tab === "saved" && (
            <>
              <p className={EMPTY}>Saving isn&apos;t on yet. Until it is, the courses for your goals stay under For your goals and on your path.</p>
              {more.length > 0 && <ResultList title="In the Library">{more.map(row)}</ResultList>}
            </>
          )}

          {tab === "finished" && (
            <>
              {ready.map((g) => (
                <div key={g.goalId ?? g.skillId} className="flex flex-wrap items-center gap-3 rounded-[18px] bg-accent-soft px-4 py-3.5 text-ink">
                  <Route size={18} {...ICON} className="shrink-0 text-accent" />
                  <span className="min-w-[200px] flex-1 text-[0.88rem]">
                    <b className="font-semibold">Ready to prove {g.name}?</b> Finishing a course doesn&apos;t fill the gap. The proof at Pitstop {g.provePitstop} does.
                  </span>
                  <Link href="/map" className={`${primary} px-3 py-1.5 text-[0.8rem]`}>
                    Prove it on the Map
                  </Link>
                </div>
              ))}
              {done.length > 0 ? (
                <ResultList title="Finished">{done.map(row)}</ResultList>
              ) : (
                <p className={EMPTY}>
                  {view.finished.length
                    ? "Nothing finished matches. Try another word or clear a filter."
                    : "Nothing finished yet. When you finish a course, tick it on today's ride. We can't see your progress on other sites."}
                </p>
              )}
              {notDone.length > 0 && <ResultList title="In the Library">{notDone.map(row)}</ResultList>}
            </>
          )}
        </div>
        <p role="status" className="sr-only">
          {filtersOn(filters) ? `${shownCount} ${shownCount === 1 ? "resource" : "resources"} shown` : ""}
        </p>
      </div>

      <aside
        id={detailId}
        aria-label="Resource details"
        className="flex min-w-0 flex-col gap-[22px] border-t border-line pt-5 min-[760px]:border-l min-[760px]:border-t-0 min-[760px]:pl-[22px] min-[760px]:pt-1"
      >
        {item && <ResourceDetail key={item.id} item={item} goal={goalOf(view.goals, item.id)} onRide={onRide.has(item.id)} finished={finished.has(item.id)} />}
        <section aria-labelledby={`${detailId}-how`} className="flex flex-col gap-2">
          <h3 id={`${detailId}-how`} className={LABEL}>
            How the Library is picked
          </h3>
          <ul className="flex flex-col gap-2 text-[0.82rem] text-muted">
            {[
              "Free to learn, always. If a certificate exam has a fee, the source site says so, and we never take a cut.",
              "No ads and no affiliate links. Nobody pays to be listed.",
              "Picked from a reviewed list of free sources, and re-checked when a link breaks.",
              "Learning moves your train along a pitstop. Only proof fills a gap.",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check size={14} {...ICON} className="mt-0.5 shrink-0 text-ink" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby={`${detailId}-suggest`} className="flex flex-col gap-2 rounded-[18px] border border-line p-4">
          <h3 id={`${detailId}-suggest`} className={LABEL}>
            Suggest a free resource
          </h3>
          <p className="text-[0.82rem] text-muted">Soon: send a link and a reviewer checks it before anyone else sees it.</p>
        </section>
      </aside>
    </div>
  );
}

function ResultList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-[20px] border border-line bg-surface">
      <h3 className="border-b border-line px-4 py-3.5 text-[1.08rem] font-semibold">{title}</h3>
      <ul className="flex flex-col px-4 py-2">{children}</ul>
    </section>
  );
}

const Pitstop = ({ n, now }: { n: number; now: boolean }) => (
  <span aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded-[6px] text-[0.66rem] ${now ? "bg-accent text-on-accent" : "bg-surface-2 text-ink"}`}>
    {n}
  </span>
);

function GoalCard({ goal, filtered, children }: { goal: LibraryGoal; filtered: boolean; children: ReactNode[] }) {
  const brushUp = goal.learnPitstop === null;
  const pitstops = brushUp ? `Pitstop ${goal.provePitstop}` : `Pitstops ${goal.learnPitstop} and ${goal.provePitstop}`;
  const certs = goal.certificates;
  return (
    <section aria-label={goal.name} className="overflow-hidden rounded-[20px] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3.5">
        <h3 className="mr-auto text-[1.08rem] font-semibold">{goal.name}</h3>
        <StatusChip status={goal.status} />
        <span className={`${LABEL} whitespace-nowrap`}>{pitstops}</span>
      </div>

      <div className="px-4 pb-3.5 pt-1.5">
        <div className={`${LABEL} flex items-center gap-2 pb-1 pt-2.5 text-[0.68rem]`}>
          {goal.learnPitstop !== null && <Pitstop n={goal.learnPitstop} now={goal.now && !goal.learnDone} />}
          <span>
            {brushUp ? "Brush up" : "Learn"}
            {goal.learnPitstop !== null && <span className="sr-only"> · Pitstop {goal.learnPitstop}</span>}
          </span>
          <em className="ml-auto hidden font-sans text-[0.76rem] normal-case not-italic tracking-normal min-[760px]:inline">
            {goal.learnDone ? "Done. Prove it to fill the gap." : "Moves your train along. Does not fill the gap."}
          </em>
        </div>
        {brushUp && (
          <p className="flex items-start gap-2 px-0.5 pt-1 text-[0.8rem] text-muted">
            <Lightbulb size={14} {...ICON} className="mt-0.5 shrink-0" />
            <span>This goal starts at proof: your resume already shows some of it. These are here if you feel rusty.</span>
          </p>
        )}
        {children.length ? (
          <ul className="flex flex-col">{children}</ul>
        ) : (
          <p className="px-0.5 pt-1 text-[0.8rem] text-muted">{filtered ? "Nothing matches these filters." : "No free resource on our list covers this skill yet."}</p>
        )}
      </div>

      <div className="border-t border-dashed border-line px-4 pb-3.5 pt-1.5">
        <div className={`${LABEL} flex items-center gap-2 pb-1 pt-2.5 text-[0.68rem]`}>
          <Pitstop n={goal.provePitstop} now={goal.now && goal.learnDone} />
          <span>
            Prove<span className="sr-only"> · Pitstop {goal.provePitstop}</span>
          </span>
          <em className="ml-auto hidden font-sans text-[0.76rem] normal-case not-italic tracking-normal min-[760px]:inline">Any one of these fills the gap.</em>
        </div>
        <ul className="flex flex-col gap-2 pt-1">
          <ProveOption Icon={Video} title="Skill check" detail="A short check on camera, free." action={<Later />} />
          <ProveOption
            Icon={Award}
            title={certs.length ? (certs.length === 1 ? certs[0].name : `${certs[0].name}, or ${certs.length - 1} more`) : "Certification"}
            detail={
              certs.length
                ? "Checked with the issuer, in your name. Any exam fee is charged by the issuer."
                : "No certificate on our list covers this skill yet. Use a skill check or work experience."
            }
            action={
              certs.length ? (
                <Link href="/map" className={`${ghost} px-3 py-1.5 text-[0.8rem]`}>
                  Add on the Map
                </Link>
              ) : null
            }
          />
          <ProveOption Icon={BriefcaseBusiness} title="Work experience" detail="A manager confirms you used it at work." action={<Later />} />
        </ul>
      </div>
    </section>
  );
}

const Later = () => <span className="whitespace-nowrap text-[0.78rem] text-muted">Opens later</span>;

function ProveOption({ Icon, title, detail, action }: { Icon: LucideIcon; title: string; detail: string; action: ReactNode }) {
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 rounded-[14px] border border-dashed border-line bg-bg px-3 py-2.5 min-[760px]:grid-cols-[36px_minmax(0,1fr)_auto]">
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-surface text-ink min-[760px]:h-9 min-[760px]:w-9">
        <Icon size={17} {...ICON} />
      </span>
      <span className="flex min-w-0 flex-col">
        <b className="text-[0.9rem] font-semibold">{title}</b>
        <small className="text-[0.78rem] text-muted">{detail}</small>
      </span>
      {action && <span className="col-start-2 justify-self-start min-[760px]:col-start-3">{action}</span>}
    </li>
  );
}

function Meta({ item }: { item: LibraryItem }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1 text-[0.78rem] text-muted">
      {[item.provider, LIBRARY_KIND_LABELS[item.kind], lengthLabel(item.minutes)].map((m, i) => (
        <span key={i} className="contents">
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>{m}</span>
        </span>
      ))}
    </span>
  );
}

function ResourceRow({
  item,
  selected,
  detailId,
  onRide,
  finished,
  onOpen,
}: {
  item: LibraryItem;
  selected: boolean;
  detailId: string;
  onRide: boolean;
  finished: boolean;
  onOpen: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <li className={`relative -mx-2 grid grid-cols-[32px_minmax(0,1fr)] items-start gap-2.5 rounded-[14px] px-2 py-2.5 min-[760px]:grid-cols-[36px_minmax(0,1fr)] min-[760px]:gap-3 ${selected ? "bg-surface-2" : "hover:bg-bg"}`}>
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-surface-2 text-ink min-[760px]:h-9 min-[760px]:w-9">
        <Icon size={17} {...ICON} />
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <button
          type="button"
          onClick={onOpen}
          aria-current={selected || undefined}
          aria-controls={detailId}
          className="text-left text-[0.93rem] font-semibold leading-[1.3] outline-none after:absolute after:inset-0 after:rounded-[14px] focus-visible:after:outline-2 focus-visible:after:outline-offset-1 focus-visible:after:outline-accent"
        >
          {item.title}
        </button>
        <Meta item={item} />
        {(finished || onRide || item.language === "Hindi") && (
          <span className="mt-[3px] flex flex-wrap gap-1.5">
            {finished ? (
              <span className="inline-flex items-center gap-1 text-[0.74rem] text-muted">
                <Check size={13} {...ICON} />
                Finished
              </span>
            ) : (
              onRide && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] bg-accent-soft px-2 py-[3px] font-mono text-[0.66rem] uppercase tracking-[0.05em] text-accent">
                  <TrainFront size={12} {...ICON} />
                  On your ride
                </span>
              )
            )}
            {item.language === "Hindi" && <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">Hindi</span>}
          </span>
        )}
      </span>
    </li>
  );
}

function ResourceDetail({ item, goal, onRide, finished }: { item: LibraryItem; goal: LibraryGoal | null; onRide: boolean; finished: boolean }) {
  const Icon = KIND_ICON[item.kind];
  const counts = goal
    ? goal.learnPitstop
      ? `Counts toward Pitstop ${goal.learnPitstop}, learning ${goal.name}. It moves your train along. To fill the gap, prove it at Pitstop ${goal.provePitstop}.`
      : `Practice for Pitstop ${goal.provePitstop}. Only the proof fills the ${goal.name} gap.`
    : "Not on your goals. Learning it never changes your goals, your gaps or your job matches.";
  return (
    <section aria-label={item.title} className="flex animate-[sheet-in_.3s_cubic-bezier(.2,.8,.2,1)] flex-col gap-3.5 min-[760px]:sticky min-[760px]:top-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink">
          <Icon size={17} {...ICON} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[1.2rem] font-semibold leading-[1.2]">{item.title}</h3>
          <small className="mt-[3px] block text-[0.8rem] text-muted">
            {item.provider} · {LIBRARY_KIND_LABELS[item.kind]} · {lengthLabel(item.minutes)} · {item.language}
          </small>
        </div>
      </div>
      <p className="text-[0.88rem] text-muted">Covers {item.skills.join(", ")}.</p>
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-bg px-3.5 py-3 text-[0.86rem]">
        <b className="font-semibold">{goal ? `For your ${goal.name} goal` : "Your choice"}</b>
        <span className="text-[0.82rem] text-muted">{counts}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-[0.84rem]">
        <dt className="text-muted">Cost</dt>
        <dd>Free to learn</dd>
        <dt className="text-muted">Certificate</dt>
        <dd>If the site gives one, it shows as learning, never as proof.</dd>
        <dt className="text-muted">Your tick</dt>
        <dd>{finished ? "Finished" : onRide ? "On today's ride" : "Not started here"}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className={primary} aria-label={`Open on ${item.provider} (opens in a new tab)`}>
          <ExternalLink size={17} {...ICON} />
          Open on {item.provider}
        </a>
        {onRide && !finished && (
          <Link href="/today" className={ghost}>
            <TrainFront size={17} {...ICON} />
            Finished it? Tick it on Today
          </Link>
        )}
      </div>
      <p className="text-[0.78rem] text-muted">
        We can&apos;t see your progress on other sites, so Finished is your own tick on your ride or your path. Adding it to your rides and reporting a
        broken link come soon.
      </p>
    </section>
  );
}
