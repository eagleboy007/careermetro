"use client";

import { Briefcase, Route, Search, TrainFront } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { jobSearchStatus, jobSearchToast } from "@/lib/job-search/rules";

/*
 * "Looking for a job" (handoff 6, docs/plans/job-search-plan.md, prototype v44 `srch-in`): one switch, shown on the
 * Departures and Arrivals headers and Me's "Who sees what" rail. Off pauses Departures and Arrivals and hides the Today
 * board; rides, the streak and the map keep going. The provider holds the switch for its page, so every copy of it, the
 * off cards and the status line move together, and the toast stays where it is while the page changes under it.
 */

const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;
const FAILED = "That didn't work. Please try again.";
export const ghostSm =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[0.8rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60";

export type JobSearchAction = (on: boolean) => Promise<string | null>;

type JobSearchState = {
  on: boolean;
  toggle: (next: boolean) => void;
  /**
   * True once, right after the switch moved: the control now on screen in its place takes focus, since the one pressed
   * may have gone with the part of the page that changed. Focus never drops to the page.
   */
  claimFocus: () => boolean;
};

const JobSearchContext = createContext<JobSearchState | null>(null);

/** The switch for this page, or null where no provider is (the page has no job search). */
export const useJobSearch = () => useContext(JobSearchContext);

/**
 * Holds "Looking for a job" for one page. The switch moves at once and goes back if the save fails. Without an action
 * (example data) it moves here only and nothing is saved.
 */
export function JobSearchProvider({ initialOn, action, children }: { initialOn: boolean; action?: JobSearchAction; children: ReactNode }) {
  const [on, setOn] = useState(initialOn);
  // A new value from the server (after the save's refresh, or a change in another tab) resets the switch.
  const [base, setBase] = useState(initialOn);
  if (base !== initialOn) {
    setBase(initialOn);
    setOn(initialOn);
  }
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusNext = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Children's effects run first, so a newly shown switch has taken focus by now; after that nothing else may.
  useEffect(() => {
    focusNext.current = false;
  }, [on]);
  const claimFocus = () => {
    if (!focusNext.current) return false;
    focusNext.current = false;
    return true;
  };

  const say = (text: string) => {
    // Cleared first, so the same words twice are read out twice.
    setToast(null);
    requestAnimationFrame(() => setToast(text));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  };
  const toggle = (next: boolean) => {
    if (pending || next === on) return;
    focusNext.current = true;
    setOn(next);
    if (!action) return say(jobSearchToast(next));
    start(async () => {
      const error = await action(next).catch(() => FAILED);
      if (error) {
        focusNext.current = true;
        setOn(!next);
        say(error);
      } else say(jobSearchToast(next));
    });
  };

  return (
    <JobSearchContext.Provider value={{ on, toggle, claimFocus }}>
      {children}
      <p
        role="status"
        className={`pointer-events-none fixed bottom-24 left-1/2 z-40 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-2xl bg-ink px-4 py-2.5 text-[0.84rem] font-[550] text-bg transition-opacity min-[700px]:rounded-full min-[760px]:bottom-6 ${toast ? "opacity-100" : "opacity-0"}`}
      >
        {toast}
      </p>
    </JobSearchContext.Provider>
  );
}

/** "Looking for a job". Outside a provider it shows on and does nothing. */
export function JobSearchSwitch({ hint }: { hint?: ReactNode }) {
  const search = useJobSearch();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // The switch the person pressed may have gone with the page that changed; this one, now on screen, takes focus.
    if (search?.claimFocus()) box.current?.querySelector("input")?.focus();
  }, [search]);
  return (
    <span ref={box} className="contents" data-job-search>
      <Switch checked={search?.on ?? true} onChange={(next) => search?.toggle(next)} disabled={!search} hint={hint}>
        Looking for a job
      </Switch>
    </span>
  );
}

/** Shows the page while job search is on, and `paused` in its place while it is off. */
export function JobSearchGate({ paused, children }: { paused: ReactNode; children: ReactNode }) {
  const search = useJobSearch();
  return <>{search && !search.on ? paused : children}</>;
}

function TurnOn({ children }: { children: ReactNode }) {
  const search = useJobSearch();
  return (
    <button type="button" className={ghostSm} onClick={() => search?.toggle(true)}>
      {children}
    </button>
  );
}

/** Departures and Arrivals while job search is off (prototype `srch-off`). */
export function JobSearchOffCard() {
  return (
    <section aria-label="Job search is off" className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line p-5 text-[0.9rem] text-muted min-[600px]:flex-row min-[600px]:items-center">
      <Route {...ICON} className="shrink-0 text-muted" />
      <p className="min-w-0 flex-1">
        <b className="font-semibold text-ink">Job search is off.</b> Departures and Arrivals are paused: no Express apply, and companies can&apos;t
        find you. Your daily rides and your map keep going.
      </p>
      <TurnOn>Turn on job search</TurnOn>
    </section>
  );
}

/** A paused Departures or Arrivals: the page's own header with the switch, then the off card. Nothing else shows. */
export function JobSearchPaused({ eyebrow, title, lede, level = 2 }: { eyebrow?: string; title: string; lede: string; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">{eyebrow}</span>}
          <Heading className={`${eyebrow ? "mt-1 " : ""}text-[2rem] font-semibold leading-[1.1]`}>{title}</Heading>
          <p className="mt-1.5 max-w-[60ch] text-[0.92rem] text-muted">{lede}</p>
        </div>
        <JobSearchSwitch />
      </div>
      <JobSearchOffCard />
    </div>
  );
}

/**
 * Today's Departures board, or the off card in its place while job search is off. Turn on removes its own button, so
 * the board that comes back takes focus.
 */
export function JobSearchBoardSlot({ children }: { children: ReactNode }) {
  const search = useJobSearch();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (search?.claimFocus()) box.current?.focus();
  }, [search]);
  return (
    <div ref={box} tabIndex={-1} className="min-w-0 outline-none">
      {search && !search.on ? <JobSearchOffToday /> : children}
    </div>
  );
}

/** Today, in place of the Departures board while job search is off (prototype `srch-off-today`). */
export function JobSearchOffToday() {
  return (
    <section
      aria-label="Job search is off"
      className="flex min-w-0 flex-wrap items-center gap-3 rounded-[18px] border border-line bg-surface p-4 text-[0.88rem] text-muted md:rounded-[20px] md:px-[22px] md:py-5"
    >
      <TrainFront {...ICON} className="shrink-0 text-muted" />
      <p className="min-w-[180px] flex-1">
        <b className="font-semibold text-ink">Job search is off.</b> Your ride keeps going. Departures come back when you switch it on.
      </p>
      <TurnOn>Turn on</TurnOn>
    </section>
  );
}

/**
 * The status line on the person's own profile (prototype `me-status`): "Looking for a next role" while on; "Working at
 * {company}" from the latest current role on the resume while off, or nothing without one. Never shown to others.
 */
export function JobSearchStatus({ employer }: { employer: string | null }) {
  const search = useJobSearch();
  const on = search?.on ?? true;
  const text = jobSearchStatus(on, employer);
  if (!text) return null;
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-surface-2 px-[11px] py-[3px] text-[0.84rem] font-medium text-ink">
      {on ? <Search size={15} strokeWidth={1.75} aria-hidden="true" /> : <Briefcase size={15} strokeWidth={1.75} aria-hidden="true" />}
      {text}
    </span>
  );
}

/**
 * Me's "Who sees what" switches (prototype v44): Looking for a job, and "Show my pitstop on the map", which waits for
 * rider counts and stays off. The rest of who sees what is chosen in Account settings.
 */
export function MeSearchSwitches() {
  return (
    <div className="flex flex-col">
      <JobSearchSwitch />
      <Switch checked={false} onChange={() => {}} disabled>
        Show my pitstop on the map · soon
      </Switch>
      <small className="text-[0.76rem] text-muted">Job search off pauses Departures and Arrivals; your journey keeps going.</small>
    </div>
  );
}
