"use client";

import { ArrowRight, Bookmark, CircleHelp, Clock, ExternalLink, FileUp, Lock, Play, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { JobPostingForm } from "@/components/gaps/job-posting-form";
import { ICON, plural, seg, Soon } from "@/components/map/map-parts";
import { StatusChip } from "@/components/ui/status-chip";
import { citiesOf, DEPARTURES_LEDE, filterDepartures, initials, NO_FILTERS, readiness, type DepartureFilters, type DepartureTab } from "@/lib/departures/filter";
import type { JobPost, RolePrepView } from "@/lib/schemas";
import { APPLY_STAGES, WORK_TYPES } from "@/lib/schemas/constants";
import { departureTone, departureWhen } from "@/lib/today/board";

const WHEN_TONE = { now: "bg-good-soft text-good", soon: "bg-warn-soft text-warn", later: "bg-surface-2 text-muted" } as const;
const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-line px-[11px] py-1 text-[0.78rem] font-[550] text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink";
const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-[15px] py-[9px] text-[0.86rem] font-[550]";
const primary = `${btn} bg-accent text-on-accent hover:opacity-90`;

/** Saves and stage changes, kept on the server (src/app/(app)/departures/actions.ts). Each returns null or the words to show. */
export type DepartureActions = {
  save: (postId: string, saved: boolean) => Promise<string | null>;
  stage: (postId: string, stage: number) => Promise<string | null>;
};

const FAILED = "That didn't work. Please try again.";
const EMPTY_SAVED = "Nothing saved yet. Tap the bookmark on anything you want to come back to.";
const CLOSED = "Closed on the company's board";

/**
 * Departures (handoff section 8): roles with readiness in words, search and filters, the person's Saved and Applied
 * lists, and a detail panel for the role they pick. Signed in, the roles come from the daily feed of public company job
 * boards (docs/plans/departures-live-plan.md) and `actions` keeps Saved and Applied on the server; without `actions`
 * (the signed-out example and /design) they change on the screen only. `updated` is the header's "Updated 19:42".
 * `hasResume` false hides fit until there is a resume; `noFit` hides it with its own reason. A post that names too
 * few skills we know (`fitNote`) shows no fit on its own; a closed post stays in Saved and Applied with no Apply.
 * `resumeId` is the person's latest resume, which "Saw a role somewhere else?" checks a pasted post against; null
 * links to the upload instead. `prep` is each role's interview prep, locked on the server; a role with none says it
 * is coming. `demo` skips the network call of the paste box (for /design).
 */
export function DeparturesView({
  jobs,
  hasResume = true,
  initialSaved = [],
  initialApplied = [],
  noFit = null,
  resumeId = null,
  prep = {},
  demo = false,
  searchSwitch = null,
  updated = null,
  actions,
}: {
  jobs: JobPost[];
  hasResume?: boolean;
  noFit?: string | null;
  initialSaved?: string[];
  initialApplied?: [string, number][];
  resumeId?: string | null;
  prep?: Record<string, RolePrepView | null>;
  demo?: boolean;
  /** "Looking for a job" (src/components/job-search), in the header. */
  searchSwitch?: ReactNode;
  updated?: string | null;
  actions?: DepartureActions;
}) {
  const [filters, setFilters] = useState<DepartureFilters>(NO_FILTERS);
  const [saved, setSaved] = useState(() => new Set(initialSaved));
  const [applied, setApplied] = useState(() => new Map(initialApplied));
  const [selected, setSelected] = useState<string | null>(() => jobs[0]?.id ?? null);
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
  const detailId = useId();
  const shown = useMemo(() => filterDepartures(jobs, filters, saved, applied), [jobs, filters, saved, applied]);
  const cities = useMemo(() => citiesOf(jobs), [jobs]);
  // The panel follows the list: a role the filters hide is not shown or changed.
  const job = shown.find((j) => j.id === selected) ?? shown[0] ?? null;
  const fit = hasResume && noFit === null;
  const openCount = useMemo(() => jobs.filter((j) => !j.closed).length, [jobs]);
  const set = (patch: Partial<DepartureFilters>) => setFilters((f) => ({ ...f, ...patch }));

  /** Runs a change on the server; if it fails, the screen goes back and says why. Without actions it only says `done`. */
  const keep = (call: Promise<string | null> | undefined, undo: () => void, done: string) => {
    if (!call) return say(done);
    call.then(
      (error) => {
        if (!error) return say(done);
        undo();
        say(error);
      },
      () => {
        undo();
        say(FAILED);
      },
    );
  };
  const toggleSave = (job: JobPost) => {
    const was = saved.has(job.id);
    // A closed role can't be newly saved; one already saved can still come off the list.
    if (!was && job.closed) return say("This role has closed on the company's board, so it can't be saved now.");
    const flip = (on: boolean) =>
      setSaved((s) => {
        const next = new Set(s);
        if (on) next.add(job.id);
        else next.delete(job.id);
        return next;
      });
    flip(!was);
    keep(actions?.save(job.id, !was), () => flip(was), was ? "Removed from saved." : "Saved.");
  };
  const put = (id: string, stage: number) =>
    setApplied((m) => {
      const next = new Map(m);
      if (stage === 0) next.delete(id);
      else next.set(id, stage);
      return next;
    });
  const setStage = (job: JobPost, stage: number) => {
    const before = applied.get(job.id) ?? 0;
    put(job.id, stage);
    keep(actions?.stage(job.id, stage), () => put(job.id, before), stage === 0 ? "No longer marked as applied." : stage === 1 ? `Marked as applied to ${job.company}.` : `Moved to ${APPLY_STAGES[stage - 1]}.`);
  };

  return (
    <div className="grid min-w-0 min-[760px]:min-h-[700px] min-[760px]:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4 pb-8 min-[760px]:pr-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[2rem] font-semibold leading-[1.1]">Departures</h2>
            <p className="mt-1.5 max-w-[60ch] text-[0.92rem] text-muted">{DEPARTURES_LEDE}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {searchSwitch}
            <span data-departures-clock className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
              {updated ? `${updated} · ` : ""}
              {plural(openCount, "role")}
            </span>
          </div>
        </div>

        <label className="flex items-center gap-2.5 rounded-full border border-line-strong bg-surface px-3.5 py-[11px] text-[0.9rem] text-muted focus-within:outline-2 focus-within:outline-accent">
          <Search size={18} {...ICON} />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search role, skill or company"
            aria-label="Search roles"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none"
          />
        </label>

        <div role="group" aria-label="Filters" className="flex flex-wrap items-center justify-between gap-3.5">
          <Pills label="City" value={filters.city} options={cities} any="Any city" onPick={(city) => set({ city })} />
          <Pills label="Work type" value={filters.workType} options={WORK_TYPES} any="Any type" onPick={(workType) => set({ workType })} />
          <label className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap text-[0.84rem] font-[550]">
            <input type="checkbox" checked={filters.boardingOnly} onChange={(e) => set({ boardingOnly: e.target.checked })} className="peer sr-only" />
            <i className="relative h-5 w-9 rounded-full bg-line-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:transition-[left] peer-checked:bg-ink peer-checked:after:left-[18px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
            Boarding now only
          </label>
        </div>

        <div role="group" aria-label="Show" className="inline-flex gap-0.5 self-start rounded-full bg-surface-2 p-[3px]">
          {(
            [
              ["all", "All", null],
              ["saved", "Saved", saved.size],
              ["applied", "Applied", applied.size],
            ] as [DepartureTab, string, number | null][]
          ).map(([tab, name, n]) => (
            <button key={tab} type="button" aria-pressed={filters.tab === tab} className={seg} onClick={() => set({ tab })}>
              {name}
              {n !== null && <span className="ml-1 font-mono text-[0.72rem] text-muted">{n}</span>}
            </button>
          ))}
        </div>

        {shown.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {shown.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                fit={fit && j.fitNote === null}
                selected={j.id === job?.id}
                detailId={detailId}
                saved={saved.has(j.id)}
                applied={applied.has(j.id)}
                onOpen={() => {
                  setSelected(j.id);
                  if (window.matchMedia("(max-width: 759px)").matches) document.getElementById(detailId)?.scrollIntoView({ block: "start" });
                }}
                onSave={() => toggleSave(j)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line p-5 text-center text-[0.9rem] text-muted">
            {filters.tab === "all"
              ? jobs.some((j) => !j.closed)
                ? "No roles match. Try another city or type, or clear the search."
                : "No roles from company job boards yet. They arrive with the next daily update."
              : filters.tab === "saved" && saved.size === 0
                ? EMPTY_SAVED
                : `Nothing ${filters.tab} matches yet.`}
          </p>
        )}

        <PasteBox resumeId={resumeId} demo={demo} />
        <p
          role="status"
          className={`pointer-events-none fixed bottom-24 left-1/2 z-40 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-2xl bg-ink px-4 py-2.5 text-[0.84rem] font-[550] text-bg transition-opacity min-[700px]:rounded-full min-[760px]:bottom-6 ${toast ? "opacity-100" : "opacity-0"}`}
        >
          {toast}
        </p>
      </div>

      <aside
        id={detailId}
        aria-label="Role details"
        className="flex min-w-0 flex-col gap-4 border-t border-line pt-5 min-[760px]:border-l min-[760px]:border-t-0 min-[760px]:pl-[22px] min-[760px]:pt-1"
      >
        {job && (
          <JobDetail
            key={job.id}
            job={job}
            fit={fit && job.fitNote === null}
            noFit={hasResume ? (noFit ?? job.fitNote) : (noFit ?? NO_RESUME)}
            addResume={!hasResume}
            stage={applied.get(job.id) ?? 0}
            prep={prep[job.id] ?? null}
            onStage={(s) => setStage(job, s)}
          />
        )}
      </aside>
    </div>
  );
}

const NO_RESUME = "Add your resume and this shows what you have and what is missing for this role.";

function Pills<T extends string>({ label, value, options, any, onPick }: { label: string; value: T | null; options: readonly T[]; any: string; onPick: (v: T | null) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1">
      <button type="button" aria-pressed={value === null} className={pill} onClick={() => onPick(null)}>
        {any}
      </button>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} className={pill} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

const Logo = ({ name, small = false }: { name: string; small?: boolean }) => (
  <span
    aria-hidden="true"
    className={`grid shrink-0 place-items-center bg-surface-2 font-display font-semibold text-ink ${small ? "h-9 w-9 rounded-[10px] text-[0.85rem] min-[760px]:h-11 min-[760px]:w-11 min-[760px]:rounded-[12px] min-[760px]:text-base" : "h-11 w-11 rounded-[12px] text-base"}`}
  >
    {initials(name)}
  </span>
);

function JobRow({
  job,
  fit,
  selected,
  detailId,
  saved,
  applied,
  onOpen,
  onSave,
}: {
  job: JobPost;
  fit: boolean;
  selected: boolean;
  detailId: string;
  saved: boolean;
  applied: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const tone = departureTone(job.goalsBefore);
  return (
    <li
      className={`relative grid grid-cols-[36px_minmax(0,1fr)] items-start gap-2.5 rounded-[18px] border bg-surface p-3.5 transition-colors min-[760px]:grid-cols-[44px_minmax(0,1fr)_auto] min-[760px]:gap-3.5 min-[760px]:p-4 ${selected ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line hover:border-muted"}`}
    >
      <Logo name={job.company} small />
      <div className="flex min-w-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          aria-current={selected || undefined}
          aria-controls={detailId}
          className="text-left text-[0.98rem] font-semibold outline-none after:absolute after:inset-0 after:rounded-[18px] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
        >
          {job.role}
          <span className="sr-only"> at {job.company}</span>
        </button>
        <p className="flex flex-wrap gap-1.5 text-[0.8rem] text-muted">
          {[job.company, job.city, job.workType, job.experience, job.posted ? `posted ${job.posted}` : null].filter(Boolean).map((m, i) => (
            <span key={i} className="contents">
              {i > 0 && <span aria-hidden="true">·</span>}
              <span>{m}</span>
            </span>
          ))}
        </p>
        {job.closed && <p className="text-[0.8rem] font-[550] text-muted">{CLOSED}</p>}
        <div className="flex flex-wrap gap-1.5">
          {fit && (job.gaps.length ? job.gaps.map((g) => <StatusChip key={g.name} status={g.status} label={g.name} />) : <StatusChip status="met" label="No required gaps" />)}
        </div>
      </div>
      <div className="col-start-2 flex items-center justify-between gap-2.5 min-[760px]:col-start-3 min-[760px]:flex-col min-[760px]:items-end">
        {applied ? (
          <When className="bg-accent-soft text-accent">Applied</When>
        ) : job.closed ? (
          <When className="bg-surface-2 text-muted">Closed</When>
        ) : fit ? (
          <When className={WHEN_TONE[tone]}>{departureWhen(job.goalsBefore)}</When>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onSave}
          aria-pressed={saved}
          aria-disabled={(job.closed && !saved) || undefined}
          aria-label={`Save ${job.role}`}
          className="relative z-10 grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-line text-muted aria-disabled:opacity-60 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
        >
          <Bookmark size={16} {...ICON} className={saved ? "fill-current" : undefined} />
        </button>
      </div>
    </li>
  );
}

const When = ({ className, children }: { className: string; children: ReactNode }) => (
  <span className={`whitespace-nowrap rounded-[6px] px-2 py-1 font-mono text-[0.7rem] uppercase tracking-[0.06em] ${className}`}>{children}</span>
);

const H4 = ({ children }: { children: ReactNode }) => <h4 className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.05em] text-muted">{children}</h4>;

const Note = ({ Icon, children }: { Icon: typeof Clock; children: ReactNode }) => (
  <p className="flex items-start gap-1.5 text-[0.76rem] text-muted">
    <Icon size={14} {...ICON} className="mt-0.5 shrink-0" />
    <span>{children}</span>
  </p>
);

function JobDetail({
  job,
  fit,
  noFit,
  stage,
  prep,
  onStage,
  addResume,
}: {
  job: JobPost;
  fit: boolean;
  addResume: boolean;
  noFit: string | null;
  stage: number;
  prep: RolePrepView | null;
  onStage: (stage: number) => void;
}) {
  const site = "Apply on company site";
  // Marking applied swaps the apply control for the tracker, and "I didn't apply" swaps it back: focus follows the
  // swap instead of dropping to the page (WCAG 2.4.3).
  const firstStage = useRef<HTMLButtonElement>(null);
  const applyControl = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (!moved) return;
    (stage > 0 ? firstStage.current : applyControl.current)?.focus();
    // Runs once per swap; stage is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moved]);
  const swap = (next: number) => {
    onStage(next);
    setMoved((n) => n + 1);
  };
  // "Did you apply?" after the company's post opens in a new tab: yes marks Applied, no puts focus back on Apply.
  const [asking, setAsking] = useState(false);
  const askId = useId();
  const answer = (yes: boolean) => {
    setAsking(false);
    if (yes) swap(1);
    else setMoved((n) => n + 1);
  };
  return (
    <div className="flex animate-[sheet-in_.3s_cubic-bezier(.2,.8,.2,1)] flex-col gap-4 min-[760px]:sticky min-[760px]:top-4">
      <div className="flex items-center gap-3">
        <Logo name={job.company} />
        <div>
          <h3 className="text-[1.3rem] font-semibold leading-[1.15]">{job.role}</h3>
          <small className="mt-0.5 block text-[0.8rem] text-muted">
            {job.company} · {job.city} · {job.workType}
            {job.hours ? ` (${job.hours})` : ""}
            {job.experience ? ` · ${job.experience}` : ""}
          </small>
        </div>
      </div>

      {fit ? (
        <>
          <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg p-3.5">
            <b className="font-display text-[1.15rem] font-semibold tracking-[-0.01em]">{readiness(job)}</b>
            <span className="text-[0.84rem] text-muted">{job.why}</span>
          </div>
          <section className="flex flex-col gap-2">
            <H4>You have · {job.have.length}</H4>
            <div className="flex flex-wrap gap-1.5">
              {job.have.map((h) => (
                <StatusChip key={h} status="met" label={h} />
              ))}
            </div>
          </section>
          {job.gaps.length > 0 && (
            <section className="flex flex-col gap-2">
              <H4>Between you and this role · {job.gaps.length}</H4>
              <div className="flex flex-wrap gap-1.5">
                {job.gaps.map((g) => (
                  <StatusChip key={g.name} status={g.status} label={`${g.name} goal`} />
                ))}
              </div>
              <Link href="/map" className="inline-flex items-center gap-1 self-start text-[0.82rem] font-[550] text-muted hover:text-ink">
                See these goals on your map
                <ArrowRight size={15} {...ICON} />
              </Link>
            </section>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg p-3.5">
          <b className="font-display text-[1.15rem] font-semibold">Fit unknown yet</b>
          <span className="text-[0.84rem] text-muted">{noFit}</span>
          {addResume && (
            <Link href="/today" className={`${primary} mt-1 self-start px-[11px] py-1.5 text-[0.8rem]`}>
              Add resume
            </Link>
          )}
        </div>
      )}

      {stage > 0 ? (
        <section className="flex flex-col gap-2">
          <H4>Your application</H4>
          <ol className="flex flex-col">
            {APPLY_STAGES.map((name, i) => (
              <li key={name}>
                <button
                  ref={i === 0 ? firstStage : undefined}
                  type="button"
                  aria-pressed={i < stage}
                  onClick={() => onStage(i + 1)}
                  className="flex w-full items-center gap-2.5 rounded-sm py-2 text-left text-[0.86rem] text-muted aria-pressed:font-[550] aria-pressed:text-ink"
                >
                  <span className={`h-[18px] w-[18px] shrink-0 rounded-full border-2 ${i < stage ? "border-accent bg-accent" : "border-line-strong bg-surface"}`} />
                  {name}
                  {i === 0 && " · on the company site"}
                </button>
              </li>
            ))}
          </ol>
          <p className="text-[0.86rem] text-muted">
            Tap a step when it happens. Only you see this.{" "}
            {stage === 1 && (
              <button type="button" onClick={() => swap(0)} className="font-[550] text-ink underline underline-offset-2">
                I didn&apos;t apply
              </button>
            )}
          </p>
          <Soon>Ask people who work in this role</Soon>
        </section>
      ) : job.closed ? (
        <p data-departure-closed className="rounded-lg border border-line bg-surface-2 p-3.5 text-[0.86rem] text-muted">
          {CLOSED}. It stays here in your lists.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {job.applyUrl ? (
              <a
                href={job.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Apply on company site: ${job.company} (opens in a new tab)`}
                ref={applyControl}
                onClick={() => setAsking(true)}
                className={primary}
              >
                <ExternalLink size={17} {...ICON} />
                {site}
              </a>
            ) : (
              // Example roles have no posting to open, so the button only shows how tracking works.
              <button ref={applyControl} type="button" onClick={() => swap(1)} className={primary}>
                <ExternalLink size={17} {...ICON} />
                {site} · example
              </button>
            )}
          </div>
          {asking && (
            <div role="group" aria-labelledby={askId} data-did-you-apply className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5">
              <b id={askId} className="text-[0.92rem] font-semibold">
                Did you apply?
              </b>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => answer(true)} className={`${primary} px-[11px] py-1.5 text-[0.8rem]`}>
                  Yes, I applied
                </button>
                <button type="button" onClick={() => answer(false)} className={`${btn} border border-line-strong px-[11px] py-1.5 text-[0.8rem] text-ink hover:bg-surface-2`}>
                  I didn&apos;t apply
                </button>
              </div>
            </div>
          )}
          <Note Icon={ShieldCheck}>
            {!job.applyUrl
              ? "An example role: this marks it as applied so you can see the tracking. Real roles open the company's own posting."
              : "Opens the company's own posting in a new tab. Tell us here if you applied, and track it. Only you see this."}
          </Note>
          {fit && job.gaps.length > 0 && <Soon>Ask someone who got this role</Soon>}
        </>
      )}

      {prep ? <RolePrep prep={prep} /> : <Soon>Interview prep for this role</Soon>}
      <Note Icon={Clock}>
        Posted {job.posted}
        {job.applyUrl ? " on the company's public job board." : "."}
      </Note>
    </div>
  );
}

const ELITE_LOCK_NOTE = "One question free. The full bank, what a strong answer covers, and mock rounds come with Elite.";

/**
 * "Interview prep for this role" (handoff 12l, prototype v44): five of the role's bank questions. On Free only the
 * first is open; the other four are ones the bank opens only on Elite, and the server sends no text for them, so they
 * show as blurred lines. Elite violet marks Elite
 * only.
 */
function RolePrep({ prep }: { prep: RolePrepView }) {
  const headingId = useId();
  const locked = prep.questions.some((q) => !q.open);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5 rounded-[16px] border border-line p-3.5">
      <div className="flex items-center gap-2">
        <CircleHelp size={16} {...ICON} className="shrink-0 text-muted" />
        <h4 id={headingId} className="text-[0.92rem] font-semibold">
          Interview prep for this role
        </h4>
        <span className="rounded-full bg-elite-soft px-[7px] py-0.5 font-mono text-[0.64rem] font-medium uppercase tracking-[0.06em] text-elite">Elite</span>
      </div>
      <ol className="flex list-decimal flex-col gap-2 pl-[18px] text-[0.84rem]">
        {prep.questions.map((q) =>
          q.open ? (
            <li key={q.id} data-prep-question="open">
              {q.question}
            </li>
          ) : (
            <li key={q.id} data-prep-question="locked" aria-hidden="true" className="text-muted">
              <span className="block h-3.5 w-full rounded-sm bg-surface-2 blur-[2px]" />
            </li>
          ),
        )}
      </ol>
      <Link
        href={`/mock?role=${encodeURIComponent(prep.roleSlug)}`}
        className={`${btn} self-start border border-line-strong px-[11px] py-1.5 text-[0.8rem] text-ink hover:bg-surface-2`}
      >
        <Play size={16} {...ICON} />
        Practice a mock round
      </Link>
      {locked && <Note Icon={Lock}>{ELITE_LOCK_NOTE}</Note>}
    </section>
  );
}

/**
 * "Saw a role somewhere else?": the pasted-job check (role-suggest-plan.md part B) against the person's latest
 * resume, through the same form and /api/job-checks as "My role isn't listed". Once checked, the job's Gaps page
 * opens. Only the skills the post asks for are kept, never the post. With no resume, it links to the upload. `demo`
 * (the signed-out example and /design) checks the fields and saves nothing.
 */
function PasteBox({ resumeId, demo }: { resumeId: string | null; demo: boolean }) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  return (
    <section aria-label="Paste a job post" className="mt-1.5 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-[1.05rem] font-semibold">Saw a role somewhere else?</h3>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">paste the job post</span>
      </div>
      {resumeId ? (
        <>
          <p className="text-[0.84rem] text-muted">
            Paste the full job description. We compare it with your resume and show the gaps for this one role. We keep the skills it asks for, never the
            post itself, and nothing is shared.
          </p>
          <JobPostingForm
            resumeId={resumeId}
            roleSlug={null}
            submitLabel="Check my gaps"
            busy={opening}
            demo={demo}
            doneMessage={() => (demo ? "This is an example, so nothing was checked or saved. Signed in, your gaps for this job open here." : "Checked. Opening your gaps for this job…")}
            onSaved={({ id }) => startOpening(() => router.push(`/resume/${resumeId}/job/${id}`))}
          />
        </>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface p-[18px]">
          <p className="text-[0.88rem] text-muted">Upload your resume first. Then paste a job post here to see the gaps for that one role.</p>
          <Link href="/start" className={`${primary} self-start px-[11px] py-1.5 text-[0.8rem]`}>
            <FileUp size={17} {...ICON} />
            Upload your resume
          </Link>
        </div>
      )}
    </section>
  );
}
