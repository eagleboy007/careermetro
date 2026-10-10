import { lifeLine, type LifeLine, type LifeMoment, type Profile } from "@/lib/schemas";
import { decimalYear, monthLabel, readYearMonth } from "./life-layout";

/**
 * The Life line from a confirmed profile, in plain code. Work roles become moments by their start date, education by
 * its year, and the journey starts when the first education ends (or at the first job). Certificates on a resume have
 * no dates, so they wait in `undated` until the person adds one. Interests come with the profile page (build step 9).
 * Anything that can't be placed sensibly (no date, a year before 1950, a date still ahead) waits in `undated` too.
 */
const EARLIEST = 1950;
/** Caps that keep a very long resume inside the schema's 120 moments. */
const MAX_EDUCATION = 20;
const MAX_ROLES = 90;

/** "2019-2023", "2019 – 2023" or "2023" → 2023, the year it ended. Null for "2019 – Present" or no year. */
function educationYear(value: string | null): ReturnType<typeof readYearMonth> {
  if (!value || /present|pursuing|ongoing|current/i.test(value)) return null;
  return readYearMonth(value.match(/\d{4}/g)?.at(-1) ?? null);
}

export function lifeFromProfile(profile: Profile, opts: { joinedAt: Date; now: Date; destination: string }): LifeLine {
  const now = decimalYear(opts.now);
  const moments: LifeMoment[] = [];
  const undated: LifeLine["undated"] = [];

  const education = profile.education
    .map((e, i) => ({ e, i, year: educationYear(e.year) }))
    .filter((x) => {
      if (x.year && x.year.t >= EARLIEST && x.year.t <= now) return true;
      undated.push({ row: "education", name: x.e.qualification });
      return false;
    })
    .sort((a, b) => a.year!.t - b.year!.t)
    .slice(-MAX_EDUCATION);
  for (const { e, i, year } of education) {
    moments.push({
      id: `edu-${i}`,
      row: "education",
      // A year alone sits mid-year, but never past Now.
      t: Math.min(year!.t + 0.45, now),
      date: year!.label,
      name: e.qualification,
      heading: e.qualification,
      detail: e.institution,
      verified: false,
    });
  }

  const roles = profile.roles
    .map((r, i) => ({ r, i, start: readYearMonth(r.start), end: readYearMonth(r.end) }))
    .filter((x) => {
      if (x.start && x.start.t >= EARLIEST && x.start.t <= now) return true;
      undated.push({ row: "work", name: `${x.r.title} · ${x.r.employer}` });
      return false;
    })
    .sort((a, b) => a.start!.t - b.start!.t)
    .slice(-MAX_ROLES);
  roles.forEach(({ r, i, start, end }) => {
    moments.push({
      id: `work-${i}`,
      row: "work",
      t: start!.t,
      date: start!.label,
      name: r.title,
      heading: `${r.title} · ${r.employer}`,
      detail: end ? `${start!.label} to ${end.label}.` : `Since ${start!.label}. Current role.`,
      verified: false,
    });
  });

  for (const name of profile.certifications) if (name.trim()) undated.push({ row: "certificates", name: name.trim() });

  // Working life begins after the last education finished before the first job (a degree, not 10th standard), or at
  // the first job when there is none. With no job yet, after the latest education.
  const firstRole = roles[0];
  const lastStudy = education.filter((x) => !firstRole || x.year!.t <= firstRole.start!.t).at(-1);
  const begin = lastStudy
    ? { t: Math.min(lastStudy.year!.t + 0.45, now), date: lastStudy.year!.label, after: `after your ${lastStudy.e.qualification}` }
    : firstRole
      ? { t: firstRole.start!.t, date: firstRole.start!.label, after: "with your first job" }
      : null;
  if (begin) {
    moments.push({
      id: "journey-start",
      row: "journey",
      t: begin.t,
      date: begin.date,
      name: "Journey started",
      heading: "Your journey started",
      detail: `Your working life began ${begin.after}, so your journey starts here, not the day you joined CareerMetro.`,
      verified: false,
    });
  }
  const joined = Math.min(decimalYear(opts.joinedAt), now);
  moments.push({
    id: "joined",
    row: "journey",
    t: joined,
    date: monthLabel(opts.joinedAt),
    name: "Joined CareerMetro",
    heading: `Joined CareerMetro · heading for ${opts.destination}`,
    detail: "You set your next destination here. Pitstops and prep live on the Role line; this map keeps only the big moments.",
    verified: false,
  });

  return lifeLine.parse({
    now,
    destination: opts.destination,
    moments: moments.map(clipMoment),
    undated: undated.filter((u) => u.name.trim()).slice(0, 60).map((u) => ({ ...u, name: u.name.slice(0, 160) })),
  });
}

const clipMoment = (m: LifeMoment): LifeMoment => ({ ...m, name: m.name.slice(0, 80), heading: m.heading.slice(0, 160), detail: m.detail.slice(0, 400) });
