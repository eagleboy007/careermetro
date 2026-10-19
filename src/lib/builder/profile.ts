import type { BuilderAnswers, Profile } from "@/lib/schemas";
import { verifyProfile } from "@/lib/resume/verify";
import { lineSupported, ownLines } from "./verify-lines";

/*
 * Answers to a profile with no model (FR-36, plan section 3 step 1). Every fact comes from what the person typed or
 * picked; the model's reworded lines only replace the person's own sentences after `lineSupported` passes them.
 */

/** Resume lines per free-text answer id ("p:<row>", "j:<row>"), already checked. */
export type BuilderLines = Record<string, string[]>;

/** The answer text behind each free-text id. */
export function freeAnswers(a: BuilderAnswers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of a.projects) if (p.did) out[`p:${p.id}`] = p.did;
  if (a.worked) for (const j of a.jobs) if (j.did) out[`j:${j.id}`] = j.did;
  return out;
}

/**
 * Keeps the model's lines that pass the check, answer by answer, and falls back to the person's own sentences for an
 * answer with none left. Returns the lines and how many model lines were dropped (a count, never the text).
 */
export function checkedLines(a: BuilderAnswers, model: { answerId: string; lines: string[] }[] | null): { lines: BuilderLines; dropped: number } {
  const answers = freeAnswers(a);
  const lines: BuilderLines = {};
  let dropped = 0;
  for (const [id, text] of Object.entries(answers)) {
    const offered = model?.find((m) => m.answerId === id)?.lines ?? [];
    const kept = offered.filter((l) => lineSupported(l, text, a.tools));
    dropped += offered.length - kept.length;
    lines[id] = kept.length ? kept : ownLines(text);
  }
  return { lines, dropped };
}

const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
};

/** Today's month in India, for a job that runs to "Now". */
export const indiaMonth = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);

/** Full years of work: jobs and freelance only, never internships, volunteering or projects; rounded down. */
export function yearsOfWork(a: BuilderAnswers, now: Date): number | null {
  if (!a.worked) return a.worked === false ? 0 : null;
  const months = a.jobs
    .filter((j) => (j.kind === "job" || j.kind === "freelance") && j.from && j.to)
    .reduce((sum, j) => sum + monthsBetween(j.from, j.to === "now" ? indiaMonth(now) : j.to), 0);
  return Math.floor(months / 12);
}

const employerOf = (j: BuilderAnswers["jobs"][number]) => j.company || (j.kind === "freelance" ? "Freelance" : j.kind === "volunteer" ? "Volunteer" : j.company);

/** The profile the answers make, with the given lines as highlights. */
export function profileFromAnswers(a: BuilderAnswers, lines: BuilderLines, now: Date): Profile {
  const jobs = a.worked ? a.jobs.filter((j) => j.title && employerOf(j)) : [];
  const names = new Map<string, string>();
  for (const t of a.tools) names.set(t.toLowerCase(), t);
  for (const c of a.noCertificates ? [] : a.certificates) if (c.name && !names.has(c.name.toLowerCase())) names.set(c.name.toLowerCase(), c.name);
  return {
    headline: null,
    totalYearsExperience: yearsOfWork(a, now),
    roles: [
      ...jobs.map((j) => ({
        title: j.kind === "internship" ? `${j.title} (Internship)` : j.title,
        employer: employerOf(j),
        start: j.from || null,
        end: j.to === "now" || !j.to ? null : j.to,
        highlights: lines[`j:${j.id}`] ?? [],
      })),
      ...a.projects.filter((p) => p.name).map((p) => ({ title: p.name, employer: "Project", start: null, end: null, highlights: lines[`p:${p.id}`] ?? [] })),
    ],
    skills: [...names.values()].map((name) => ({ name, lastUsed: null, evidence: [] })),
    education: a.education
      .filter((e) => e.degree && e.college)
      .map((e) => ({ qualification: e.degree, institution: e.college, year: e.end || e.start || null })),
    certifications: (a.noCertificates ? [] : a.certificates).filter((c) => c.name).map((c) => ({ name: c.name, earned: c.earned || null, expires: null })),
  };
}

/**
 * The plain one-column resume text the answers and lines make: what "verifyProfile" checks the profile against (the
 * same AI-5 step as an upload), and the text the matcher and the download read. Contact details aren't in it.
 */
export function builderText(a: BuilderAnswers, lines: BuilderLines): string {
  const out: string[] = [];
  const jobs = a.worked ? a.jobs : [];
  if (jobs.length) out.push("Experience");
  for (const j of jobs) {
    out.push(j.kind === "internship" ? `${j.title} (Internship)` : j.title, employerOf(j), `${j.from} - ${j.to === "now" ? "Now" : j.to}`);
    for (const l of lines[`j:${j.id}`] ?? []) out.push(`- ${l}`);
    out.push("");
  }
  if (a.projects.length) out.push("Projects");
  for (const p of a.projects) {
    out.push(p.name, "Project");
    for (const l of lines[`p:${p.id}`] ?? []) out.push(`- ${l}`);
    out.push("");
  }
  if (a.education.length) out.push("Education");
  for (const e of a.education) out.push(e.degree, e.college, [e.start, e.end].filter(Boolean).join(" - "), "");
  if (a.tools.length) out.push("Tools", a.tools.join(", "), "");
  const certs = a.noCertificates ? [] : a.certificates;
  if (certs.length) out.push("Certificates");
  for (const c of certs) out.push([c.name, c.issuer, c.earned].filter(Boolean).join(", "));
  return out.join("\n").trim();
}

/** The built profile, through the same AI-5 check as an upload. */
export function buildProfile(a: BuilderAnswers, lines: BuilderLines, now: Date) {
  return verifyProfile(profileFromAnswers(a, lines, now), builderText(a, lines));
}
