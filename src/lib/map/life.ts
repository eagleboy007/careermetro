import { skills as taxonomy } from "@/content";
import { certificationsIn, skillsNamedIn } from "@/lib/gaps/match";
import { lifeLine, type LifeLine, type LifeMoment, type Profile } from "@/lib/schemas";
import { decimalYear, monthLabel, readYearMonth } from "./life-layout";

/**
 * The Life line from a confirmed profile, in plain code. Work roles become moments by their start date, education by
 * its year, certificates by the month they were earned, and the journey starts when the first education ends (or at
 * the first job). A certificate with no date waits in `undated` until the person adds one. Interests come from Me
 * (src/lib/me/edit-store.ts), which keeps no dates for them: they go in as one undated row at the end of `undated`
 * (see `interestsRow`). Anything that can't be placed sensibly (no date, a year before 1950, a date still ahead) waits
 * in `undated` too. Dotted links between moments come from `lifeLinks`.
 */
const EARLIEST = 1950;
/** Caps that keep a very long resume inside the schema's 120 moments. */
const MAX_EDUCATION = 20;
const MAX_ROLES = 80;
const MAX_CERTIFICATES = 16;
const MAX_LINKS = 12;
/** The schema's caps on `undated`: 60 rows of up to 160 characters. */
const MAX_UNDATED = 60;
const UNDATED_NAME = 160;
const INTEREST_SEPARATOR = " · ";

/**
 * The person's interests as one undated Life line row, "Data · Cricket stats · Public speaking", in the order they
 * were added. Blank and repeated ones (ignoring case) are left out. What doesn't fit in the row's 160 characters is
 * counted at the end ("+3"), never cut mid-word. Null with no interests.
 */
export function interestsRow(interests: readonly string[]): LifeLine["undated"][number] | null {
  const seen = new Set<string>();
  const names = interests
    .map((i) => i.replace(/\s+/g, " ").trim())
    .filter((i) => {
      const key = i.toLowerCase();
      if (!i || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!names.length) return null;
  const all = names.join(INTEREST_SEPARATOR);
  if (all.length <= UNDATED_NAME) return { row: "interests", name: all };
  // Too long for one row: as many as fit, then how many more. The first one always shows, clipped if it alone is too long.
  const more = (n: number) => `${INTEREST_SEPARATOR}+${n}`;
  let shown = 1;
  while (shown < names.length && names.slice(0, shown + 1).join(INTEREST_SEPARATOR).length + more(names.length - shown - 1).length <= UNDATED_NAME) shown++;
  const tail = more(names.length - shown);
  let head = names.slice(0, shown).join(INTEREST_SEPARATOR);
  if (head.length + tail.length > UNDATED_NAME) head = `${head.slice(0, UNDATED_NAME - tail.length - 1).trimEnd()}…`;
  return { row: "interests", name: `${head}${tail}` };
}

/** "2019-2023", "2019 – 2023" or "2023" → 2023, the year it ended. Null for "2019 – Present" or no year. */
function educationYear(value: string | null): ReturnType<typeof readYearMonth> {
  if (!value || /present|pursuing|ongoing|current/i.test(value)) return null;
  return readYearMonth(value.match(/\d{4}/g)?.at(-1) ?? null);
}

export function lifeFromProfile(
  profile: Profile,
  opts: {
    joinedAt: Date;
    now: Date;
    destination: string;
    /** The current analysis's met skills, for "counts toward". */
    metSkillIds?: readonly string[];
    /** The interests the person added on Me, oldest first. */
    interests?: readonly string[];
  },
): LifeLine {
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

  const certificates = profile.certifications
    .map((c, i) => ({ c, i, earned: readYearMonth(c.earned) }))
    .filter((x) => {
      if (!x.c.name.trim()) return false;
      if (x.earned && x.earned.t >= EARLIEST && x.earned.t <= now) return true;
      undated.push({ row: "certificates", name: x.c.name.trim() });
      return false;
    })
    .sort((a, b) => a.earned!.t - b.earned!.t)
    .slice(-MAX_CERTIFICATES);
  for (const { c, i, earned } of certificates) {
    const known = certificationsIn(c.name, opts.now)[0]?.cert;
    const expires = c.expires === "none" ? "Doesn't expire." : c.expires ? `Valid until ${readYearMonth(c.expires)?.label ?? c.expires}.` : "";
    moments.push({
      id: `cert-${i}`,
      row: "certificates",
      t: earned!.t,
      date: earned!.label,
      name: c.name.trim(),
      heading: c.name.trim(),
      detail: [known ? `${known.issuer}.` : "", expires].filter(Boolean).join(" "),
      verified: false,
    });
  }

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
    links: lifeLinks(profile, moments, { now: opts.now, destination: opts.destination, metSkillIds: opts.metSkillIds ?? [] }),
    undated: undatedRows(undated, interestsRow(opts.interests ?? [])),
  });
}

/** The resume's undated lines, then the interests row last, within the schema's caps; the interests row always fits. */
function undatedRows(fromResume: LifeLine["undated"], interests: LifeLine["undated"][number] | null): LifeLine["undated"] {
  const rows = fromResume
    .filter((u) => u.name.trim())
    .slice(0, interests ? MAX_UNDATED - 1 : MAX_UNDATED)
    .map((u) => ({ ...u, name: u.name.slice(0, UNDATED_NAME) }));
  return interests ? [...rows, interests] : rows;
}

const clipMoment = (m: LifeMoment): LifeMoment => ({ ...m, name: m.name.slice(0, 80), heading: m.heading.slice(0, 160), detail: m.detail.slice(0, 400) });

const skillName = new Map(taxonomy.map((s) => [s.id, s.name]));

/** "2024-06" as a decimal year, or null. */
const yearOf = (value: string | null) => readYearMonth(value)?.t ?? null;

/**
 * Where one moment fed another (handoff section 7, "Dotted links show where one fed another"), in plain code over the
 * skill taxonomy, never guessed:
 * - a certificate, or a qualification whose name names a skill, links to the first job still running after it whose
 *   title or highlights name one of those skills;
 * - a certificate that proves a skill the current analysis counts as met links to "Joined CareerMetro".
 * At most one link per pair, and the first skill in the taxonomy's order names it, so the same profile always draws
 * the same links.
 */
export function lifeLinks(
  profile: Profile,
  moments: readonly LifeMoment[],
  opts: { now: Date; destination: string; metSkillIds: readonly string[] },
): LifeLine["links"] {
  const placed = new Set(moments.map((m) => m.id));
  const nowT = decimalYear(opts.now);
  const dated = profile.roles
    .map((r, i) => ({ id: `work-${i}`, title: r.title, start: yearOf(r.start), end: yearOf(r.end), skills: skillsNamedIn([r.title, ...r.highlights].join("\n")) }))
    .filter((j) => placed.has(j.id) && j.start !== null)
    .sort((a, b) => a.start! - b.start!);
  // A role with no end runs until the next one starts; only the latest runs on to now.
  const jobs = dated.map((j, k) => ({ ...j, end: j.end ?? (k < dated.length - 1 ? dated[k + 1].start! : nowT) }));
  const firstShared = (from: Iterable<string>, to: ReadonlySet<string>) => {
    const ids = new Set(from);
    return taxonomy.find((s) => ids.has(s.id) && to.has(s.id))?.id;
  };
  const links: LifeLine["links"] = [];
  const feed = (id: string, name: string, t: number, skills: Iterable<string>) => {
    const list = [...skills];
    if (!list.length) return;
    for (const job of jobs) {
      if (job.end < t) continue;
      const skill = firstShared(list, job.skills);
      if (skill) {
        links.push({ from: id, to: job.id, text: clipText(`${name} fed the ${skillName.get(skill)} you used as ${job.title}`) });
        return;
      }
    }
  };

  const met = new Set(opts.metSkillIds);
  profile.certifications.forEach((c, i) => {
    const id = `cert-${i}`;
    const t = yearOf(c.earned);
    if (!placed.has(id) || t === null) return;
    const known = certificationsIn(c.name, opts.now).map((f) => f.cert);
    feed(id, c.name.trim(), t, known.flatMap((k) => [...k.proves, ...k.partial]));
    // An expired certificate shows its skills only as weak, so it counts toward nothing.
    const until = c.expires && c.expires !== "none" ? readYearMonth(c.expires) : null;
    const expired = until !== null && until.t + (/^\d{4}$/.test(c.expires!) ? 1 : 1 / 12) <= nowT;
    const counted = expired ? undefined : firstShared(known.flatMap((k) => k.proves), met);
    if (counted && placed.has("joined")) {
      links.push({ from: id, to: "joined", text: clipText(`${c.name.trim()} counts toward ${skillName.get(counted)} for ${opts.destination}`) });
    }
  });
  profile.education.forEach((e, i) => {
    const id = `edu-${i}`;
    const moment = moments.find((m) => m.id === id);
    if (moment) feed(id, e.qualification.trim(), moment.t, skillsNamedIn(e.qualification));
  });
  return links.slice(0, MAX_LINKS);
}

const clipText = (text: string) => (text.length > 200 ? `${text.slice(0, 199)}…` : text);
