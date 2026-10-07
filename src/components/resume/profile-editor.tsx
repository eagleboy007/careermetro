"use client";

import { Check, Plus, Quote, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { readApiReply } from "@/lib/api-reply";
import type { Profile } from "@/lib/schemas";

const field = "w-full min-w-0 rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink";
const label = "flex min-w-0 flex-col gap-1 text-xs font-medium text-muted";

const DATE = /^\d{4}(-\d{2})?$/;

/** What would stop the profile saving, in words the user can act on. Empty means it can be saved. */
export function profileProblems(p: Profile): string[] {
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

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-xl font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** FR-6: the parsed profile, editable, confirmed by the user before any analysis. */
/** `demo` skips the network call, for the /design page. */
export function ProfileEditor({ resumeId, initial, demo = false }: { resumeId: string; initial: Profile; demo?: boolean }) {
  const [profile, setProfile] = useState<Profile>(initial);
  const [newSkill, setNewSkill] = useState("");
  const [state, setState] = useState<State>({ kind: "editing" });
  // Kept as typed, so "2." can become "2.5"; converted to a number on save.
  const [yearsText, setYearsText] = useState(initial.totalYearsExperience?.toString() ?? "");

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    if (state.kind !== "editing" && state.kind !== "saving") setState({ kind: "editing" });
  };
  const update = <K extends "roles" | "skills" | "education">(key: K, i: number, patch: Partial<Profile[K][number]>) =>
    set(key, profile[key].map((item, j) => (j === i ? { ...item, ...patch } : item)) as Profile[K]);
  const remove = <K extends "roles" | "skills" | "education" | "certifications">(key: K, i: number) =>
    set(key, profile[key].filter((_, j) => j !== i) as Profile[K]);

  async function save() {
    const years = Number(yearsText);
    if (yearsText.trim() && (Number.isNaN(years) || years < 0)) {
      setState({ kind: "error", message: "Years of experience should be a number, like 3 or 2.5." });
      return;
    }
    const problems = profileProblems(profile);
    if (problems.length) {
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
      certifications: profile.certifications.map((c) => c.trim()).filter(Boolean),
    };
    const error = demo ? null : await putProfile(resumeId, cleaned);
    setState(error ? { kind: "error", message: error } : { kind: "saved" });
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Locked while saving, so an edit can't slip in after the snapshot is sent. */}
      <fieldset disabled={state.kind === "saving"} className="m-0 flex min-w-0 flex-col gap-10 border-0 p-0">
        <Section title="About you">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <label className={label}>
              Headline
              <input className={field} value={profile.headline ?? ""} onChange={(e) => set("headline", e.target.value)} placeholder="Data Analyst" />
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

        <Section title="Work" hint="Dates as YYYY-MM or YYYY. Leave the end empty for your current job.">
          {profile.roles.length === 0 && <p className="text-sm text-muted">We didn&apos;t find any jobs.</p>}
          <ul className="flex flex-col gap-3">
            {profile.roles.map((r, i) => (
              <li key={i} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                <div className="flex items-start gap-2">
                  <div className="grid flex-1 gap-3 sm:grid-cols-2">
                    <label className={label}>
                      Title
                      <input className={field} value={r.title} onChange={(e) => update("roles", i, { title: e.target.value })} />
                    </label>
                    <label className={label}>
                      Employer
                      <input className={field} value={r.employer} onChange={(e) => update("roles", i, { employer: e.target.value })} />
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
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
                    {r.highlights.map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Skills" hint="Each skill shows the line of your resume it came from. Remove anything that isn't right.">
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {profile.skills.map((s, i) => (
              <li key={i} className="flex items-start gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input aria-label={`Skill name${s.name ? `, ${s.name}` : ""}`} className={`${field} max-w-xs font-medium`} value={s.name} onChange={(e) => update("skills", i, { name: e.target.value })} />
                  {s.evidence[0] ? (
                    <p className="flex items-start gap-1.5 text-sm text-muted">
                      <Quote size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-words">{s.evidence[0]}</span>
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
              if (!name) return;
              set("skills", [...profile.skills, { name, lastUsed: null, evidence: [] }]);
              setNewSkill("");
            }}
          >
            <input aria-label="Add a skill" className={`${field} max-w-xs`} value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="Add a skill we missed" />
            <Button type="submit" variant="ghost">
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              Add
            </Button>
          </form>
        </Section>

        <Section title="Education">
          {profile.education.length === 0 && <p className="text-sm text-muted">We didn&apos;t find any education.</p>}
          <ul className="flex flex-col gap-3">
            {profile.education.map((e, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-line bg-surface p-4">
                <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_1fr_100px]">
                  <label className={label}>
                    Qualification
                    <input className={field} value={e.qualification} onChange={(ev) => update("education", i, { qualification: ev.target.value })} />
                  </label>
                  <label className={label}>
                    Institution
                    <input className={field} value={e.institution} onChange={(ev) => update("education", i, { institution: ev.target.value })} />
                  </label>
                  <label className={label}>
                    Year
                    <input className={field} value={e.year ?? ""} onChange={(ev) => update("education", i, { year: ev.target.value.trim() || null })} />
                  </label>
                </div>
                <RemoveButton what={e.qualification} onClick={() => remove("education", i)} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Certifications">
          {profile.certifications.length === 0 && <p className="text-sm text-muted">We didn&apos;t find any certifications.</p>}
          <ul className="flex flex-col gap-2">
            {profile.certifications.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  aria-label={`Certification${c ? `, ${c}` : ""}`}
                  className={field}
                  value={c}
                  onChange={(e) => set("certifications", profile.certifications.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <RemoveButton what={c} onClick={() => remove("certifications", i)} />
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
          <div role="status" className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
            <p className="flex items-center gap-2 font-semibold">
              <Check size={18} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
              Saved
            </p>
            <p className="text-sm text-muted">
              Next you&apos;ll pick a role and see your gaps. That step is being built now. Meanwhile, see{" "}
              <Link href="/roles" className="underline underline-offset-2 hover:text-ink">
                what each role asks for
              </Link>
              .
            </p>
          </div>
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
