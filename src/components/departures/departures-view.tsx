"use client";

import { ArrowRight, Bookmark, Clock, ExternalLink, Search, ShieldCheck, Target, Zap } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { ICON, plural, seg, Soon } from "@/components/map/map-parts";
import { StatusChip } from "@/components/ui/status-chip";
import { citiesOf, filterDepartures, initials, NO_FILTERS, readiness, type DepartureFilters, type DepartureTab } from "@/lib/departures/filter";
import { APPLY_STAGES, WORK_TYPES, type JobPost } from "@/lib/schemas";
import { departureTone, departureWhen } from "@/lib/today/board";

const WHEN_TONE = { now: "bg-good-soft text-good", soon: "bg-warn-soft text-warn", later: "bg-surface-2 text-muted" } as const;
const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-line px-[11px] py-1 text-[0.78rem] font-[550] text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink";
const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-[15px] py-[9px] text-[0.86rem] font-[550]";
const primary = `${btn} bg-accent text-on-accent hover:opacity-90`;
const ghostBtn = `${btn} border border-line bg-surface text-ink hover:bg-surface-2`;

/**
 * Departures (handoff section 8): roles with readiness in words, search and filters, the person's Saved and Applied
 * lists, and a detail panel for the role they pick. `hasResume` false hides fit until there is a resume; `noFit`
 * hides it with its own reason (a signed-in person, while the roles are still examples).
 */
export function DeparturesView({
  jobs,
  hasResume = true,
  initialSaved = [],
  initialApplied = [],
  noFit = null,
}: {
  jobs: JobPost[];
  hasResume?: boolean;
  noFit?: string | null;
  initialSaved?: string[];
  initialApplied?: [string, number][];
}) {
  const [filters, setFilters] = useState<DepartureFilters>(NO_FILTERS);
  const [saved, setSaved] = useState(() => new Set(initialSaved));
  const [applied, setApplied] = useState(() => new Map(initialApplied));
  const [selected, setSelected] = useState<string | null>(() => jobs.find((j) => j.express)?.id ?? jobs[0]?.id ?? null);
  const [said, setSaid] = useState("");
  const detailId = useId();
  const shown = useMemo(() => filterDepartures(jobs, filters, saved, applied), [jobs, filters, saved, applied]);
  const cities = useMemo(() => citiesOf(jobs), [jobs]);
  // The panel follows the list: a role the filters hide is not shown or changed.
  const job = shown.find((j) => j.id === selected) ?? shown[0] ?? null;
  const fit = hasResume && noFit === null;
  const set = (patch: Partial<DepartureFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const toggleSave = (id: string) => {
    const next = new Set(saved);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSaved(next);
    setSaid(next.has(id) ? "Saved." : "Removed from saved.");
  };
  const setStage = (id: string, stage: number) =>
    setApplied((m) => {
      const next = new Map(m);
      if (stage === 0) next.delete(id);
      else next.set(id, stage);
      return next;
    });

  return (
    <div className="grid min-w-0 min-[760px]:min-h-[700px] min-[760px]:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4 pb-8 min-[760px]:pr-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[2rem] font-semibold leading-[1.1]">Departures</h2>
            <p className="mt-1.5 max-w-[60ch] text-[0.92rem] text-muted">
              Roles from public company job boards and posts you paste. Apply on the company&apos;s site, or in one tap with Express apply where the company takes it.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-[0.84rem] font-[550] text-muted">Looking for a job switch · soon</span>
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">{plural(jobs.length, "role")}</span>
          </div>
        </div>

        <label className="flex items-center gap-2.5 rounded-full border border-line bg-surface px-3.5 py-[11px] text-[0.9rem] text-muted focus-within:outline-2 focus-within:outline-accent">
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
            <i className="relative h-5 w-9 rounded-full bg-line transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:transition-[left] peer-checked:bg-accent peer-checked:after:left-[18px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
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
                fit={fit}
                selected={j.id === job?.id}
                detailId={detailId}
                saved={saved.has(j.id)}
                applied={applied.has(j.id)}
                onOpen={() => {
                  setSelected(j.id);
                  if (window.matchMedia("(max-width: 759px)").matches) document.getElementById(detailId)?.scrollIntoView({ block: "start" });
                }}
                onSave={() => toggleSave(j.id)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line p-5 text-center text-[0.9rem] text-muted">
            {filters.tab === "all" ? "No roles match. Try another city or type, or clear the search." : `Nothing ${filters.tab} matches yet.`}
          </p>
        )}

        {fit && <PasteBox />}
        <p role="status" className="sr-only">
          {said}
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
            fit={fit}
            noFit={noFit ?? (hasResume ? null : NO_RESUME)}
            stage={applied.get(job.id) ?? 0}
            onStage={(s) => {
              setStage(job.id, s);
              setSaid(s === 0 ? "No longer marked as applied." : s === 1 ? `Marked as applied to ${job.company}.` : `Moved to ${APPLY_STAGES[s - 1]}.`);
            }}
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
          {[job.company, job.city, job.workType, job.experience, job.posted].map((m, i) => (
            <span key={i} className="contents">
              {i > 0 && <span aria-hidden="true">·</span>}
              <span>{m}</span>
            </span>
          ))}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {fit && (job.gaps.length ? job.gaps.map((g) => <StatusChip key={g.name} status={g.status} label={g.name} />) : <StatusChip status="met" label="No required gaps" />)}
          {job.express && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">
              <Zap size={14} {...ICON} className="text-ink" />
              Express apply
            </span>
          )}
        </div>
      </div>
      <div className="col-start-2 flex items-center justify-between gap-2.5 min-[760px]:col-start-3 min-[760px]:flex-col min-[760px]:items-end">
        {applied ? (
          <When className="bg-accent-soft text-accent">Applied</When>
        ) : fit ? (
          <When className={WHEN_TONE[tone]}>{departureWhen(job.goalsBefore)}</When>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onSave}
          aria-pressed={saved}
          aria-label={`Save ${job.role}`}
          className="relative z-10 grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-line text-muted aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
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
  onStage,
}: {
  job: JobPost;
  fit: boolean;
  noFit: string | null;
  stage: number;
  onStage: (stage: number) => void;
}) {
  const site = `Apply on ${job.company}'s site`;
  return (
    <div className="flex animate-[sheet-in_.3s_cubic-bezier(.2,.8,.2,1)] flex-col gap-4 min-[760px]:sticky min-[760px]:top-4">
      <div className="flex items-center gap-3">
        <Logo name={job.company} />
        <div>
          <h3 className="text-[1.3rem] font-semibold leading-[1.15]">{job.role}</h3>
          <small className="mt-0.5 block text-[0.8rem] text-muted">
            {job.company} · {job.city} · {job.workType}
            {job.hours ? ` (${job.hours})` : ""} · {job.experience}
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
          {noFit === NO_RESUME && (
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
                  type="button"
                  aria-pressed={i < stage}
                  onClick={() => onStage(i + 1)}
                  className="flex w-full items-center gap-2.5 rounded-sm py-2 text-left text-[0.86rem] text-muted aria-pressed:font-[550] aria-pressed:text-ink"
                >
                  <span className={`h-[18px] w-[18px] shrink-0 rounded-full border-2 ${i < stage ? "border-accent bg-accent" : "border-line bg-surface"}`} />
                  {name}
                  {i === 0 && " · on the company site"}
                </button>
              </li>
            ))}
          </ol>
          <p className="text-[0.86rem] text-muted">
            Tap a step when it happens. Only you see this.{" "}
            {stage === 1 && (
              <button type="button" onClick={() => onStage(0)} className="font-[550] text-ink underline underline-offset-2">
                I didn&apos;t apply
              </button>
            )}
          </p>
          <Soon>Ask people who work in this role</Soon>
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {job.express && fit && (
              <button type="button" disabled className={`${primary} cursor-not-allowed opacity-60`}>
                <Zap size={17} {...ICON} />
                Express apply · soon
              </button>
            )}
            {job.applyUrl ? (
              <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" onClick={() => onStage(1)} className={job.express && fit ? ghostBtn : primary}>
                <ExternalLink size={17} {...ICON} />
                {site}
              </a>
            ) : (
              // Example roles have no posting to open, so the button only shows how tracking works.
              <button type="button" onClick={() => onStage(1)} className={job.express && fit ? ghostBtn : primary}>
                {site} · example
              </button>
            )}
          </div>
          <Note Icon={ShieldCheck}>
            {!job.applyUrl
              ? "An example role: this marks it as applied so you can see the tracking. Real roles open the company's own posting."
              : fit && job.express
                ? "Express apply will fill everything from your profile: skills, verified certificates, proof of work and resume. You review it and nothing is sent until you say so."
                : "Opens the company's own posting. We note that you applied so you can track it here."}
          </Note>
          {fit && job.gaps.length > 0 && <Soon>Ask someone who got this role</Soon>}
        </>
      )}

      {fit && <Soon>Interview prep for this role</Soon>}
      <Note Icon={Clock}>
        Posted {job.posted}
        {job.applyUrl ? " on the company's public job board." : "."}
      </Note>
    </div>
  );
}

function PasteBox() {
  return (
    <section aria-label="Paste a job post" className="mt-1.5 flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface p-[18px]">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-[1.05rem] font-semibold">Saw a role somewhere else?</h3>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">paste the job post</span>
      </div>
      <textarea
        rows={3}
        disabled
        aria-label="Job post"
        placeholder="Paste the full job description here. We compare it with your resume and show the gaps for this one role."
        className="w-full resize-y rounded-[12px] border border-line bg-bg px-3 py-2.5 text-[0.88rem] text-ink disabled:cursor-not-allowed"
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" disabled className={`${primary} cursor-not-allowed px-[11px] py-1.5 text-[0.8rem] opacity-60`}>
          <Target size={17} {...ICON} />
          Check my gaps · soon
        </button>
        <span className="text-[0.78rem] text-muted">The post is saved to your Departures; it is never shared.</span>
      </div>
    </section>
  );
}
