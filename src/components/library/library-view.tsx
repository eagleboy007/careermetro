"use client";

import {
  Award,
  BookOpen,
  Bookmark,
  BriefcaseBusiness,
  Check,
  CirclePlay,
  ExternalLink,
  FileText,
  Flag,
  FlaskConical,
  Lightbulb,
  Lock,
  Plus,
  Route,
  Search,
  TrainFront,
  Upload,
  Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ICON, seg } from "@/components/map/map-parts";
import { ShowMore, usePaged } from "@/components/ui/show-more";
import { StatusChip } from "@/components/ui/status-chip";
import { filtersOn, goalCards, goalOf, lengthLabel, moreResults, NO_FILTERS, pick, readyToProve, type LibraryFilters } from "@/lib/library/filter";
import type { EliteShelfView, LibraryGoal, LibraryItem, LibraryKind, LibraryView as View } from "@/lib/schemas";
import {
  LIBRARY_KIND_LABELS,
  LIBRARY_KINDS,
  LIBRARY_LENGTHS,
  LIBRARY_TAB_LABELS,
  LIBRARY_TABS,
  ON_RIDE_MAX,
  RESOURCE_REPORT_REASON_LABELS,
  RESOURCE_REPORT_REASONS,
  RIDE_SPLIT_OVER_MINUTES,
} from "@/lib/schemas/constants";
import { EliteShelf } from "./elite-shelf";

export type LibraryTab = (typeof LIBRARY_TABS)[number];

const KIND_ICON: Record<LibraryKind, LucideIcon> = { course: BookOpen, video: CirclePlay, docs: FileText, practice: FlaskConical };
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const pill =
  "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-[11px] py-1 text-[0.78rem] font-[550] text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink";
const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-[15px] py-[9px] text-[0.86rem] font-[550]";
const primary = `${btn} bg-accent text-on-accent hover:opacity-90`;
const ghost = `${btn} border border-line-strong bg-surface text-ink hover:bg-surface-2`;
const EMPTY = "rounded-lg border border-dashed border-line p-6 text-center text-[0.9rem] text-muted";
const LENGTH_LABELS: Record<(typeof LIBRARY_LENGTHS)[number], string> = { 60: "Under 1 h", 300: "Under 5 h" };
const textButton = "self-start text-[0.8rem] text-muted underline underline-offset-2 hover:text-ink aria-disabled:opacity-60";

/** What a Library action answers: null when it worked, or the words to show (src/app/(app)/library/actions.ts). */
export type LibraryActionResult = { error: string | null; resourceId?: string | null };

/** Save, finish, ride, report and suggest, kept on the server. Without them (examples, /design) only the screen changes. */
export type LibraryActions = {
  mark: (resourceId: string, mark: string, on: boolean) => Promise<LibraryActionResult>;
  report: (resourceId: string, reason: string) => Promise<LibraryActionResult>;
  suggest: (url: string, skillId: string | null) => Promise<LibraryActionResult>;
};

const FAILED = "That didn't work. Please try again.";
const RIDE_FULL = `You have ${ON_RIDE_MAX} on your rides. Finish or remove one first.`;
const REPORTED = "Thanks. A reviewer will check this link.";
const SUGGESTED = "Thanks. A reviewer will check it before it goes in the Library.";
const EMPTY_SAVED = "Nothing saved yet. Tap the bookmark on anything you want to come back to.";

/**
 * The Library (handoff 12a, prototype v44): free resources grouped by the person's open goals in map order, each with
 * Learn (or Brush up) and Prove, plus Your interests, Saved and Finished, search, type, length and Hindi filters, and a
 * details panel. Links open the source site in a new tab, and nothing here fills a gap. Library part 2
 * (docs/plans/library-part-2-plan.md): the bookmark on each row and in the panel, "I finished this", Add to my rides
 * (split into daily parts of about 25 minutes when longer than an hour), Report a broken link and Suggest a free
 * resource, kept on the server through `actions` and told in a toast; without `actions` only the screen changes. The
 * fifth tab, Elite, is the Elite shelf (handoff 12l): locked with "Turn on Elite" while Elite is off.
 */
export function LibraryView({
  view,
  shelf,
  tab: firstTab = "goals",
  actions,
  initialSelected,
}: {
  view: View;
  shelf: EliteShelfView;
  tab?: LibraryTab;
  actions?: LibraryActions;
  /** The item the details panel opens on (for /design); else today's first ride course, or the first goal's first. */
  initialSelected?: string;
}) {
  const [tab, setTab] = useState<LibraryTab>(firstTab);
  const [saved, setSaved] = useState<string[]>(view.saved);
  const [ticked, setTicked] = useState(() => new Set(view.ticked));
  const [added, setAdded] = useState(() => new Set(view.added));
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (text: string) => {
    // Cleared first, so the same words twice are read out twice.
    setToast(null);
    requestAnimationFrame(() => setToast(text));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  };
  /** Runs a change on the server; if it fails, the screen goes back and says why. Without actions it only says `done`. */
  const keep = (call: Promise<LibraryActionResult> | undefined, undo: () => void, done: string) => {
    if (!call) return say(done);
    call.then(
      (r) => {
        if (!r.error) return say(done);
        undo();
        say(r.error);
      },
      () => {
        undo();
        say(FAILED);
      },
    );
  };
  const suggestId = useId();
  const [suggestFocus, setSuggestFocus] = useState(0);
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<string | null>(() => initialSelected ?? view.onRide[0] ?? view.goals[0]?.resourceIds[0] ?? null);
  const detailId = useId();
  const set = (patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const onRide = useMemo(() => new Set(view.onRide), [view.onRide]);
  const rideCourses = useMemo(() => new Set(view.rideCourses), [view.rideCourses]);
  const savedSet = useMemo(() => new Set(saved), [saved]);
  // Finished is the person's own tick: on a ride, on the Path, or "I finished this" here.
  const finished = useMemo(() => new Set([...view.finished, ...ticked]), [view.finished, ticked]);
  const cards = useMemo(() => goalCards(view, filters), [view, filters]);
  const shownOnCards = useMemo(() => new Set(cards.flatMap((c) => c.items.map((i) => i.id))), [cards]);
  const more = useMemo(() => moreResults(view.items, filters, tab === "goals" ? shownOnCards : new Set<string>()), [view.items, filters, tab, shownOnCards]);
  const done = useMemo(() => pick(view.items, finished, filters), [view.items, finished, filters]);
  const savedItems = useMemo(() => {
    const byId = new Map(view.items.map((i) => [i.id, i]));
    const shown = new Set(pick(view.items, savedSet, filters).map((i) => i.id));
    // Newest first, as saved.
    return saved.flatMap((id) => (shown.has(id) ? [byId.get(id)!] : []));
  }, [view.items, saved, savedSet, filters]);
  const ready = useMemo(() => readyToProve({ goals: view.goals, finished: [...finished] }), [view.goals, finished]);
  // Search on the Finished and Saved tabs also looks through the rest of the Library.
  const notDone = more.filter((i) => !finished.has(i.id));
  const notSaved = more.filter((i) => !savedSet.has(i.id));
  const item = view.items.find((i) => i.id === selected) ?? null;
  const noResume = view.role === null;

  const open = (id: string) => {
    setSelected(id);
    if (window.matchMedia("(max-width: 759px)").matches) document.getElementById(detailId)?.scrollIntoView({ block: "start" });
  };

  const toggleSave = (i: LibraryItem) => {
    const was = savedSet.has(i.id);
    const flip = (on: boolean) => setSaved((s) => (on ? [i.id, ...s.filter((x) => x !== i.id)] : s.filter((x) => x !== i.id)));
    flip(!was);
    keep(actions?.mark(i.id, "saved", !was), () => flip(was), was ? "Removed from saved." : "Saved to your Library.");
  };
  const setFinished = (i: LibraryItem, on: boolean) => {
    const flip = (yes: boolean) =>
      setTicked((t) => {
        const next = new Set(t);
        if (yes) next.add(i.id);
        else next.delete(i.id);
        return next;
      });
    flip(on);
    const goal = goalOf(view.goals, i.id);
    const words = on
      ? `Marked finished.${goal ? ` Next on this goal: prove ${goal.name} at Pitstop ${goal.provePitstop}.` : ""}`
      : view.finished.includes(i.id)
        ? "Unticked. Your ride or Path tick still counts it as finished."
        : "No longer marked finished.";
    keep(actions?.mark(i.id, "finished", on), () => flip(!on), words);
  };
  const setRide = (i: LibraryItem, on: boolean) => {
    if (on && added.size >= ON_RIDE_MAX) return say(RIDE_FULL);
    const flip = (yes: boolean) =>
      setAdded((a) => {
        const next = new Set(a);
        if (yes) next.add(i.id);
        else next.delete(i.id);
        return next;
      });
    flip(on);
    const words = !on ? "Taken off your rides." : i.minutes > RIDE_SPLIT_OVER_MINUTES ? "Added to your rides, in parts of about 25 minutes." : "Added to your rides.";
    keep(actions?.mark(i.id, "onRide", on), () => flip(!on), words);
  };
  const report = (i: LibraryItem, reason: string) => keep(actions?.report(i.id, reason), () => {}, REPORTED);
  const suggest = async (url: string, skillId: string | null): Promise<boolean> => {
    if (!actions) {
      say(SUGGESTED);
      return true;
    }
    try {
      const r = await actions.suggest(url, skillId);
      if (!r.error) {
        say(SUGGESTED);
        return true;
      }
      say(r.error);
      // A link already in the catalog: open it here.
      if (r.resourceId && view.items.some((x) => x.id === r.resourceId)) open(r.resourceId);
      return false;
    } catch {
      say(FAILED);
      return false;
    }
  };

  const row = (i: LibraryItem) => (
    <ResourceRow
      key={i.id}
      item={i}
      selected={i.id === item?.id}
      detailId={detailId}
      onRide={onRide.has(i.id) || added.has(i.id)}
      finished={finished.has(i.id)}
      saved={savedSet.has(i.id)}
      onOpen={() => open(i.id)}
      onSave={() => toggleSave(i)}
    />
  );
  const shownCount =
    tab === "goals"
      ? shownOnCards.size + more.length
      : tab === "finished"
        ? done.length + notDone.length
        : tab === "saved"
          ? savedItems.length + notSaved.length
          : more.length;

  return (
    <div className="grid min-w-0 min-[760px]:min-h-[700px] min-[760px]:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4 pb-8 min-[760px]:pr-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[2rem] font-semibold leading-[1.1]">Library</h1>
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
              {t === "saved" && <span className="ml-1 font-mono text-[0.72rem] text-muted">{saved.length}</span>}
              {t === "finished" && <span className="ml-1 font-mono text-[0.72rem] text-muted">{finished.size}</span>}
              {t === "elite" && !shelf.elite && (
                <span className="ml-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-elite-soft text-elite">
                  <Lock size={11} {...ICON} />
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "elite" ? (
          <EliteShelf shelf={shelf} role={view.role} />
        ) : (
          <>
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
                  <p className={EMPTY}>
                    Your profile has no interests yet, so there are no picks here. Search any topic above, or{" "}
                    <button type="button" className="font-[550] text-ink underline underline-offset-2" onClick={() => setSuggestFocus((n) => n + 1)}>
                      suggest a free resource
                    </button>{" "}
                    and a reviewer will look at it.
                  </p>
                  {more.length > 0 && <ResultList title="In the Library">{more.map(row)}</ResultList>}
                </>
              )}

              {tab === "saved" && (
                <>
                  {savedItems.length > 0 ? (
                    <PagedResultList title="Saved" items={savedItems} row={row} noun="saved items" />
                  ) : (
                    <p className={EMPTY}>{saved.length ? "Nothing saved matches. Try another word or clear a filter." : EMPTY_SAVED}</p>
                  )}
                  {notSaved.length > 0 && <ResultList title="In the Library">{notSaved.map(row)}</ResultList>}
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
                    <PagedResultList title="Finished" items={done} row={row} noun="finished items" />
                  ) : (
                    <p className={EMPTY}>
                      {finished.size
                        ? "Nothing finished matches. Try another word or clear a filter."
                        : "Nothing finished yet. When you finish something, tick it in the details. We can't see your progress on other sites."}
                    </p>
                  )}
                  {notDone.length > 0 && <ResultList title="In the Library">{notDone.map(row)}</ResultList>}
                </>
              )}
            </div>
          </>
        )}
        <p role="status" className="sr-only">
          {tab !== "elite" && filtersOn(filters) ? `${shownCount} ${shownCount === 1 ? "resource" : "resources"} shown` : ""}
        </p>
        <p
          role="status"
          className={`pointer-events-none fixed bottom-24 left-1/2 z-40 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-2xl bg-ink px-4 py-2.5 text-[0.84rem] font-[550] text-bg transition-opacity min-[700px]:rounded-full min-[760px]:bottom-6 ${toast ? "opacity-100" : "opacity-0"}`}
        >
          {toast}
        </p>
      </div>

      <aside
        id={detailId}
        aria-label="Resource details"
        className="flex min-w-0 flex-col gap-[22px] border-t border-line pt-5 min-[760px]:border-l min-[760px]:border-t-0 min-[760px]:pl-[22px] min-[760px]:pt-1"
      >
        {item && (
          <ResourceDetail
            key={item.id}
            item={item}
            goal={goalOf(view.goals, item.id)}
            onRide={onRide.has(item.id)}
            added={added.has(item.id)}
            rideCourse={rideCourses.has(item.id)}
            finished={finished.has(item.id)}
            ticked={ticked.has(item.id)}
            saved={savedSet.has(item.id)}
            onSave={() => toggleSave(item)}
            onFinished={(on) => setFinished(item, on)}
            onRideChange={(on) => setRide(item, on)}
            onReport={(reason) => report(item, reason)}
          />
        )}
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
        <SuggestPanel id={suggestId} goals={view.goals} focusRequest={suggestFocus} onSend={suggest} />
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

/** A Saved or Finished list, which can hold hundreds of items: 20 show at a time, then "Show more" (T147). */
function PagedResultList({ title, items, row, noun }: { title: string; items: LibraryItem[]; row: (i: LibraryItem) => ReactNode; noun: string }) {
  const paged = usePaged(items);
  const list = useRef<HTMLUListElement>(null);
  return (
    <section aria-label={title} className="overflow-hidden rounded-[20px] border border-line bg-surface">
      <h3 className="border-b border-line px-4 py-3.5 text-[1.08rem] font-semibold">{title}</h3>
      <ul ref={list} className="flex flex-col px-4 py-2">
        {paged.shown.map(row)}
      </ul>
      <ShowMore left={paged.left} shown={paged.shown.length} onMore={paged.more} list={list} noun={noun} className="flex px-4 pb-3.5" />
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
  saved,
  onOpen,
  onSave,
}: {
  item: LibraryItem;
  selected: boolean;
  detailId: string;
  onRide: boolean;
  finished: boolean;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <li
      className={`relative -mx-2 grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[14px] px-2 py-2.5 min-[760px]:grid-cols-[36px_minmax(0,1fr)_auto] min-[760px]:gap-3 ${selected ? "bg-surface-2" : "hover:bg-bg"}`}
    >
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
      <SaveButton title={item.title} saved={saved} onSave={onSave} />
    </li>
  );
}

/** The bookmark: pressed when saved. Above the row's own button, so a tap saves rather than opens. */
function SaveButton({ title, saved, onSave }: { title: string; saved: boolean; onSave: () => void }) {
  return (
    <button
      type="button"
      onClick={onSave}
      aria-pressed={saved}
      aria-label={`Save ${title}`}
      className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-line text-muted hover:text-ink aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink"
    >
      <Bookmark size={16} {...ICON} className={saved ? "fill-current" : undefined} />
    </button>
  );
}

/**
 * "Link broken or out of date?": a small menu of fixed reasons. Picking one sends the report; a second report of the
 * same link says the same and stores nothing new. Focus goes back to the link after a pick, never to the page.
 */
export function ReportLink({ title, onReport, initialOpen = false }: { title: string; onReport?: (reason: string) => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [back, setBack] = useState(0);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (back) toggle.current?.focus();
  }, [back]);
  return (
    // Escape closes the reasons and puts focus back on the button that opened them.
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setOpen(false);
        setBack((n) => n + 1);
      }}
    >
      <button ref={toggle} type="button" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((o) => !o)} className={`${textButton} inline-flex items-center gap-1.5`}>
        <Flag size={14} {...ICON} />
        Link broken or out of date?
      </button>
      {open && (
        <div id={menuId} role="group" aria-label={`Report ${title}`} className="flex flex-wrap gap-1.5">
          {RESOURCE_REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className={pill}
              onClick={() => {
                onReport?.(r);
                setOpen(false);
                setBack((n) => n + 1);
              }}
            >
              {RESOURCE_REPORT_REASON_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Suggest a free resource": paste a link, pick the open goal it is for (or Other) and send it for review. An empty
 * link moves focus back to the box. `focusRequest` counts asks from elsewhere (Your interests) to focus the box.
 * Without `onSend` (/design) a send only clears the box.
 */
export function SuggestPanel({
  id,
  goals,
  focusRequest = 0,
  onSend,
  initialUrl = "",
}: {
  id: string;
  goals: LibraryGoal[];
  focusRequest?: number;
  onSend?: (url: string, skillId: string | null) => Promise<boolean>;
  initialUrl?: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [skill, setSkill] = useState<string | null>(goals[0]?.skillId ?? null);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequest) {
      box.current?.scrollIntoView({ block: "center" });
      box.current?.focus();
    }
  }, [focusRequest]);
  const chips = [...new Map(goals.map((g) => [g.skillId, g.name])).entries()].slice(0, 8);
  const send = async () => {
    if (sending) return;
    if (!url.trim()) return box.current?.focus();
    setSending(true);
    const ok = onSend ? await onSend(url.trim(), skill) : true;
    setSending(false);
    if (ok) setUrl("");
  };
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-2.5 rounded-[18px] border border-line p-4">
      <h3 id={`${id}-h`} className={LABEL}>
        Suggest a free resource
      </h3>
      <input
        ref={box}
        type="url"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
        placeholder="Paste a link"
        aria-label="Link to a free resource"
        maxLength={2000}
        className="min-h-11 rounded-full border border-line-strong bg-surface px-3.5 text-[0.88rem] text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />
      <div role="group" aria-label="For which goal" className="flex flex-wrap gap-1.5">
        {chips.map(([skillId, name]) => (
          <button key={skillId} type="button" aria-pressed={skill === skillId} className={pill} onClick={() => setSkill(skillId)}>
            {name}
          </button>
        ))}
        <button type="button" aria-pressed={skill === null} className={pill} onClick={() => setSkill(null)}>
          Other
        </button>
      </div>
      <button type="button" aria-disabled={sending || undefined} onClick={() => void send()} className={`${ghost} self-start px-3 py-1.5 text-[0.8rem] aria-disabled:opacity-60`}>
        <Plus size={16} {...ICON} />
        Send for review
      </button>
      <small className="text-[0.78rem] text-muted">A reviewer checks it before anyone else sees it.</small>
    </section>
  );
}

function ResourceDetail({
  item,
  goal,
  onRide,
  added,
  rideCourse,
  finished,
  ticked,
  saved,
  onSave,
  onFinished,
  onRideChange,
  onReport,
}: {
  item: LibraryItem;
  goal: LibraryGoal | null;
  onRide: boolean;
  added: boolean;
  /** One of its goal's own ride courses: on the rides already, with nothing to add. */
  rideCourse: boolean;
  finished: boolean;
  ticked: boolean;
  saved: boolean;
  onSave: () => void;
  onFinished: (on: boolean) => void;
  onRideChange: (on: boolean) => void;
  onReport: (reason: string) => void;
}) {
  const Icon = KIND_ICON[item.kind];
  const tickId = useId();
  const rideButton = useRef<HTMLButtonElement>(null);
  const [rideFocus, setRideFocus] = useState(0);
  // Taking it off the rides removes that button, so focus goes to Add to my rides, never to the page.
  useEffect(() => {
    if (rideFocus) rideButton.current?.focus();
  }, [rideFocus]);
  const counts = goal
    ? goal.learnPitstop
      ? `Counts toward Pitstop ${goal.learnPitstop}, learning ${goal.name}. It moves your train along. To fill the gap, prove it at Pitstop ${goal.provePitstop}.`
      : `Practice for Pitstop ${goal.provePitstop}. Only the proof fills the ${goal.name} gap.`
    : "Not on your goals. Learning it never changes your goals, your gaps or your job matches.";
  const already = onRide || added || rideCourse;
  return (
    <section aria-label={item.title} className="flex animate-[sheet-in_.3s_cubic-bezier(.2,.8,.2,1)] flex-col gap-3.5 min-[760px]:sticky min-[760px]:top-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-ink">
          <Icon size={17} {...ICON} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[1.2rem] font-semibold leading-[1.2]">{item.title}</h3>
          <small className="mt-[3px] block text-[0.8rem] text-muted">
            {item.provider} · {LIBRARY_KIND_LABELS[item.kind]} · {lengthLabel(item.minutes)} · {item.language}
          </small>
        </div>
        <SaveButton title={item.title} saved={saved} onSave={onSave} />
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
        <dd>{finished ? "Finished" : onRide ? "On today's ride" : added || rideCourse ? "On your rides" : "Not started here"}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        {goal && !finished && (
          <button
            ref={rideButton}
            type="button"
            aria-disabled={already || undefined}
            onClick={() => {
              if (!already) onRideChange(true);
            }}
            className={`${ghost} aria-disabled:cursor-default aria-disabled:opacity-70`}
          >
            {already ? <TrainFront size={17} {...ICON} /> : <Plus size={17} {...ICON} />}
            {already ? "On your rides" : "Add to my rides"}
          </button>
        )}
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
        {added && !finished && (
          <button
            type="button"
            onClick={() => {
              onRideChange(false);
              setRideFocus((n) => n + 1);
            }}
            className={textButton}
          >
            Take it off my rides
          </button>
        )}
      </div>
      <label htmlFor={tickId} className="flex min-h-11 items-center gap-2.5 text-[0.88rem] font-[550]">
        <input id={tickId} type="checkbox" checked={ticked} onChange={(e) => onFinished(e.target.checked)} className="size-[18px] shrink-0 accent-ink" />
        I finished this
      </label>
      <ReportLink title={item.title} onReport={onReport} />
      <p className="text-[0.78rem] text-muted">We can&apos;t see your progress on other sites, so Finished is your own tick here, on your ride or on your path.</p>
    </section>
  );
}
