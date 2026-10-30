"use client";

import { ArrowRight, Bookmark, Briefcase, CircleHelp, Clock, ExternalLink, Lock, Play, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AddJobBox, EditSheet, MyJobsList, type AddedJob, type EditValues, type MyJobActions, type SharedArrival } from "@/components/departures/my-jobs";
import { ICON, plural, seg, Soon } from "@/components/map/map-parts";
import { StatusChip } from "@/components/ui/status-chip";
import {
  citiesOf,
  DEPARTURES_LEDE,
  DEPARTURES_SOURCE,
  departuresEmpty,
  filterDepartures,
  initials,
  NO_FILTERS,
  readiness,
  startFilters,
  type DepartureFilters,
} from "@/lib/departures/filter";
import { isClosed, isMoving, stageOf, statusOf, withInterview, type MyJobStatus } from "@/lib/my-jobs/rules";
import { newestChange, postFit } from "@/lib/my-jobs/view";
import type { JobPost, MyJobRef, MyJobView, RolePrepView } from "@/lib/schemas";
import { APPLY_STAGES, MY_JOB_STATUS_LABELS, WORK_TYPES } from "@/lib/schemas/constants";
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
/** The empty list's next step: quieter than Apply, with the control edge of a button. */
const quiet = `${btn} border border-line-strong text-ink hover:bg-surface-2`;
const CLOSED = "Closed on the company's board";

/**
 * Departures (handoff section 8): roles with readiness in words, search and filters, the person's Saved and Applied
 * lists, and a detail panel for the role they pick. Signed in, the roles come from the daily feed of public company job
 * boards (docs/plans/departures-live-plan.md) and `actions` keeps Saved and Applied on the server; without `actions`
 * (the signed-out example and /design) they change on the screen only. `updated` is the header's "Updated 19:42".
 * `hasResume` false hides fit until there is a resume; `noFit` hides it with its own reason. A post that names too
 * few skills we know (`fitNote`) shows no fit on its own; a closed post stays in Saved and Applied with no Apply.
 * `resumeId` is the person's latest resume, which "Add a job you found" checks a job against; null links to the upload
 * instead. `prep` is each role's interview prep, locked on the server; a role with none says it is coming. `demo`
 * skips the network call of the add box (for /design). My jobs (handoff 12m) is the person's own list of feed jobs and
 * jobs they added from any site (`initialMine`), kept on the server by `mineActions`; Saving or applying on All adds a
 * feed job to it, and its status menu moves the feed job's Saved and Applied too.
 */
export function DeparturesView({
  jobs,
  hasResume = true,
  initialSaved = [],
  initialApplied = [],
  noFit = null,
  resumeId = null,
  finishHref = null,
  prep = {},
  demo = false,
  searchSwitch = null,
  updated = null,
  places = [],
  initialCity = null,
  actions,
  initialMine = [],
  mineActions,
  initialTab = "all",
  shared = null,
}: {
  jobs: JobPost[];
  hasResume?: boolean;
  noFit?: string | null;
  initialSaved?: string[];
  initialApplied?: [string, number][];
  resumeId?: string | null;
  /** With no gaps yet: the person's resume to finish first (T134). */
  finishHref?: string | null;
  prep?: Record<string, RolePrepView | null>;
  demo?: boolean;
  /** "Looking for a job" (src/components/job-search), in the header. */
  searchSwitch?: ReactNode;
  updated?: string | null;
  /** "Open to work in" from Settings (FR-55), read on the server: with any, the City filter opens on "Your places". */
  places?: string[];
  /** The page's `?city=`: the City filter the board was read for, picked when Departures opens. */
  initialCity?: string | null;
  actions?: DepartureActions;
  initialMine?: MyJobView[];
  mineActions?: MyJobActions;
  /** "mine" opens on My jobs (`?tab=mine`). */
  initialTab?: "all" | "mine";
  /** A job shared from the phone (C21, `?shared=`), read once on the server: "Add a job you found" opens filled. */
  shared?: SharedArrival | null;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<DepartureFilters>(() => (initialCity ? { ...startFilters([]), city: initialCity } : startFilters(places)));
  const [saved, setSaved] = useState(() => new Set(initialSaved));
  const [applied, setApplied] = useState(() => new Map(initialApplied));
  const [selected, setSelected] = useState<string | null>(() => jobs[0]?.id ?? null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "mine">(initialTab);
  const [mine, setMine] = useState<MyJobView[]>(() => [...initialMine].sort(newestChange));
  const [editing, setEditing] = useState<string | null>(null);
  // Picking Interview with no date opens the sheet on the interview field (handoff 12m).
  const [editFocus, setEditFocus] = useState<"interview" | undefined>(undefined);
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
  // The add box's id, for the empty lists' links to it: one per instance, as /design shows several.
  const pasteId = useId();
  const toAdd = () => {
    const box = document.getElementById(pasteId);
    box?.scrollIntoView({ block: "start" });
    box?.querySelector("textarea")?.focus();
  };
  // A share opens at the add box. `?shared=` leaves the address, so a reload doesn't say the share has gone. Not on
  // /design's examples.
  useEffect(() => {
    if (!shared || demo) return;
    document.getElementById(pasteId)?.scrollIntoView({ block: "start" });
    const url = new URL(window.location.href);
    url.searchParams.delete("shared");
    url.searchParams.delete("check");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }, [shared, pasteId, demo]);
  const shown = useMemo(() => filterDepartures(jobs, filters, saved, applied, places), [jobs, filters, saved, applied, places]);
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
    const before = mine;
    flip(!was);
    setMine((list) => mineAfterSave(list, job, !was, fit));
    keep(
      actions?.save(job.id, !was),
      () => {
        flip(was);
        setMine(before);
      },
      was ? "Removed from saved." : "Saved.",
    );
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
    const list = mine;
    put(job.id, stage);
    setMine((l) => mineAfterStage(l, job, stage, saved.has(job.id), fit));
    keep(
      actions?.stage(job.id, stage),
      () => {
        put(job.id, before);
        setMine(list);
      },
      stage === 0 ? "No longer marked as applied." : stage === 1 ? `Marked as applied to ${job.company}.` : `Moved to ${APPLY_STAGES[stage - 1]}.`,
    );
  };

  /** A feed job's Saved and Applied on All follow its row in My jobs. */
  const followPost = (ref: MyJobRef, status: MyJobStatus | null) => {
    if (ref.kind !== "post") return;
    const id = ref.postId;
    if (status === null) {
      setSaved((s) => new Set([...s].filter((x) => x !== id)));
      return put(id, 0);
    }
    if (status === "saved") setSaved((s) => new Set(s).add(id));
    put(id, isMoving(status) ? stageOf(status)! : 0);
  };
  /** Runs a My jobs change: the screen shows it at once, and goes back if the server says no. */
  const change = (next: MyJobView[], call: Promise<string | null> | undefined, done: string, follow?: () => void) => {
    const before = { mine, saved, applied };
    setMine(next.sort(newestChange));
    follow?.();
    keep(call, () => {
      setMine(before.mine);
      setSaved(before.saved);
      setApplied(before.applied);
    }, done);
  };
  const setStatus = (job: MyJobView, status: MyJobStatus) => {
    const now = new Date().toISOString();
    const next = mine.map((j) => (j.key === job.key ? withStatus(j, status, now) : j));
    const askDate = status === "interview" && !job.interviewAt;
    const done = askDate
      ? "Interview. Add the date so Today can count down to it."
      : status === "offer"
        ? "An offer. Well done."
        : isClosed(status)
          ? `Marked ${MY_JOB_STATUS_LABELS[status].toLowerCase()}. It stays under Closed.`
          : `${MY_JOB_STATUS_LABELS[status]} · ${shortToday()}`;
    change(next, mineActions?.status({ ref: job.ref, status }), done, () => followPost(job.ref, status));
    if (askDate) {
      setEditFocus("interview");
      setEditing(job.key);
    }
  };
  const saveEdit = async (job: MyJobView, values: EditValues): Promise<string | null> => {
    const message = mineActions ? await mineActions.update({ ref: job.ref, ...values }) : null;
    if (message) return message;
    const now = new Date().toISOString();
    // As the server does: a date moves an earlier status to Interview.
    const status = withInterview(values.status, values.interviewAt);
    const edited = edit(withStatus(job, status, now), values, now);
    setMine((l) => l.map((j) => (j.key === job.key ? edited : j)).sort(newestChange));
    followPost(job.ref, status);
    say("Saved. Only you see it.");
    return null;
  };
  const deleteJob = async (job: MyJobView): Promise<string | null> => {
    const message = mineActions ? await mineActions.remove({ ref: job.ref }) : null;
    if (message) return message;
    setMine((l) => l.filter((j) => j.key !== job.key));
    followPost(job.ref, null);
    say("Deleted. Nothing is kept.");
    return null;
  };
  const added = (job: AddedJob, labels: { company: string; title: string; city: string | null }) => {
    const now = new Date().toISOString();
    const row: MyJobView = {
      key: `check:${job.checkId}`,
      ref: { kind: "check", checkId: job.checkId },
      ...labels,
      source: job.source,
      url: job.url,
      status: "saved",
      savedAt: now,
      appliedAt: null,
      closedAt: null,
      interviewAt: null,
      note: null,
      updatedAt: now,
      postClosed: false,
      hasDescription: !demo,
      fit: job.fit,
    };
    setMine((l) => [row, ...l.filter((j) => j.key !== row.key)]);
    setTab("mine");
    say(`${labels.company} saved to My jobs.`);
  };
  const savedPost = (postId: string) => {
    const job = jobs.find((j) => j.id === postId);
    setSaved((s) => new Set(s).add(postId));
    if (job) setMine((l) => mineAfterSave(l, job, true, fit));
    setTab("mine");
  };
  const editingJob = mine.find((j) => j.key === editing) ?? null;

  return (
    <div className={`grid min-w-0 min-[760px]:min-h-[700px] ${tab === "all" ? "min-[760px]:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
      <div className={`flex min-w-0 flex-col gap-4 pb-8 ${tab === "all" ? "min-[760px]:pr-7" : ""}`}>
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

        {tab === "all" && (
          <>
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
              <Pills
                label="City"
                value={filters.yourPlaces ? null : filters.city}
                options={cities}
                any="Any city"
                onPick={(city) => {
                  set({ city, yourPlaces: false });
                  // The server reads the newest roles in the picked city too, so the list isn't only the newest in India.
                  // Signed out, the example roles are all there is.
                  if (!actions) return;
                  const url = new URL(window.location.href);
                  if (city) url.searchParams.set("city", city);
                  else url.searchParams.delete("city");
                  router.replace(`${url.pathname}${url.search}`, { scroll: false });
                }}
                first={
                  places.length > 0 ? (
                    <button type="button" aria-pressed={filters.yourPlaces} className={pill} onClick={() => set({ yourPlaces: true, city: null })}>
                      Your places
                    </button>
                  ) : null
                }
                anyPressed={!filters.yourPlaces && filters.city === null}
              />
              <Pills label="Work type" value={filters.workType} options={WORK_TYPES} any="Any type" onPick={(workType) => set({ workType })} />
              <label className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap text-[0.84rem] font-[550]">
                <input type="checkbox" checked={filters.boardingOnly} onChange={(e) => set({ boardingOnly: e.target.checked })} className="peer sr-only" />
                <i className="relative h-5 w-9 rounded-full bg-line-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:transition-[left] peer-checked:bg-ink peer-checked:after:left-[18px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
                Boarding now only
              </label>
            </div>
          </>
        )}

        <div role="group" aria-label="Show" className="inline-flex gap-0.5 self-start rounded-full bg-surface-2 p-[3px]">
          <button type="button" aria-pressed={tab === "all"} className={seg} onClick={() => setTab("all")}>
            All
          </button>
          <button type="button" aria-pressed={tab === "mine"} className={seg} onClick={() => setTab("mine")}>
            <Briefcase size={14} {...ICON} className="mr-1 inline-block align-[-2px]" />
            My jobs
            <span className="ml-1 font-mono text-[0.72rem] text-muted">{mine.length}</span>
          </button>
        </div>

        {tab === "mine" ? (
          <MyJobsList jobs={mine} onStatus={setStatus} onEdit={(j) => setEditing(j.key)} onAdd={toAdd} />
        ) : shown.length > 0 ? (
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
          <EmptyList
            empty={departuresEmpty(filters, { open: openCount, places, saved: saved.size, applied: applied.size })}
            pasteId={pasteId}
            onClear={() => set({ ...NO_FILTERS, tab: filters.tab })}
            onEveryCity={() => set({ yourPlaces: false, city: null })}
          />
        )}

        <AddJobBox id={pasteId} resumeId={resumeId} finishHref={finishHref} demo={demo} save={mineActions?.save} onSaved={added} onPost={savedPost} shared={shared} />
        {editingJob && (
          <EditSheet
            key={editingJob.key}
            job={editingJob}
            focus={editFocus}
            onClose={() => {
              setEditing(null);
              setEditFocus(undefined);
            }}
            onSave={(values) => saveEdit(editingJob, values)}
            onDelete={() => deleteJob(editingJob)}
            readDescription={mineActions?.description}
          />
        )}
        <p data-departures-source className="text-[0.8rem] text-muted">
          {DEPARTURES_SOURCE}{" "}
          <Link href="/terms#job-boards" className="underline underline-offset-2">
            Ask us to remove your board
          </Link>
          .
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
        hidden={tab !== "all"}
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

const shortToday = () => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date());

/** A day from a date field as noon in IST, as the server keeps it. */
const istNoon = (day: string) => new Date(`${day}T12:00:00+05:30`).toISOString();

/** A row's dates after a status change, as the server sets them (src/lib/my-jobs/store.ts). */
function withStatus(j: MyJobView, status: MyJobStatus, now: string): MyJobView {
  if (status === j.status) return j;
  return {
    ...j,
    status,
    appliedAt: isMoving(status) ? (j.appliedAt ?? now) : status === "saved" ? null : j.appliedAt,
    closedAt: isClosed(status) ? (isClosed(j.status) && j.closedAt ? j.closedAt : now) : null,
    savedAt: status === "saved" ? (j.savedAt ?? now) : j.savedAt,
    updatedAt: now,
  };
}

/** A row after the edit sheet's Save. */
function edit(j: MyJobView, v: EditValues, now: string): MyJobView {
  return {
    ...j,
    company: v.company ?? j.company,
    title: v.title ?? j.title,
    url: v.url === undefined ? j.url : v.url,
    city: v.city === undefined ? j.city : v.city,
    appliedAt: v.appliedOn ? istNoon(v.appliedOn) : j.appliedAt,
    closedAt: isClosed(v.status) && v.closedOn ? istNoon(v.closedOn) : j.closedAt,
    interviewAt: v.interviewAt ? new Date(`${v.interviewAt}:00+05:30`).toISOString() : null,
    note: v.note,
    updatedAt: now,
  };
}

/** A feed job's new row in My jobs. */
function postRow(job: JobPost, status: MyJobStatus, now: string, fitShown: boolean): MyJobView {
  return {
    key: `post:${job.id}`,
    ref: { kind: "post", postId: job.id },
    company: job.company,
    title: job.role,
    city: job.city,
    source: "board",
    url: job.applyUrl,
    status,
    savedAt: status === "saved" ? now : null,
    appliedAt: isMoving(status) ? now : null,
    closedAt: null,
    interviewAt: null,
    note: null,
    updatedAt: now,
    postClosed: job.closed,
    hasDescription: false,
    fit: postFit(job, fitShown),
  };
}

/** My jobs after the bookmark on All: a new save adds the job; taking it off removes a job that was only saved. */
function mineAfterSave(list: MyJobView[], job: JobPost, on: boolean, fitShown: boolean): MyJobView[] {
  const now = new Date().toISOString();
  const key = `post:${job.id}`;
  const row = list.find((j) => j.key === key);
  if (on) return row ? list.map((j) => (j.key === key ? { ...j, savedAt: now, updatedAt: now } : j)) : [postRow(job, "saved", now, fitShown), ...list];
  if (!row) return list;
  return row.status === "saved" ? list.filter((j) => j.key !== key) : list.map((j) => (j.key === key ? { ...j, savedAt: null, updatedAt: now } : j));
}

/** My jobs after the tracker on All: a stage moves the job's status; "I didn't apply" leaves it Saved or removes it. */
function mineAfterStage(list: MyJobView[], job: JobPost, stage: number, isSaved: boolean, fitShown: boolean): MyJobView[] {
  const now = new Date().toISOString();
  const key = `post:${job.id}`;
  const row = list.find((j) => j.key === key);
  if (stage > 0) {
    const status = statusOf(stage);
    if (!row) return [postRow(job, status, now, fitShown), ...list];
    return list.map((j) => (j.key === key ? { ...j, status, appliedAt: j.appliedAt ?? now, closedAt: null, updatedAt: now } : j));
  }
  if (!row) return list;
  return isSaved || row.savedAt
    ? list.map((j) => (j.key === key ? { ...j, status: "saved", appliedAt: null, closedAt: null, updatedAt: now } : j))
    : list.filter((j) => j.key !== key);
}


function Pills<T extends string>({
  label,
  value,
  options,
  any,
  onPick,
  first = null,
  anyPressed,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  any: string;
  onPick: (v: T | null) => void;
  /** A choice before "Any …" (the City filter's "Your places"). */
  first?: ReactNode;
  /** Whether "Any …" is pressed, when `first` can be pressed instead. */
  anyPressed?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1">
      {first}
      <button type="button" aria-pressed={anyPressed ?? value === null} className={pill} onClick={() => onPick(null)}>
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
          className="text-left text-[0.98rem] font-semibold outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-[18px] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
        >
          {job.role}
          <span className="sr-only"> at {job.company}</span>
        </button>
        <p className="flex flex-wrap gap-1.5 text-[0.8rem] text-muted [overflow-wrap:anywhere]">
          {[job.company, job.city, job.workType, job.experience, job.posted ? `posted ${job.posted}` : null].filter(Boolean).map((m, i) => (
            <span key={i} className="contents">
              {i > 0 && <span aria-hidden="true">·</span>}
              <span className="min-w-0">{m}</span>
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
        <div className="min-w-0">
          <h3 className="text-[1.3rem] font-semibold leading-[1.15] [overflow-wrap:anywhere]">{job.role}</h3>
          <small className="mt-0.5 block text-[0.8rem] text-muted [overflow-wrap:anywhere]">
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
 * Why the list is empty, with one next step (src/lib/departures/filter.ts, departuresEmpty). "Show every city" drops
 * only the city filter, keeping the tab, search and type; `pasteId` is the paste box's id.
 */
function EmptyList({
  empty,
  pasteId,
  onClear,
  onEveryCity,
}: {
  empty: ReturnType<typeof departuresEmpty>;
  pasteId: string;
  onClear: () => void;
  onEveryCity: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line p-5 text-center text-[0.9rem] text-muted">
      <p>{empty.text}</p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {empty.kind === "places" && (
          <>
            <button type="button" className={quiet} onClick={onEveryCity}>
              Show every city
            </button>
            <Link href="/settings#acc-pay" className="text-ink underline underline-offset-2">
              Add places in Settings
            </Link>
          </>
        )}
        {(empty.kind === "filtered" || empty.clear) && (
          <button type="button" className={quiet} onClick={onClear}>
            Clear filters
          </button>
        )}
        {empty.kind === "no_roles" && (
          <a href={`#${pasteId}`} className={quiet}>
            Paste a job post
          </a>
        )}
      </div>
    </div>
  );
}
