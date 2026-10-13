"use client";

import { ArrowLeft, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { CertificateOptionView, ColleagueView, JobFormActions, JobFormData, JobFormValues, JobHonestyTicks, JobRequirementsView, JobWorkType, SkillOptionView } from "@/lib/corporate/types";
import {
  JOB_CRITERIA_CERTIFICATES_MAX,
  JOB_HONESTY_CHECKS,
  JOB_NICE_MAX,
  JOB_ONE_OF_GROUPS_MAX,
  JOB_ONE_OF_SIZE_MAX,
  JOB_REQUIRED_MAX,
  JOB_WORK_TYPE_LABELS,
  JOB_WORK_TYPES,
  JOBS_BLOCKED_TEXT,
  ORG_ROLE_LABELS,
} from "@/lib/schemas/constants";
import { JobStatusBadge, monoLabel, PostedJobCard } from "./job-parts";
import { actionBtn, inkBtn } from "./jobs-panel";
import { fieldClass, hintClass, ICON, inputClass, labelClass } from "./parts";

/*
 * Post a job (handoff 12g, C9; dev/corporate-plan.md build step 3). Starts from one of our role profiles, which fills
 * the skills; the person adjusts them by picking from our skill list only (no free text, and the model never writes a
 * job). Title, work type and city; Hiring HR and interviewers from the company's team; the stages with the L1 AI round
 * off; three ticks before it opens; and a live preview of the Departures card. Express apply criteria (pending item
 * 16): required skills that need accepted proof, and certificates from our list; they warn candidates, never block.
 * Workplace, experience, openings, pay and a description come later (not in the jobs table yet).
 */

const CATEGORY_LABELS: Record<string, string> = {
  programming: "Programming",
  data: "Data",
  tools: "Tools",
  "cloud-devops": "Cloud and DevOps",
  web: "Web",
  ml: "Machine learning",
  testing: "Testing",
  product: "Product",
  workplace: "Workplace",
  design: "Design",
  business: "Business",
  marketing: "Marketing",
  security: "Security",
};
const CITIES = ["Bengaluru", "Chennai", "Delhi NCR", "Gurugram", "Hyderabad", "Kochi", "Kolkata", "Mumbai", "Noida", "Pune", "Remote"];
const STAGES = ["Applied", "Shortlisted", "Level 1 AI interview", "Level 2 team interview", "Offer", "Not this time"];
const NO_TICKS: JobHonestyTicks = { real: false, noFee: false, fair: false };
const card = "flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5";
const chip = "inline-flex items-center gap-0.5 rounded-full bg-surface-2 py-0.5 pl-3 pr-0.5 text-[0.84rem]";
const sectionTitle = "text-[1.05rem] font-semibold tracking-[-0.015em]";

type Group = "required" | "nice";

function Section({ id, title, children, hint }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className={card}>
      <div>
        <h2 id={`${id}-h`} className={sectionTitle}>
          {title}
        </h2>
        {hint && <p className="mt-1 text-[0.84rem] text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** A select of our skills by category, without the ones already used, and an Add button. */
function SkillAdder({
  id,
  label,
  button,
  skills,
  used,
  disabled,
  onAdd,
}: {
  id: string;
  label: string;
  button: string;
  skills: SkillOptionView[];
  used: Set<string>;
  disabled?: boolean;
  onAdd: (skillId: string) => void;
}) {
  const [picked, setPicked] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, SkillOptionView[]>();
    for (const s of skills) if (!used.has(s.id)) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()];
  }, [skills, used]);
  return (
    <div className="flex flex-wrap gap-2">
      <select id={id} aria-label={label} value={picked} disabled={disabled} onChange={(e) => setPicked(e.target.value)} className={`${inputClass} min-h-11 min-w-0 flex-1 basis-[200px]`}>
        <option value="">Pick a skill</option>
        {groups.map(([category, list]) => (
          <optgroup key={category} label={CATEGORY_LABELS[category] ?? category}>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        className={actionBtn}
        disabled={disabled || !picked}
        onClick={() => {
          onAdd(picked);
          setPicked("");
          document.getElementById(id)?.focus();
        }}
      >
        <Plus {...ICON} />
        {button}
      </button>
    </div>
  );
}

/**
 * Our certificates by issuer, without the ones already asked for, and an Add button. At the limit (`full`) the select
 * stays focusable but marked aria-disabled and ignores picks, so focus moved to it after adding the last one or removing
 * one never lands on a disabled control and drops to the page.
 */
function CertificateAdder({ id, certificates, used, full, onAdd }: { id: string; certificates: CertificateOptionView[]; used: Set<string>; full: boolean; onAdd: (certId: string) => void }) {
  const [picked, setPicked] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, CertificateOptionView[]>();
    for (const c of certificates) if (!used.has(c.id)) m.set(c.issuer, [...(m.get(c.issuer) ?? []), c]);
    return [...m.entries()];
  }, [certificates, used]);
  return (
    <div className="flex flex-wrap gap-2">
      <select
        id={id}
        aria-label="Add a certificate"
        aria-disabled={full || undefined}
        aria-describedby={full ? `${id}-full` : undefined}
        value={full ? "" : picked}
        onChange={(e) => !full && setPicked(e.target.value)}
        className={`${inputClass} min-h-11 min-w-0 flex-1 basis-[200px] aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
      >
        <option value="">Pick a certificate</option>
        {groups.map(([issuer, list]) => (
          <optgroup key={issuer} label={issuer}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        className={actionBtn}
        disabled={full || !picked}
        onClick={() => {
          if (full || !picked) return;
          onAdd(picked);
          setPicked("");
          document.getElementById(id)?.focus();
        }}
      >
        <Plus {...ICON} />
        Add
      </button>
      {full && (
        <p id={`${id}-full`} className={`${hintClass} basis-full`}>
          {JOB_CRITERIA_CERTIFICATES_MAX} certificates is the most a job can ask for. Remove one to add another.
        </p>
      )}
    </div>
  );
}

/** Skill chips, each with a Remove button (44px target). */
function SkillChips({ ids, name, from, onRemove }: { ids: string[]; name: (id: string) => string; from: string; onRemove: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ids.map((s) => (
        <li key={s} className={chip}>
          {name(s)}
          <button type="button" aria-label={`Remove ${name(s)} from ${from}`} onClick={() => onRemove(s)} className="-my-2 grid size-11 place-items-center rounded-full text-muted hover:text-ink">
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function JobForm({ data, initial, today, actions }: { data: JobFormData; initial: JobFormValues | null; today: string; actions?: JobFormActions }) {
  const router = useRouter();
  const ids = useId();
  const firstRole = data.roles.find((r) => r.slug === "cyber-security-analyst") ?? data.roles[0];
  const [values, setValues] = useState<JobFormValues>(
    () =>
      initial ?? {
        jobId: null,
        status: "draft",
        roleSlug: firstRole?.slug ?? "",
        title: firstRole?.title ?? "",
        workType: "full_time",
        city: "",
        requirements: firstRole?.requirements ?? { required: [], oneOf: [], nice: [] },
        criteria: { verifiedSkills: [], certificates: [] },
        hiring: [],
        interviewers: [],
      },
  );
  const [ticks, setTicks] = useState<JobHonestyTicks>(NO_TICKS);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [pending, start] = useTransition();
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const names = useMemo(() => new Map(data.skills.map((s) => [s.id, s.name])), [data.skills]);
  const name = (id: string) => names.get(id) ?? id;
  const certNames = useMemo(() => new Map(data.certificates.map((c) => [c.id, c.name])), [data.certificates]);
  const certName = (id: string) => certNames.get(id) ?? id;
  const crit = values.criteria;
  const req = values.requirements;
  const used = useMemo(() => new Set([...req.required, ...req.oneOf.flat(), ...req.nice]), [req]);
  const closed = values.status === "closed";
  const isNew = values.jobId === null;
  const allTicked = ticks.real && ticks.noFee && ticks.fair;
  const canOpenHere = values.status === "draft";
  const blocked = data.blocked;
  const whyNot = blocked ? JOBS_BLOCKED_TEXT[blocked] : req.required.length === 0 ? "Add at least one required skill to open the job." : !allTicked ? "Tick the three boxes to open the job." : "";

  /** Proof can be asked for only of a required skill: one that leaves Required leaves the criteria too. */
  const keepCriteria = (v: JobFormValues, next: JobRequirementsView) => ({ ...v.criteria, verifiedSkills: v.criteria.verifiedSkills.filter((s) => next.required.includes(s)) });
  const setReq = (next: JobRequirementsView, words: string) => {
    setValues((v) => ({ ...v, requirements: next, criteria: keepCriteria(v, next) }));
    setSaid(words);
  };
  const toggleProof = (skillId: string, on: boolean) => {
    setValues((v) => ({ ...v, criteria: { ...v.criteria, verifiedSkills: on ? [...v.criteria.verifiedSkills, skillId] : v.criteria.verifiedSkills.filter((s) => s !== skillId) } }));
    setSaid(on ? `Express apply asks for proof of ${name(skillId)}.` : `Proof of ${name(skillId)} no longer asked for.`);
  };
  const setCertificates = (certificates: string[], words: string) => {
    setValues((v) => ({ ...v, criteria: { ...v.criteria, certificates } }));
    setSaid(words);
  };
  const add = (group: Group, id: string) => setReq({ ...req, [group]: [...req[group], id] }, `${name(id)} added to ${group === "required" ? "Required" : "Nice to have"}.`);
  const remove = (group: Group, id: string, selectId: string) => {
    setReq({ ...req, [group]: req[group].filter((s) => s !== id) }, `${name(id)} removed.`);
    document.getElementById(selectId)?.focus();
  };
  const setGroup = (i: number, skills: string[], words: string) =>
    setReq({ ...req, oneOf: skills.length ? req.oneOf.map((g, j) => (j === i ? skills : g)) : req.oneOf.filter((_, j) => j !== i) }, words);

  const pickRole = (slug: string) => {
    const role = data.roles.find((r) => r.slug === slug);
    if (!role) return;
    const previous = data.roles.find((r) => r.slug === values.roleSlug);
    setValues((v) => ({
      ...v,
      roleSlug: slug,
      requirements: role.requirements,
      criteria: keepCriteria(v, role.requirements),
      title: !v.title.trim() || v.title === previous?.title ? role.title : v.title,
    }));
    setSaid(`Skills set from ${role.title}. You can change them below.`);
  };
  const toggleTeam = (list: "hiring" | "interviewers", memberId: string, on: boolean) =>
    setValues((v) => ({ ...v, [list]: on ? [...v[list], memberId] : v[list].filter((m) => m !== memberId) }));

  const save = (open: boolean) =>
    start(async () => {
      setError(null);
      if (!actions) {
        setSaid("Example form. Nothing is saved.");
        return;
      }
      const r = await actions.save(values, open ? ticks : null);
      if (!r.ok) setError(r.error);
      else router.push("/corporate#jobs");
    });

  const preview = {
    id: "preview",
    title: values.title.trim(),
    company: data.company,
    city: values.city.trim(),
    workType: values.workType,
    postedOn: today,
    required: req.required.map(name),
    oneOf: req.oneOf.map((g) => g.map(name)),
    nice: req.nice.map(name),
    criteria: { verifiedSkills: crit.verifiedSkills.map(name), certificates: crit.certificates.map(certName) },
  };
  // Someone whose work-email re-check is due is listed only where they were already on the team: they can be taken
  // off, but not newly added until they confirm their work email.
  const listed = (list: "hiring" | "interviewers") => (c: ColleagueView) => !c.recheckDue || !!initial?.[list].includes(c.memberId);
  const hiringOptions = data.colleagues.filter((c) => c.role !== "interviewer").filter(listed("hiring"));
  const interviewerOptions = data.colleagues.filter(listed("interviewers"));
  const recheckHint = (c: ColleagueView) => c.recheckDue && <span className="text-[0.8rem] text-muted">Work email re-check due</span>;
  const reqSelect = `${ids}-req`;
  const niceSelect = `${ids}-nice`;
  const certSelect = `${ids}-cert`;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-[18px]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto min-w-0">
          <span className={monoLabel}>Jobs · {isNew ? "new" : "edit"}</span>
          <h1 className="mt-1 text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">{isNew ? "Post a job" : "Edit job"}</h1>
          <p className="mt-1.5 max-w-[620px] text-[0.92rem] text-muted">Start from a role profile, so candidates see how they match it in plain words.</p>
        </div>
        {!isNew && <JobStatusBadge status={values.status} />}
        <Link href="/corporate#jobs" className={actionBtn}>
          <ArrowLeft {...ICON} />
          Back to Corporate
        </Link>
      </div>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>

      <div className="grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_340px]">
        <form
          noValidate
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <fieldset disabled={closed} className="flex min-w-0 flex-col gap-4">
            <legend className="sr-only">{isNew ? "New job" : "Job"}</legend>
            {closed && (
              <p role="note" className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.88rem]">
                This job is closed, so it can&apos;t change. Post a new one instead.
              </p>
            )}

            <Section id={`${ids}-role`} title="Role">
              <div className="grid gap-3 min-[620px]:grid-cols-2">
                <label className={labelClass}>
                  Role profile
                  <select value={values.roleSlug} onChange={(e) => pickRole(e.target.value)} className={`${fieldClass} min-h-11`} aria-describedby={`${ids}-role-hint`}>
                    {data.roles.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                  <span id={`${ids}-role-hint`} className={hintClass}>
                    Fills in the skills. You can change them below.
                  </span>
                </label>
                <label className={labelClass}>
                  Job title as you post it
                  <input value={values.title} maxLength={120} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} className={`${fieldClass} min-h-11`} />
                </label>
              </div>
            </Section>

            <Section id={`${ids}-skills`} title="Skills" hint="From our skill list only. Candidates see how they match these, in words.">
              <div className="flex flex-col gap-2.5 rounded-[12px] border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[0.88rem] font-semibold">Required</b>
                  <span className={`ml-auto ${monoLabel}`}>
                    {req.required.length} of {JOB_REQUIRED_MAX} at most
                  </span>
                </div>
                <SkillChips ids={req.required} name={name} from="Required" onRemove={(s) => remove("required", s, reqSelect)} />
                <SkillAdder
                  id={reqSelect}
                  label="Add a required skill"
                  button="Add"
                  skills={data.skills}
                  used={used}
                  disabled={req.required.length >= JOB_REQUIRED_MAX}
                  onAdd={(s) => add("required", s)}
                />
              </div>

              <div className="flex flex-col gap-2.5 rounded-[12px] border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[0.88rem] font-semibold">One of these</b>
                  <span className={`ml-auto ${monoLabel}`}>any one counts</span>
                </div>
                {req.oneOf.map((g, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-[10px] bg-surface-2 p-2.5">
                    <span className="text-[0.8rem] text-muted">Group {i + 1}: any one of</span>
                    <SkillChips ids={g} name={name} from={`group ${i + 1}`} onRemove={(s) => setGroup(i, g.filter((x) => x !== s), `${name(s)} removed.`)} />
                    {g.length < 2 && <span className={hintClass}>Add one more skill to this group, or remove it.</span>}
                    <SkillAdder
                      id={`${ids}-group-${i}`}
                      label={`Add a skill to group ${i + 1}`}
                      button="Add"
                      skills={data.skills}
                      used={used}
                      disabled={g.length >= JOB_ONE_OF_SIZE_MAX}
                      onAdd={(s) => setGroup(i, [...g, s], `${name(s)} added to group ${i + 1}.`)}
                    />
                  </div>
                ))}
                <SkillAdder
                  id={`${ids}-newgroup`}
                  label="Start a new group with a skill"
                  button="New group"
                  skills={data.skills}
                  used={used}
                  disabled={req.oneOf.length >= JOB_ONE_OF_GROUPS_MAX}
                  onAdd={(s) => setReq({ ...req, oneOf: [...req.oneOf, [s]] }, `New group with ${name(s)}. Add at least one more skill to it.`)}
                />
              </div>

              <div className="flex flex-col gap-2.5 rounded-[12px] border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[0.88rem] font-semibold">Nice to have</b>
                  <span className={`ml-auto ${monoLabel}`}>never blocks</span>
                </div>
                <SkillChips ids={req.nice} name={name} from="Nice to have" onRemove={(s) => remove("nice", s, niceSelect)} />
                <SkillAdder
                  id={niceSelect}
                  label="Add a nice-to-have skill"
                  button="Add"
                  skills={data.skills}
                  used={used}
                  disabled={req.nice.length >= JOB_NICE_MAX}
                  onAdd={(s) => add("nice", s)}
                />
              </div>
            </Section>

            <Section
              id={`${ids}-express`}
              title="Express apply criteria"
              hint="Optional. Candidates see each one as met or not yet, from proof accepted on CareerMetro. Not met never stops anyone applying."
            >
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-[0.88rem] font-semibold">Proof of required skills</legend>
                {req.required.length === 0 ? (
                  <p className="text-[0.84rem] text-muted">Add required skills above to ask for proof of them.</p>
                ) : (
                  req.required.map((s) => (
                    <label key={s} className="flex min-h-11 items-center gap-2.5 text-[0.88rem]">
                      <input type="checkbox" className="size-[18px] accent-ink" checked={crit.verifiedSkills.includes(s)} onChange={(e) => toggleProof(s, e.target.checked)} />
                      {name(s)}
                    </label>
                  ))
                )}
              </fieldset>
              <div className="flex flex-col gap-2.5 rounded-[12px] border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[0.88rem] font-semibold">Certificates</b>
                  <span className={`ml-auto ${monoLabel}`}>
                    {crit.certificates.length} of {JOB_CRITERIA_CERTIFICATES_MAX} at most
                  </span>
                </div>
                <SkillChips
                  ids={crit.certificates}
                  name={certName}
                  from="Express apply criteria"
                  onRemove={(c) => {
                    setCertificates(
                      crit.certificates.filter((x) => x !== c),
                      `${certName(c)} removed.`,
                    );
                    document.getElementById(certSelect)?.focus();
                  }}
                />
                <CertificateAdder
                  id={certSelect}
                  certificates={data.certificates}
                  used={new Set(crit.certificates)}
                  full={crit.certificates.length >= JOB_CRITERIA_CERTIFICATES_MAX}
                  onAdd={(c) => setCertificates([...crit.certificates, c], `${certName(c)} added to Express apply criteria.`)}
                />
              </div>
            </Section>

            <Section id={`${ids}-where`} title="Where and how">
              <div role="group" aria-labelledby={`${ids}-type`} className="flex flex-col gap-1.5">
                <span id={`${ids}-type`} className="text-[0.82rem] font-semibold">
                  Work type
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {JOB_WORK_TYPES.map((t: JobWorkType) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={values.workType === t}
                      onClick={() => setValues((v) => ({ ...v, workType: t }))}
                      className="min-h-11 rounded-full border border-line px-4 text-[0.86rem] font-medium text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink"
                    >
                      {JOB_WORK_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <label className={`${labelClass} max-w-[320px]`}>
                City
                <input
                  value={values.city}
                  maxLength={60}
                  list={`${ids}-cities`}
                  onChange={(e) => setValues((v) => ({ ...v, city: e.target.value }))}
                  className={`${fieldClass} min-h-11`}
                />
                <span className={hintClass}>Or Remote.</span>
              </label>
              <datalist id={`${ids}-cities`}>
                {CITIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Section>

            <Section id={`${ids}-team`} title="Stages and team" hint="Candidates see the same stages on their Arrivals page.">
              <ol className="flex flex-col gap-1.5">
                {STAGES.map((s, i) => (
                  <li key={s} className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-line px-3 py-2 text-[0.88rem]">
                    <span className={`${monoLabel} min-w-5`}>{i + 1}</span>
                    <span className={i === 2 ? "text-muted line-through" : undefined}>{s}</span>
                    {i === 2 && <span className="ml-auto text-[0.8rem] text-muted">Off. It can turn on once the AI interviewer exists.</span>}
                  </li>
                ))}
              </ol>
              {data.colleagues.length === 0 ? (
                <p className="text-[0.86rem] text-muted">You&apos;re the job&apos;s owner. Add colleagues in Team and access to put them on its team.</p>
              ) : (
                <div className="grid gap-4 min-[620px]:grid-cols-2">
                  <fieldset className="flex flex-col">
                    <legend className="mb-1 text-[0.82rem] font-semibold">Hiring HR</legend>
                    {hiringOptions.length === 0 && <p className="text-[0.84rem] text-muted">Nobody else is a Recruiter admin or Hiring HR yet.</p>}
                    {hiringOptions.map((c) => (
                      <label key={c.memberId} className="flex min-h-11 items-center gap-2.5 text-[0.88rem]">
                        <input type="checkbox" className="size-[18px] accent-ink" checked={values.hiring.includes(c.memberId)} onChange={(e) => toggleTeam("hiring", c.memberId, e.target.checked)} />
                        {c.name}
                        <span className="text-[0.8rem] text-muted">{ORG_ROLE_LABELS[c.role]}</span>
                        {recheckHint(c)}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className="flex flex-col">
                    <legend className="mb-1 text-[0.82rem] font-semibold">Interviewers</legend>
                    {interviewerOptions.map((c) => (
                      <label key={c.memberId} className="flex min-h-11 items-center gap-2.5 text-[0.88rem]">
                        <input
                          type="checkbox"
                          className="size-[18px] accent-ink"
                          checked={values.interviewers.includes(c.memberId)}
                          onChange={(e) => toggleTeam("interviewers", c.memberId, e.target.checked)}
                        />
                        {c.name}
                        <span className="text-[0.8rem] text-muted">{ORG_ROLE_LABELS[c.role]}</span>
                        {recheckHint(c)}
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}
            </Section>

            <Section id={`${ids}-send`} title={canOpenHere ? "Before you open it" : "Save"}>
              {canOpenHere && (
                <fieldset className="flex flex-col">
                  <legend className="sr-only">Three checks before the job opens</legend>
                  {JOB_HONESTY_CHECKS.map((c) => (
                    <label key={c.key} className="grid min-h-11 grid-cols-[20px_minmax(0,1fr)] items-start gap-2.5 py-1.5 text-[0.88rem]">
                      <input type="checkbox" className="mt-0.5 size-[18px] accent-ink" checked={ticks[c.key]} onChange={(e) => setTicks((t) => ({ ...t, [c.key]: e.target.checked }))} />
                      <span>{c.text}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <p className="flex items-start gap-2.5 rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]">
                <ShieldCheck {...ICON} className="mt-0.5 shrink-0" />
                <span>Only verified companies&apos; jobs reach candidates. Anyone can report a job, and reports are looked at within 24 hours.</span>
              </p>
              {error && (
                <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-md border border-line bg-surface-2 px-3.5 py-2.5 text-[0.88rem] font-medium text-ink">
                  {error}
                </p>
              )}
              {!closed && (
                <div className="flex flex-wrap items-center gap-2">
                  {canOpenHere && (
                    <button type="button" className={inkBtn} disabled={pending || !!whyNot} aria-describedby={whyNot ? `${ids}-why` : undefined} onClick={() => save(true)}>
                      Open job
                    </button>
                  )}
                  <button type="submit" className={actionBtn} disabled={pending}>
                    {canOpenHere ? "Save draft" : "Save changes"}
                  </button>
                  {canOpenHere && whyNot && (
                    <span id={`${ids}-why`} className="text-[0.84rem] text-muted">
                      {whyNot}
                    </span>
                  )}
                </div>
              )}
              {values.status === "paused" && <p className="text-[0.84rem] text-muted">It stays paused. Open it again from the Jobs list.</p>}
              {values.status === "open" && <p className="text-[0.84rem] text-muted">It stays open, with your changes.</p>}
            </Section>
          </fieldset>
        </form>

        <aside aria-labelledby={`${ids}-pv`} className="flex min-w-0 flex-col gap-3 min-[900px]:sticky min-[900px]:top-4">
          <h2 id={`${ids}-pv`} className={monoLabel}>
            How candidates see it on Departures
          </h2>
          <PostedJobCard job={preview} />
          <p className="text-[0.82rem] text-muted">
            Only once it is open{data.companyVerified ? "" : " and your company is verified"}. Drafts and paused jobs are seen by your team only.
          </p>
        </aside>
      </div>
    </div>
  );
}
