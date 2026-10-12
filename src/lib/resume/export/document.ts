import type { HeldCertification, Profile, ResumeDocument, ResumeFormat, ResumeSection } from "@/lib/schemas";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2022-06" reads "Jun 2022"; a bare year stays as it is. */
function formatYearMonth(value: string): string {
  const [year, month] = value.split("-");
  return month ? `${MONTHS[Number(month) - 1]} ${year}` : year;
}

/** A role's dates as people write them. A start with no end is a current role. */
export function formatRange(start: string | null, end: string | null): string {
  if (start && end) return `${formatYearMonth(start)} – ${formatYearMonth(end)}`;
  if (start) return `${formatYearMonth(start)} – Present`;
  return end ? formatYearMonth(end) : "";
}

/** Whether an expiry date ("YYYY" counts as the end of that year) is before this month. */
function hasExpired(expires: string, now: Date): boolean {
  const [year, month = "12"] = expires.split("-");
  return Number(year) * 12 + Number(month) < now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
}

function certificationLine(cert: HeldCertification, now: Date): string {
  const parts: string[] = [];
  if (cert.earned) parts.push(formatYearMonth(cert.earned));
  if (cert.expires && cert.expires !== "none") {
    parts.push(hasExpired(cert.expires, now) ? `expired ${formatYearMonth(cert.expires)}` : `valid until ${formatYearMonth(cert.expires)}`);
  }
  return parts.length ? `${cert.name.trim()} (${parts.join("; ")})` : cert.name.trim();
}

const clean = (text: string | null | undefined): string => text?.trim().replace(/\s+/g, " ") ?? "";

/**
 * FR-20: the resume to download, from the profile the person confirmed and nothing else. No model writes or
 * rewords any of it. `name` is the account's name; someone not signed in has none and adds it themselves.
 */
export function buildResumeDocument(profile: Profile, name: string | null, now = new Date()): ResumeDocument {
  const sections: ResumeSection[] = [];

  // An entry needs a title; when only spaces were given, the employer or institution stands in, else it's left out.
  const titled = <T extends { title: string; subtitle: string }>(e: T): T => (e.title ? e : { ...e, title: e.subtitle, subtitle: "" });
  const experience = profile.roles
    .map((role) =>
      titled({ title: clean(role.title), subtitle: clean(role.employer), dates: formatRange(role.start, role.end), bullets: role.highlights.map(clean).filter(Boolean) }),
    )
    .filter((e) => e.title);
  if (experience.length) sections.push({ kind: "entries", heading: "Experience", entries: experience });

  const seen = new Set<string>();
  const skills = profile.skills.map((skill) => clean(skill.name)).filter((skill) => {
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (skills.length) sections.push({ kind: "list", heading: "Skills", items: skills });

  const education = profile.education
    .map((item) => titled({ title: clean(item.qualification), subtitle: clean(item.institution), dates: clean(item.year), bullets: [] as string[] }))
    .filter((e) => e.title);
  if (education.length) sections.push({ kind: "entries", heading: "Education", entries: education });

  const certifications = profile.certifications.filter((cert) => clean(cert.name)).map((cert) => certificationLine(cert, now));
  if (certifications.length) sections.push({ kind: "list", heading: "Certifications", items: certifications });

  return { name: clean(name) || null, headline: clean(profile.headline) || null, sections };
}

/** "priya-sharma-resume.pdf", or "resume.pdf" when the name has no plain letters to use. */
export function resumeFileName(name: string | null, format: ResumeFormat): string {
  const slug = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug ? `${slug}-` : ""}resume.${format}`;
}
