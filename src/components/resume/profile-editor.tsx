"use client";

import { Check, ChevronDown, Plus, Quote, X } from "lucide-react";
import { useId, useState } from "react";
import { ResumeDownload } from "@/components/resume/resume-download";
import { Button, ButtonLink } from "@/components/ui/button";
import { readApiReply } from "@/lib/api-reply";
import type { Profile } from "@/lib/schemas";
import {
  ME_EDUCATION_TEXT_MAX,
  ME_EDUCATION_YEAR_MAX,
  PROFILE_CERTIFICATION_NAME_MAX,
  PROFILE_SKILL_NAME_MAX,
  PROFILE_SKILLS_MAX,
  PROFILE_TEXT_MAX,
} from "@/lib/schemas/constants";

const field = "w-full min-w-0 rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink";
const label = "flex min-w-0 flex-col gap-1 text-xs font-medium text-muted";

const DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

/** What would stop the profile saving, in words the user can act on. Empty means it can be saved. */
export function profileProblems(p: Profile, now = new Date()): string[] {
  const problems: string[] = [];
  p.roles.forEach((r, i) => {
    const name = r.title.trim() || r.employer.trim() || `Job ${i + 1}`;
    if (!r.title.trim() || !r.employer.trim()) problems.push(`${name}: add both a title and an employer, or remove it.`);
    for (const d of [r.start, r.end]) if (d && !DATE.test(d)) problems.push(`${name}: write "${d}" as YYYY or YYYY-MM, like 2022-06.`);
  });
  p.education.forEach((e, i) => {
    if (!e.qualification.trim() || !e.institution.trim()) {
      problems.push(`${e.qualification.trim() || e.institution.trim() || `Education ${i + 1}`}: add both a qualification and an institution, or remove it.`);
    }
  });
  p.certifications.forEach((c, i) => {
    const name = c.name.trim() || `Certification ${i + 1}`;
    const dates = [c.earned, c.expires === "none" ? null : c.expires];
    if (!c.name.trim() && dates.some(Boolean)) problems.push(`${name}: add its name, or remove it.`);
    for (const d of dates) if (d && !DATE.test(d)) problems.push(`${name}: write "${d}" as YYYY or YYYY-MM, like 2024-03.`);
    // A bare year is read generously: passed in its January, expiring in its December.
    const [from, to] = [c.earned && `${c.earned}-01`.slice(0, 7), c.expires !== "none" && c.expires && `${c.expires}-12`.slice(0, 7)];
    if (from && to && dates.every((d) => DATE.test(d!)) && to < from) problems.push(`${name}: it can't expire before it was passed.`);
    const thisMonth = now.toISOString().slice(0, 7);
    if (from && DATE.test(c.earned!) && from > thisMonth) problems.push(`${name}: the pass date is in the future. Add it once you've passed.`);
  });
  return problems;
}

type State = { kind: "editing" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

function RemoveButton({ onClick, what }: { onClick: () => void; what: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Remove ${what}`} className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
      <X size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/** The editor's sections, in order. One is open at a time (C23); the others show their heading and a one-line summary. */
export const EDITOR_SECTIONS = ["about", "work", "skills", "education", "certifications"] as const;
export type EditorSection = (typeof EDITOR_SECTIONS)[number];

const count = (n: number, one: string, many: string) => (n === 0 ? `No ${many} yet` : `${n} ${n === 1 ? one : many}`);

/** The one-line summary a folded section shows ("3 roles", "2 degrees"), from the profile as edited so far. */
export function sectionSummary(section: EditorSection, p: Profile, yearsText: string): string {
  switch (section) {
    case "about": {
      const years = yearsText.trim() ? `${yearsText.trim()} ${yearsText.trim() === "1" ? "year" : "years"}` : null;
      return [p.headline?.trim() || "No headline yet", years].filter(Boolean).join(" · ");
    }
    case "work":
      return count(p.roles.length, "role", "roles");
    case "skills":
      return count(p.skills.filter((x) => x.name.trim()).length, "skill", "skills");
    case "education":
      return count(p.education.length, "degree", "degrees");
    case "certifications":
      return count(p.certifications.filter((c) => c.name.trim()).length, "certification", "certifications");
  }
}

/**
 * The first section holding something that stops the save, so it can be opened with the message: the years box, then
 * the roles, education and certifications in the order profileProblems reads them. Null when only the message helps.
 */
export function sectionWithProblem(p: Profile, yearsBad: boolean): EditorSection | null {
  if (yearsBad) return "about";
  const only = (keep: "roles" | "education" | "certifications"): Profile => ({
    ...p,
    roles: keep === "roles" ? p.roles : [],
    education: keep === "education" ? p.education : [],
    certifications: keep === "certifications" ? p.certifications : [],
  });
  if (profileProblems(only("roles")).length) return "work";
  if (profileProblems(only("education")).length) return "education";
  if (profileProblems(only("certifications")).length) return "certifications";
  return null;
}

/**
 * One folded section (C23, handoff section 11): the heading is a button that opens or closes it, with aria-expanded,
 * and keeps focus when pressed. Closed, it shows the summary line under the heading and none of its fields.
 */
function Section({
  title,
  hint,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const body = useId();
  return (
    <section className="flex flex-col gap-3 border-b border-line pb-4">
      <h2 className="text-xl font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={body}
          onClick={onToggle}
          className="flex min-h-11 w-full min-w-0 items-center gap-3 text-left hover:text-ink"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span>{title}</span>
            {!open && <span className="truncate text-sm font-normal text-muted">{summary}</span>}
          </span>
          <ChevronDown size={20} strokeWidth={1.75} aria-hidden="true" className={`shrink-0 text-muted ${open ? "rotate-180" : ""}`} />
        </button>
      </h2>
      {open && (
        <div id={body} className="flex flex-col gap-3">
          {hint && <p className="text-sm text-muted">{hint}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

/** FR-6: the parsed profile, editable, confirmed by the user before any analysis. */
/**
 * `demo` skips the network call, for the /design page. `download` (only while the resume isn't confirmed yet, since the
 * page shows the download itself once it is) offers the FR-20 download as soon as "Looks right" saves.
 */
export function ProfileEditor({
  resumeId,
  initial,
  demo = false,
  download,
}: {
  resumeId: string;
  initial: Profile;
  demo?: boolean;
  download?: { named: boolean };
}) {
  const [profile, setProfile] = useState<Profile>(initial);
  const [newSkill, setNewSkill] = useState("");
  const [state, setState] = useState<State>({ kind: "editing" });
  // Kept as typed, so "2." can become "2.5"; converted to a number on save.
  const [yearsText, setYearsText] = useState(initial.totalYearsExperience?.toString() ?? "");
  // One section open at a time (C23): a full resume as fields ran past 35,000 px on a phone.
  const [openSection, setOpenSection] = useState<EditorSection | null>("about");
  const fold = (section: EditorSection) => ({
    open: openSection === section,
    summary: sectionSummary(section, profile, yearsText),
    onToggle: () => setOpenSection((o) => (o === section ? null : section)),
  });

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    if (state.kind !== "editing" && state.kind !== "saving") setState({ kind: "editing" });
  };
  const update = <K extends "roles" | "skills" | "education" | "certifications">(key: K, i: number, patch: Partial<Profile[K][number]>) =>
    set(key, profile[key].map((item, j) => (j === i ? { ...item, ...patch } : item)) as Profile[K]);
  const remove = <K extends "roles" | "skills" | "education" | "certifications">(key: K, i: number) =>
    set(key, profile[key].filter((_, j) => j !== i) as Profile[K]);

  async function save() {
    const years = Number(yearsText);
    if (yearsText.trim() && (Number.isNaN(years) || years < 0)) {
      setOpenSection("about");
      setState({ kind: "error", message: "Years of experience should be a number, like 3 or 2.5." });
      return;
    }
    const problems = profileProblems(profile);
    if (problems.length) {
      // The section to fix opens with the message, so its fields are on screen.
      setOpenSection((o) => sectionWithProblem(profile, false) ?? o);
      setState({ kind: "error", message: problems.join(" ") });
      return;
    }
    setState({ kind: "saving" });
    const cleaned: Profile = {
      ...profile,
      headline: profile.headline?.trim() || null,
      totalYearsExperience: yearsText.trim() ? years : null,
      // Blank skill and certification rows hold nothing to lose.
      skills: profile.skills.filter((s) => s.name.trim()),
      certifications: profile.certifications.map((c) => ({ ...c, name: c.name.trim() })).filter((c) => c.name),
    };
    const error = demo ? null : await putProfile(resumeId, cleaned);
    setState(error ? { kind: "error", message: error } : { kind: "saved" });
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Locked while saving, so an edit can't slip in after the snapshot is sent. */}
      <fieldset disabled={state.kind === "saving"} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <Section title="About you" {...fold("about")}>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <label className={label}>
              Headline
              <input className={field} maxLength={PROFILE_TEXT_MAX} value={profile.headline ?? ""} onChange={(e) => set("headline", e.target.value)} placeholder="Data Analyst" />
            </label>
            <label className={label}>
              Years of experience
              <input
                className={field}
                inputMode="decimal"
                value={yearsText}
                onChange={(e) => {
                  setYearsText(e.target.value);
                  if (state.kind === "error" || state.kind === "saved") setState({ kind: "editing" });
                }}
              />
            </label>
          </div>
        </Section>

        <Section title="Work" hint="Dates as YYYY-MM or YYYY. Leave the end empty for your current job." {...fold("work")}>
          {profile.roles.length === 0 && <p className="text-sm text-muted">We didn&apos;t find any jobs.</p>}
          <ul className="flex flex-col gap-3">
            {profile.roles.map((r, i) => (
              <li key={i} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                <div className="flex items-start gap-2">
                  <div className="grid flex-1 gap-3 sm:grid-cols-2">
                    <label className={label}>
                      Title
                      <input className={field} maxLength={PROFILE_TEXT_MAX} value={r.title} onChange={(e) => update("roles", i, { title: e.target.value })} />
                    </label>
                    <label className={label}>
                      Employer
                      <input className={field} maxLength={PROFILE_TEXT_MAX} value={r.employer} onChange={(e) => update("roles", i, { employer: e.target.value })} />
                    </label>
                    <label className={label}>
                      Start
                      <input className={field} value={r.start ?? ""} onChange={(e) => update("roles", i, { start: e.target.value.trim() || null })} />
                    </label>
                    <label className={label}>
                      End
                      <input className={field} value={r.end ?? ""} placeholder="Present" onChange={(e) => update("roles", i, { end: e.target.value.trim() || null })} />
                    </label>
                  </div>
                  <RemoveButton what={`${r.title} at ${r.employer}`} onClick={() => remove("roles", i)} />
                </div>
                {r.highlights.length > 0 && (
                  <ul className="flex min-w-0 list-disc flex-col gap-1 pl-5 text-sm text-muted [overflow-wrap:anywhere]">
                    {r.highlights.map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Skills" hint="Each skill shows the line of your resume it came from. Remove anything that isn't right." {...fold("skills")}>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {profile.skills.map((s, i) => (
              <li key={i} className="flex items-start gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input aria-label={`Skill name${s.name ? `, ${s.name}` : ""}`} className={`${field} max-w-xs font-medium`} maxLength={PROFILE_SKILL_NAME_MAX} value={s.name} onChange={(e) => update("skills", i, { name: e.target.value })} />
                  {s.evidence[0] ? (
                    <p className="flex items-start gap-1.5 text-sm text-muted">
                      <Quote size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{s.evidence[0]}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted">Listed on your resume, with no example.</p>
                  )}
                </div>
                <RemoveButton what={s.name} onClick={() => remove("skills", i)} />
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newSkill.trim();
              if (!name || profile.skills.length >= PROFILE_SKILLS_MAX) return;
              set("skills", [...profile.skills, { name, lastUsed: null, evidence: [] }]);
              setNewSkill("");
            }}
          >
            <input aria-label="Add a skill" className={`${field} max-w-xs`} maxLength={PROFILE_SKILL_NAME_MAX} value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="Add a skill we missed" />
            <Button type="submit" variant="ghost">
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              Add
            </Button>
          </form>
        </Section>

        <Section title="Education" {...fold("education")}>
          {profile.education.length === 0 && <p className="text-sm text-muted">We didn&apos;t find any education.</p>}
          <ul className="flex flex-col gap-3">
            {profile.education.map((e, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-line bg-surface p-4">
                <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_1fr_100px]">
                  <label className={label}>
                    Qualification
                    <input className={field} maxLength={ME_EDUCATION_TEXT_MAX} value={e.qualification} onChange={(ev) => update("education", i, { qualification: ev.target.value })} />
                  </label>
                  <label className={label}>
                    Institution
                    <input className={field} maxLength={ME_EDUCATION_TEXT_MAX} value={e.institution} onChange={(ev) => update("education", i, { institution: ev.target.value })} />
                  </label>
                  <label className={label}>
                    Year
                    <input className={field} maxLength={ME_EDUCATION_YEAR_MAX} value={e.year ?? ""} onChange={(ev) => update("education", i, { year: ev.target.value.trim() || null })} />
                  </label>
                </div>
                <RemoveButton what={e.qualification} onClick={() => remove("education", i)} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Certifications" hint="Add when you passed each one and when it expires. Tick “Doesn’t expire” if it never does." {...fold("certifications")}>
          {profile.certifications.length === 0 && <p className="text-sm text-muted">We didn&apos;t find any certifications.</p>}
          <ul className="flex flex-col gap-3">
            {profile.certifications.map((c, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-line bg-surface p-4">
                <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_110px_110px]">
                  <label className={label}>
                    Certification
                    <input className={field} maxLength={PROFILE_CERTIFICATION_NAME_MAX} value={c.name} onChange={(e) => update("certifications", i, { name: e.target.value })} />
                  </label>
                  <label className={label}>
                    Passed
                    <input className={field} value={c.earned ?? ""} placeholder="YYYY-MM" onChange={(e) => update("certifications", i, { earned: e.target.value.trim() || null })} />
                  </label>
                  <label className={label}>
                    Expires
                    <input
                      className={field}
                      value={c.expires === "none" ? "" : (c.expires ?? "")}
                      placeholder={c.expires === "none" ? "Never" : "YYYY-MM"}
                      disabled={c.expires === "none"}
                      onChange={(e) => update("certifications", i, { expires: e.target.value.trim() || null })}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted sm:col-start-3">
                    <input
                      type="checkbox"
                      checked={c.expires === "none"}
                      onChange={(e) => update("certifications", i, { expires: e.target.checked ? "none" : null })}
                      className="accent-[var(--ink)]"
                    />
                    Doesn&apos;t expire
                  </label>
                </div>
                <RemoveButton what={c.name || "this certification"} onClick={() => remove("certifications", i)} />
              </li>
            ))}
          </ul>
        </Section>
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        {state.kind === "error" && (
          <p role="alert" className="text-sm text-bad">
            {state.message}
          </p>
        )}
        {state.kind === "saved" ? (
          <>
            <div role="status" className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
              <p className="flex items-center gap-2 font-semibold">
                <Check size={18} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
                Saved
              </p>
              <p className="text-sm text-muted">Next, pick the role you&apos;re aiming for and see your gaps.</p>
              {!demo && (
                <ButtonLink href={`/resume/${resumeId}/role`} className="mt-2 self-start">
                  Pick a role
                </ButtonLink>
              )}
            </div>
            {download && !demo && <ResumeDownload resumeId={resumeId} named={download.named} />}
          </>
        ) : (
          <Button type="button" onClick={save} disabled={state.kind === "saving"} className="self-start">
            {state.kind === "saving" ? "Saving…" : "Looks right"}
          </Button>
        )}
      </div>
    </div>
  );
}

async function putProfile(resumeId: string, profile: Profile): Promise<string | null> {
  try {
    const res = await fetch(`/api/resume/${resumeId}/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    const data = await readApiReply(res);
    return data.ok ? null : (data.error ?? "Something went wrong. Please try again.");
  } catch {
    return "We couldn't reach the server. Check your connection and try again.";
  }
}
