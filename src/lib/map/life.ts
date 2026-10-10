import type { LifeLine, LifeMoment, Profile } from "@/lib/schemas";
import { decimalYear, monthLabel, readYearMonth } from "./life-layout";

/**
 * The Life line from a confirmed profile, in plain code. Work roles become moments by their start date, education by
 * its year, and the journey starts when the first education ends (or at the first job). Certificates on a resume have
 * no dates, so they wait in `undated` until the person adds one. Interests come with the profile page (build step 9).
 */
export function lifeFromProfile(profile: Profile, opts: { joinedAt: Date; now: Date; destination: string }): LifeLine {
  const now = decimalYear(opts.now);
  const moments: LifeMoment[] = [];
  const undated: LifeLine["undated"] = [];

  const education = profile.education
    .map((e, i) => ({ e, i, year: readYearMonth(e.year?.match(/\d{4}/)?.[0] ?? null) }))
    .filter((x) => {
      if (x.year && x.year.t <= now) return true;
      undated.push({ row: "education", name: x.e.qualification });
      return false;
    })
    .sort((a, b) => a.year!.t - b.year!.t);
  for (const { e, i, year } of education) {
    moments.push({
      id: `edu-${i}`,
      row: "education",
      // A year alone sits mid-year.
      t: year!.t + 0.45,
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
      if (x.start && x.start.t <= now) return true;
      undated.push({ row: "work", name: `${x.r.title} · ${x.r.employer}` });
      return false;
    })
    .sort((a, b) => a.start!.t - b.start!.t);
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

  for (const name of profile.certifications) undated.push({ row: "certificates", name });

  const firstEducation = education[0];
  const firstRole = roles[0];
  const begin = firstEducation
    ? { t: firstEducation.year!.t + 0.45, date: firstEducation.year!.label, after: `after your ${firstEducation.e.qualification}` }
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

  return { now, destination: opts.destination, moments: moments.map(clipMoment), undated: undated.slice(0, 60).map((u) => ({ ...u, name: u.name.slice(0, 160) })) };
}

const clipMoment = (m: LifeMoment): LifeMoment => ({ ...m, name: m.name.slice(0, 80), heading: m.heading.slice(0, 160), detail: m.detail.slice(0, 400) });
