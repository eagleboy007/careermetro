"use client";

import { ArrowLeft, ArrowRight, Check, Lock, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import {
  BUILDER_JOB_KIND_LABELS,
  BUILDER_JOB_KINDS,
  BUILDER_ROWS_MAX,
  BUILDER_SECTION_LABELS,
  BUILDER_SECTIONS,
  BUILDER_STAGE_LABELS,
  BUILDER_STAGES,
  BUILDER_TEXT_MAX,
  BUILDER_TOOLS_MAX,
  builderMissing,
  type BuilderAnswers,
  type BuilderSection,
} from "@/lib/schemas/builder";
import { PERSON_CITIES } from "@/lib/schemas/constants";
import type { BuilderActions, BuilderData, BuilderReview } from "@/lib/builder/types";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const ink = "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-4 text-[0.86rem] font-medium text-bg hover:opacity-90 aria-disabled:opacity-60";
const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.84rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60";
const quiet = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.84rem] font-medium text-muted hover:text-ink";
const input =
  "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-bg px-3 py-2 text-[0.9rem] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-70";

const newId = () => Math.random().toString(36).slice(2, 10);
const has = (text: string, name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text);

/**
 * Build your resume (FR-36, handoff 12k): seven short sections, one card at a time, then a review page. Answers save
 * on Next and when a field loses focus. Nothing on the review page enters the resume unless it came from an answer;
 * "Suggested, not added" waits for "Yes, add it". Without actions (example data, /design) nothing is saved.
 */
export function BuilderView({ data, actions }: { data: BuilderData; actions?: BuilderActions }) {
  const [a, setA] = useState<BuilderAnswers>(data.answers);
  const [step, setStep] = useState(0);
  const [review, setReview] = useState<BuilderReview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [focusTick, setFocusTick] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const savedRef = useRef(JSON.stringify(data.answers));
  useEffect(() => {
    if (focusTick) headingRef.current?.focus();
  }, [focusTick]);

  const missing = builderMissing(a);
  const done = BUILDER_SECTIONS.filter((s) => !missing[s]).length;
  const section = BUILDER_SECTIONS[step];
  const set = (patch: Partial<BuilderAnswers>) => setA((x) => ({ ...x, ...patch }));

  const save = (then?: () => void) => {
    const now = JSON.stringify(a);
    if (!actions || now === savedRef.current) return then?.();
    start(async () => {
      const error = await actions.save(a);
      if (error) setMessage(error);
      else {
        savedRef.current = now;
        then?.();
      }
    });
  };
  const go = (to: number) => {
    // Tools named in earlier answers are pre-picked the first time the Tools card opens.
    if (BUILDER_SECTIONS[to] === "tools" && !a.tools.length) {
      const named = toolOptions(a, data).filter((t) => t.from).map((t) => t.name);
      if (named.length) set({ tools: named.slice(0, BUILDER_TOOLS_MAX) });
    }
    save(() => {
      setMessage(null);
      setStep(to);
      setFocusTick((n) => n + 1);
    });
  };
  const toReview = () => {
    if (Object.keys(missing).length) {
      setMessage(`${Object.entries(missing).map(([s, why]) => `${BUILDER_SECTION_LABELS[s as BuilderSection]}: ${why}`).join(" ")}`);
      requestAnimationFrame(() => statusRef.current?.focus());
      return;
    }
    if (!actions) {
      setReview({ resumeId: "example", lines: {}, suggestions: [], plain: true });
      setFocusTick((n) => n + 1);
      return;
    }
    start(async () => {
      const r = await actions.review(a);
      if ("error" in r) {
        setMessage(r.error);
        requestAnimationFrame(() => statusRef.current?.focus());
      } else {
        savedRef.current = JSON.stringify(a);
        setReview(r);
        setMessage(null);
        setFocusTick((n) => n + 1);
      }
    });
  };

  if (review)
    return (
      <Review
        a={a}
        data={data}
        review={review}
        actions={actions}
        headingRef={headingRef}
        onEdit={(to) => {
          setReview(null);
          setStep(to);
          setFocusTick((n) => n + 1);
        }}
        onAddTool={(name) => set({ tools: a.tools.includes(name) ? a.tools : [...a.tools, name].slice(0, BUILDER_TOOLS_MAX) })}
        onRebuild={toReview}
        rebuilding={pending}
        dirty={JSON.stringify(a) !== savedRef.current}
      />
    );

  return (
    <div className="flex min-w-0 flex-col gap-5" data-builder onBlur={() => save()}>
      <header className="flex flex-col gap-1">
        <h1 className="text-[clamp(1.9rem,4.5vw,2.4rem)] font-semibold leading-[1.05]">Build your resume</h1>
        <p className="text-[0.9rem] text-muted">Seven short sections, about 10 minutes. Your answers are saved as you go and used only to write your resume.</p>
        <Link href="/start" className="self-start text-[0.84rem] font-medium text-ink underline underline-offset-2">
          I have a resume after all
        </Link>
      </header>

      <div className="grid min-w-0 gap-5 min-[760px]:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Sections">
          <ol className="flex gap-1.5 min-[760px]:flex-col">
            {BUILDER_SECTIONS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => go(i)}
                  className={`flex min-h-11 min-w-11 items-center gap-2 rounded-full px-2.5 text-[0.84rem] ${i === step ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink"}`}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[0.7rem]">{missing[s] ? i + 1 : <Check {...ICON} size={13} />}</span>
                  <span className="max-[759px]:sr-only">{BUILDER_SECTION_LABELS[s]}</span>
                  {!missing[s] && <span className="sr-only">, done</span>}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section aria-labelledby="builder-heading" className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-line bg-surface p-4 min-[760px]:p-5">
          <div className="flex flex-col gap-1.5">
            <p className="font-mono text-[0.7rem] uppercase tracking-wide text-muted">
              Section {step + 1} of {BUILDER_SECTIONS.length}
            </p>
            <h2 id="builder-heading" ref={headingRef} tabIndex={-1} className="text-[1.3rem] font-semibold outline-none">
              {BUILDER_SECTION_LABELS[section]}
            </h2>
            {/* Cobalt: this is progress. */}
            <div role="progressbar" aria-label="Sections done" aria-valuemin={0} aria-valuemax={BUILDER_SECTIONS.length} aria-valuenow={done} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / BUILDER_SECTIONS.length) * 100}%` }} />
            </div>
          </div>

          {section === "role" && <RoleCard a={a} set={set} data={data} />}
          {section === "education" && <EducationCard a={a} set={set} />}
          {section === "projects" && <ProjectsCard a={a} set={set} />}
          {section === "jobs" && <JobsCard a={a} set={set} />}
          {section === "tools" && <ToolsCard a={a} set={set} data={data} />}
          {section === "certificates" && <CertificatesCard a={a} set={set} />}
          {section === "links" && <LinksCard a={a} set={set} />}

          {missing[section] && <p className="text-[0.8rem] text-muted">{missing[section]}</p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {step > 0 && (
              <button type="button" className={quiet} onClick={() => go(step - 1)}>
                <ArrowLeft {...ICON} />
                Back
              </button>
            )}
            {step < BUILDER_SECTIONS.length - 1 ? (
              <button type="button" className={ink} aria-disabled={pending || undefined} onClick={() => !pending && go(step + 1)}>
                Next
                <ArrowRight {...ICON} />
              </button>
            ) : (
              <button type="button" className={ink} aria-disabled={pending || undefined} onClick={() => !pending && toReview()}>
                {pending ? "Writing your resume…" : "Review my resume"}
              </button>
            )}
          </div>
          <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.84rem] text-muted outline-none empty:hidden">
            {message}
          </p>
        </section>
      </div>
    </div>
  );
}

type CardProps = { a: BuilderAnswers; set: (p: Partial<BuilderAnswers>) => void };

function Field({ label, optional, hint, children }: { label: string; optional?: boolean; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.82rem] font-semibold">
        {label} {optional && <em className="font-normal not-italic text-muted">optional</em>}
      </label>
      {children(id)}
      {hint && <small className="text-[0.76rem] text-muted">{hint}</small>}
    </div>
  );
}

function Choice<T extends string>({ legend, options, labels, value, onChange }: { legend: string; options: readonly T[]; labels: Record<T, string>; value: T | null; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-[0.82rem] font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o}>
            <input type="radio" name={name} className="peer sr-only" checked={value === o} onChange={() => onChange(o)} />
            <span className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line-strong px-3.5 text-[0.84rem] peer-checked:border-ink peer-checked:bg-ink peer-checked:text-bg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent">
              {labels[o]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Rows<T extends { id: string }>({ rows, label, onChange, blank, render }: { rows: T[]; label: string; onChange: (rows: T[]) => void; blank: () => T; render: (row: T, patch: (p: Partial<T>) => void) => ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => (
        <fieldset key={row.id} className="flex min-w-0 flex-col gap-3 rounded-md border border-line p-3">
          <legend className="px-1 font-mono text-[0.7rem] uppercase text-muted">
            {label} {i + 1}
          </legend>
          {render(row, (p) => onChange(rows.map((r) => (r.id === row.id ? { ...r, ...p } : r))))}
          <button type="button" className={`${quiet} self-start`} onClick={() => onChange(rows.filter((r) => r.id !== row.id))}>
            <X {...ICON} />
            Remove {label.toLowerCase()} {i + 1}
          </button>
        </fieldset>
      ))}
      {rows.length < BUILDER_ROWS_MAX && (
        <button type="button" className={`${ghost} self-start`} onClick={() => onChange([...rows, blank()])}>
          <Plus {...ICON} />
          {rows.length ? "Add another" : `Add ${label.toLowerCase()}`}
        </button>
      )}
    </div>
  );
}

const free = (value: string, onChange: (v: string) => void, id: string, placeholder?: string) => (
  <>
    <textarea id={id} rows={3} value={value} maxLength={BUILDER_TEXT_MAX} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={input} />
    <small className="text-right font-mono text-[0.7rem] text-muted">
      {value.length}/{BUILDER_TEXT_MAX}
    </small>
  </>
);

function RoleCard({ a, set, data }: CardProps & { data: BuilderData }) {
  const cities = useId();
  return (
    <div className="flex flex-col gap-4">
      <Field label="Target role" hint="Not sure? Pick “Not sure yet” and we show the roles closest to your resume.">
        {(id) => (
          <select id={id} className={input} value={a.role.roleSlug ?? ""} onChange={(e) => set({ role: { ...a.role, roleSlug: e.target.value || null } })}>
            <option value="">Not sure yet</option>
            {data.roles.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Choice legend="Where are you now?" options={BUILDER_STAGES} labels={BUILDER_STAGE_LABELS} value={a.role.stage} onChange={(stage) => set({ role: { ...a.role, stage } })} />
      <Field label="Name" hint="From your account. It can't be changed here.">
        {(id) => (
          <span className="relative flex">
            <input id={id} className={`${input} pr-9`} value={data.name} readOnly aria-readonly="true" />
            <Lock {...ICON} className="absolute right-3 top-3.5 text-muted" />
          </span>
        )}
      </Field>
      <Field label="City" optional>
        {(id) => (
          <>
            <input id={id} list={cities} className={input} value={a.role.city} maxLength={60} autoComplete="address-level2" onChange={(e) => set({ role: { ...a.role, city: e.target.value } })} />
            <datalist id={cities}>
              {PERSON_CITIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </Field>
    </div>
  );
}

function EducationCard({ a, set }: CardProps) {
  return (
    <Rows
      rows={a.education}
      label="Degree"
      onChange={(education) => set({ education })}
      blank={() => ({ id: newId(), degree: "", college: "", start: "", end: "", marks: "" })}
      render={(e, patch) => (
        <>
          <Field label="Degree">{(id) => <input id={id} className={input} value={e.degree} maxLength={120} placeholder="B.Sc. Computer Science" onChange={(x) => patch({ degree: x.target.value })} />}</Field>
          <Field label="College">{(id) => <input id={id} className={input} value={e.college} maxLength={160} onChange={(x) => patch({ college: x.target.value })} />}</Field>
          <div className="grid gap-3 min-[560px]:grid-cols-3">
            <Field label="Start year">{(id) => <input id={id} className={input} inputMode="numeric" maxLength={4} value={e.start} onChange={(x) => patch({ start: x.target.value.replace(/\D/g, "") })} />}</Field>
            <Field label="End year" hint="Or the year you expect to finish.">{(id) => <input id={id} className={input} inputMode="numeric" maxLength={4} value={e.end} onChange={(x) => patch({ end: x.target.value.replace(/\D/g, "") })} />}</Field>
            <Field label="Marks" optional>{(id) => <input id={id} className={input} maxLength={40} placeholder="8.1 CGPA" value={e.marks} onChange={(x) => patch({ marks: x.target.value })} />}</Field>
          </div>
        </>
      )}
    />
  );
}

function ProjectsCard({ a, set }: CardProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.84rem] text-muted">College projects, things you built at home, hackathons. Say what you did in plain words; we tidy the wording, never the facts.</p>
      <Rows
        rows={a.projects}
        label="Project"
        onChange={(projects) => set({ projects })}
        blank={() => ({ id: newId(), name: "", did: "", link: "" })}
        render={(p, patch) => (
          <>
            <Field label="Project name">{(id) => <input id={id} className={input} value={p.name} maxLength={120} onChange={(x) => patch({ name: x.target.value })} />}</Field>
            <Field label="What did you build or do?">{(id) => free(p.did, (did) => patch({ did }), id, "Set up Wazuh on 3 home machines and wrote alert rules")}</Field>
            <Field label="Link" optional>{(id) => <input id={id} className={input} type="url" inputMode="url" placeholder="https://" value={p.link} onChange={(x) => patch({ link: x.target.value.trim() })} />}</Field>
          </>
        )}
      />
    </div>
  );
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function JobsCard({ a, set }: CardProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 items-center gap-2.5 text-[0.86rem]">
        <input type="checkbox" checked={a.worked === false} onChange={(e) => set({ worked: e.target.checked ? false : a.jobs.length ? true : null })} className="size-4 accent-[var(--ink)]" />
        I haven&rsquo;t worked yet
      </label>
      {a.worked !== false && (
        <Rows
          rows={a.jobs}
          label="Job"
          onChange={(jobs) => set({ jobs, worked: jobs.length ? true : null })}
          blank={() => ({ id: newId(), kind: "internship", company: "", title: "", from: "", to: "", did: "" })}
          render={(j, patch) => (
            <>
              <Choice legend="Kind" options={BUILDER_JOB_KINDS} labels={BUILDER_JOB_KIND_LABELS} value={j.kind} onChange={(kind) => patch({ kind })} />
              <div className="grid gap-3 min-[560px]:grid-cols-2">
                <Field label={j.kind === "freelance" ? "Client" : "Company"} optional={j.kind === "freelance" || j.kind === "volunteer"}>
                  {(id) => <input id={id} className={input} value={j.company} maxLength={120} onChange={(x) => patch({ company: x.target.value })} />}
                </Field>
                <Field label="Title">{(id) => <input id={id} className={input} value={j.title} maxLength={120} onChange={(x) => patch({ title: x.target.value })} />}</Field>
                <Field label="From">{(id) => <input id={id} type="month" className={input} value={j.from} onChange={(x) => patch({ from: MONTH.test(x.target.value) ? x.target.value : "" })} />}</Field>
                <Field label="To">
                  {(id) => (
                    <span className="flex flex-col gap-1.5">
                      <input id={id} type="month" className={input} disabled={j.to === "now"} value={j.to === "now" ? "" : j.to} onChange={(x) => patch({ to: MONTH.test(x.target.value) ? x.target.value : "" })} />
                      <label className="flex min-h-11 items-center gap-2 text-[0.82rem]">
                        <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={j.to === "now"} onChange={(x) => patch({ to: x.target.checked ? "now" : "" })} />
                        I still work here
                      </label>
                    </span>
                  )}
                </Field>
              </div>
              <Field label="What did you do?">{(id) => free(j.did, (did) => patch({ did }), id, "Closed about 20 tickets a week")}</Field>
            </>
          )}
        />
      )}
    </div>
  );
}

/** The role's tools plus the person's own, each marked when an earlier answer names it. */
function toolOptions(a: BuilderAnswers, data: BuilderData): { name: string; from: "project" | "job" | null }[] {
  const role = a.role.roleSlug ? (data.roleTools[a.role.roleSlug] ?? []) : [];
  const names = [...new Set([...role, ...a.tools])];
  const projects = a.projects.map((p) => p.did).join("\n");
  const jobs = (a.worked ? a.jobs : []).map((j) => j.did).join("\n");
  return names.map((name) => ({ name, from: has(projects, name) ? "project" : has(jobs, name) ? "job" : null }));
}

function ToolsCard({ a, set, data }: CardProps & { data: BuilderData }) {
  const [own, setOwn] = useState("");
  const options = toolOptions(a, data);
  const toggle = (name: string) => set({ tools: a.tools.includes(name) ? a.tools.filter((t) => t !== name) : [...a.tools, name].slice(0, BUILDER_TOOLS_MAX) });
  const add = () => {
    const name = own.trim().slice(0, 60);
    if (name && !a.tools.some((t) => t.toLowerCase() === name.toLowerCase())) set({ tools: [...a.tools, name].slice(0, BUILDER_TOOLS_MAX) });
    setOwn("");
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.84rem] text-muted">Pick the tools you have used. Only what you pick goes on your resume. Up to {BUILDER_TOOLS_MAX}.</p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Tools">
        {options.map((t) => (
          <li key={t.name}>
            <button
              type="button"
              aria-pressed={a.tools.includes(t.name)}
              onClick={() => toggle(t.name)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[0.82rem] ${a.tools.includes(t.name) ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink"}`}
            >
              {a.tools.includes(t.name) && <Check {...ICON} size={14} />}
              {t.name}
              {t.from && <span className="font-mono text-[0.66rem] uppercase opacity-80">from your {t.from}</span>}
            </button>
          </li>
        ))}
      </ul>
      <Field label="Add your own" optional>
        {(id) => (
          <span className="flex gap-2">
            <input
              id={id}
              className={input}
              value={own}
              maxLength={60}
              onChange={(e) => setOwn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className={ghost} onClick={add}>
              Add
            </button>
          </span>
        )}
      </Field>
    </div>
  );
}

function CertificatesCard({ a, set }: CardProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 items-center gap-2.5 text-[0.86rem]">
        <input type="checkbox" checked={a.noCertificates} onChange={(e) => set({ noCertificates: e.target.checked })} className="size-4 accent-[var(--ink)]" />
        None yet
      </label>
      {!a.noCertificates && (
        <Rows
          rows={a.certificates}
          label="Certificate"
          onChange={(certificates) => set({ certificates })}
          blank={() => ({ id: newId(), name: "", issuer: "", earned: "", badge: "" })}
          render={(c, patch) => (
            <>
              <Field label="Name">{(id) => <input id={id} className={input} value={c.name} maxLength={160} onChange={(x) => patch({ name: x.target.value })} />}</Field>
              <div className="grid gap-3 min-[560px]:grid-cols-2">
                <Field label="Issuer" optional>{(id) => <input id={id} className={input} value={c.issuer} maxLength={120} onChange={(x) => patch({ issuer: x.target.value })} />}</Field>
                <Field label="Month earned" optional>{(id) => <input id={id} type="month" className={input} value={c.earned} onChange={(x) => patch({ earned: MONTH.test(x.target.value) ? x.target.value : "" })} />}</Field>
              </div>
              <Field label="Badge link" optional hint="A Credly badge link gets the verified tick on Me once it is checked.">
                {(id) => <input id={id} className={input} type="url" inputMode="url" placeholder="https://" value={c.badge} onChange={(x) => patch({ badge: x.target.value.trim() })} />}
              </Field>
            </>
          )}
        />
      )}
    </div>
  );
}

function LinksCard({ a, set }: CardProps) {
  const link = (key: keyof BuilderAnswers["links"], label: string, placeholder: string, type = "url") => (
    <Field label={label} optional>
      {(id) => <input id={id} className={input} type={type} inputMode={type === "email" ? "email" : "url"} placeholder={placeholder} value={a.links[key]} onChange={(x) => set({ links: { ...a.links, [key]: x.target.value.trim() } })} />}
    </Field>
  );
  return (
    <div className="flex flex-col gap-3">
      {link("github", "GitHub", "https://github.com/")}
      {link("portfolio", "Portfolio", "https://")}
      {link("linkedin", "LinkedIn", "https://www.linkedin.com/in/")}
      {link("email", "Email on the resume", "you@example.com", "email")}
      <p className="text-[0.8rem] text-muted">Your phone number goes only on the file you download. We never store it.</p>
    </div>
  );
}

function Review({
  a,
  data,
  review,
  actions,
  headingRef,
  onEdit,
  onAddTool,
  onRebuild,
  rebuilding,
  dirty,
}: {
  a: BuilderAnswers;
  data: BuilderData;
  review: BuilderReview;
  actions?: BuilderActions;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onEdit: (step: number) => void;
  onAddTool: (name: string) => void;
  onRebuild: () => void;
  rebuilding: boolean;
  dirty: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [left, setLeft] = useState<Set<number>>(new Set());
  const [sure, setSure] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const stepOf = (answerId: string | null) => BUILDER_SECTIONS.indexOf(answerId?.startsWith("j:") ? "jobs" : "projects");
  const say = (text: string) => {
    setMessage(text);
    requestAnimationFrame(() => statusRef.current?.focus());
  };
  const linesFor = (id: string, own: string) => review.lines[id] ?? own.split(/(?<=[.!?])\s+/).filter(Boolean);
  const jobs = a.worked ? a.jobs : [];
  const named = toolOptions(a, data);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-builder-review>
      <header className="flex flex-col gap-1">
        <h1 ref={headingRef} tabIndex={-1} className="text-[clamp(1.9rem,4.5vw,2.4rem)] font-semibold leading-[1.05] outline-none">
          Your resume
        </h1>
        <p className="text-[0.9rem] text-muted">Tap any line to see the answer it came from. Nothing here is added unless it came from your answers.</p>
        {review.plain && <p className="text-[0.84rem] text-muted">The wording is plain for now: these lines are your own sentences.</p>}
      </header>

      <div className="grid min-w-0 gap-5 min-[860px]:grid-cols-[minmax(0,1fr)_300px]">
        <article aria-label="Resume preview" className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-line bg-surface p-4 min-[760px]:p-6">
          <div>
            <h2 className="text-[1.4rem] font-semibold">{data.name}</h2>
            <p className="text-[0.82rem] text-muted">{[a.role.city, a.links.email, a.links.linkedin, a.links.github, a.links.portfolio].filter(Boolean).join(" · ")}</p>
          </div>
          {jobs.length > 0 && (
            <ResumeSection title="Experience">
              {jobs.map((j) => (
                <div key={j.id}>
                  <p className="text-[0.92rem] font-semibold">
                    {j.title}
                    {j.kind === "internship" ? " (Internship)" : ""}
                    {j.company ? `, ${j.company}` : ""}
                  </p>
                  <p className="font-mono text-[0.72rem] text-muted">
                    {j.from} to {j.to === "now" ? "now" : j.to}
                  </p>
                  <ul>{linesFor(`j:${j.id}`, j.did).map((l, i) => <Line key={i} id={`j:${j.id}`} line={l} answer={j.did} open={open} setOpen={setOpen} />)}</ul>
                </div>
              ))}
            </ResumeSection>
          )}
          {a.projects.length > 0 && (
            <ResumeSection title="Projects">
              {a.projects.map((p) => (
                <div key={p.id}>
                  <p className="text-[0.92rem] font-semibold">{p.name}</p>
                  <ul>{linesFor(`p:${p.id}`, p.did).map((l, i) => <Line key={i} id={`p:${p.id}`} line={l} answer={p.did} open={open} setOpen={setOpen} />)}</ul>
                </div>
              ))}
            </ResumeSection>
          )}
          <ResumeSection title="Education">
            {a.education.map((e) => (
              <p key={e.id} className="text-[0.88rem]">
                <b className="font-semibold">{e.degree}</b>, {e.college} {[e.start, e.end].filter(Boolean).join(" to ")}
                {e.marks ? ` · ${e.marks}` : ""}
              </p>
            ))}
          </ResumeSection>
          <ResumeSection title="Skills">
            <p className="text-[0.88rem]">{a.tools.join(", ")}</p>
          </ResumeSection>
          {!a.noCertificates && a.certificates.length > 0 && (
            <ResumeSection title="Certifications">
              {a.certificates.map((c) => (
                <p key={c.id} className="text-[0.88rem]">
                  {[c.name, c.issuer, c.earned].filter(Boolean).join(", ")}
                </p>
              ))}
            </ResumeSection>
          )}
        </article>

        <aside className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="builder-found" className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-4">
            <h2 id="builder-found" className="text-[0.95rem] font-semibold">
              Skills we found
            </h2>
            <ul className="flex flex-col gap-1.5 text-[0.84rem]">
              {a.tools.map((t) => {
                const from = named.find((n) => n.name === t)?.from;
                return (
                  <li key={t}>
                    <b className="font-semibold">{t}</b>
                    <small className="block text-[0.76rem] text-muted">{from ? `You picked it, and your ${from} names it` : "You picked it in Tools"}</small>
                  </li>
                );
              })}
              {(a.noCertificates ? [] : a.certificates).map((c) => (
                <li key={c.id}>
                  <b className="font-semibold">{c.name}</b>
                  <small className="block text-[0.76rem] text-muted">Your certificate</small>
                </li>
              ))}
            </ul>
          </section>

          {review.suggestions.length > 0 && (
            <section aria-labelledby="builder-suggested" className="flex flex-col gap-2 rounded-[14px] border border-dashed border-line-strong p-4">
              <h2 id="builder-suggested" className="text-[0.95rem] font-semibold">
                Suggested, not added
              </h2>
              <ul className="flex flex-col gap-3 text-[0.84rem]">
                {review.suggestions.map((s, i) =>
                  left.has(i) ? null : (
                    <li key={i} className="flex flex-col gap-1.5">
                      <span>{s.text}</span>
                      <span className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className={ghost}
                          onClick={() => {
                            setLeft((x) => new Set(x).add(i));
                            if (s.kind === "tool") {
                              const tool = data.roleTools[a.role.roleSlug ?? ""]?.find((t) => has(s.text, t));
                              if (tool) {
                                onAddTool(tool);
                                say(`${tool} added to your tools. Press "Update my resume" to put it in.`);
                              } else onEdit(BUILDER_SECTIONS.indexOf("tools"));
                            } else onEdit(stepOf(s.answerId));
                          }}
                        >
                          Yes, add it
                        </button>
                        <button type="button" className={quiet} onClick={() => setLeft((x) => new Set(x).add(i))}>
                          Leave out
                        </button>
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
        <label className="flex min-h-11 items-center gap-2.5 text-[0.9rem] font-[550]">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="size-4 accent-[var(--ink)]" />
          Everything here is true and mine.
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <button type="button" className={ink} aria-disabled={rebuilding || undefined} onClick={() => !rebuilding && onRebuild()}>
              {rebuilding ? "Writing your resume…" : "Update my resume"}
            </button>
          ) : (
            <button
              type="button"
              className={ink}
              aria-disabled={!sure || pending || undefined}
              onClick={() => {
                if (!sure) return say('Tick "Everything here is true and mine." first.');
                if (!actions) return say("This is an example. Nothing is saved.");
                start(async () => {
                  const error = await actions.gaps(review.resumeId, sure);
                  if (error) say(error);
                });
              }}
            >
              Check my gaps
            </button>
          )}
          <button type="button" className={quiet} onClick={() => onEdit(0)}>
            Edit answers
          </button>
        </div>
        <small className="text-[0.78rem] text-muted">Next you check what we read, as with an upload. Then you can download it as a PDF or Word file (one column, standard headings, no photos or tables).</small>
        <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.84rem] text-muted outline-none empty:hidden">
          {message}
        </p>
      </div>
    </div>
  );
}

function ResumeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="font-mono text-[0.72rem] uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** A resume line on the review page: a button that shows the answer it came from. */
function Line({ id, line, answer, open, setOpen }: { id: string; line: string; answer: string; open: string | null; setOpen: (key: string | null) => void }) {
  const key = `${id}|${line}`;
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)} className="min-h-11 rounded-md px-1.5 text-left text-[0.88rem] hover:bg-surface-2">
        {line}
      </button>
      {open === key && <p className="ml-1.5 border-l-2 border-line-strong pl-2.5 text-[0.8rem] text-muted">Your answer: &ldquo;{answer}&rdquo;</p>}
    </li>
  );
}
