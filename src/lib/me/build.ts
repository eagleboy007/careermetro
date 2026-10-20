import { meProfile, type GapAnalysis, type JourneyStop, type MapLine, type MeProfile, type Profile, type StoryBox } from "@/lib/schemas";
import { decimalYear, monthLabel, readYearMonth } from "@/lib/map/life-layout";
import { indiaDate, profileCertifications, type ProofCertRow } from "./certs";
import { experienceCheck, jobKeyOf, jobToCheck, type JobCheckRow } from "./job-check-rules";
import { smartCheck } from "./smart";

/** Goals shown one by one on the journey strip before the rest fold into "N more goals". */
const GOAL_STOPS = 5;

/*
 * What the person added on Me by hand (docs/plans/me-editing-plan.md), as read by src/lib/me/edit-store.ts. Owner-only
 * ids ride along so their own view can offer Edit and Delete; the public profile drops them (src/lib/me/public.ts).
 */
export type AddedRole = { id: string; title: string; employer: string; startMonth: string; endMonth: string | null; isCurrent: boolean };
export type AddedEducation = { id: string; qualification: string; institution: string; year: string | null };
export type AddedStory = {
  id: string;
  title: string;
  where: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  boxes: StoryBox[];
  goalId: string | null;
  /** The linked goal's skill has accepted work proof (plan choice 6). Never set by the person. */
  confirmed: boolean;
};
export type MeAdditions = { roles: AddedRole[]; education: AddedEducation[]; stories: AddedStory[]; interests: string[] };

export const NO_ADDITIONS: MeAdditions = { roles: [], education: [], stories: [], interests: [] };

/** An added role in the resume profile's shape, for the work-email check's choice of current job (FR-47, plan choice 7). */
export const addedAsResumeRole = (r: AddedRole): Profile["roles"][number] => ({
  title: r.title,
  employer: r.employer,
  start: r.startMonth,
  end: r.isCurrent ? null : r.endMonth,
  highlights: [],
});

export type MeInput = {
  name: string;
  /** From Account settings; null when none. */
  headline?: string | null;
  profile: Profile | null;
  analysis: GapAnalysis | null;
  /** The person's line, for the journey strip and the destination. */
  line: MapLine | null;
  skillName: (skillId: string) => string;
  joinedAt: Date;
  resumeReadAt: Date | null;
  /** The resume is the sample ("Try a sample resume"). */
  resumeSample?: boolean;
  now: Date;
  /** The person's accepted certificate proofs (src/lib/me/store.ts); none for views that don't read proof. */
  proofCerts?: ProofCertRow[];
  /** The person's work-email checks of their jobs (FR-47); none for views that don't read them. */
  jobChecks?: readonly JobCheckRow[];
  /** Roles, education, stories and interests added on Me (docs/plans/me-editing-plan.md); none when not read. */
  added?: MeAdditions;
};

/** Cut to the schema's limit at a word break. */
const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Whole months from one decimal year to another, as "2 years 4 months", "5 months" or "Under a month". */
export function duration(from: number, to: number): string {
  const months = Math.max(0, Math.round((to - from) * 12));
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y && !m) return "Under a month";
  return [y && plural(y, "year"), m && plural(m, "month")].filter(Boolean).join(" ");
}

/** Years worked, counting overlapping roles (a promotion, a side project) once. */
export function worked(spans: [number, number][]): number {
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

/** The journey strip: signed up, resume read, then each goal on the line, then Match. */
export function journeyFor(line: MapLine | null, opts: { joinedAt: Date; resumeReadAt: Date | null; gaps: number }): JourneyStop[] {
  const stops: JourneyStop[] = [{ state: "done", name: "Signed up", detail: monthLabel(opts.joinedAt) }];
  if (!opts.resumeReadAt || !line) {
    stops.push({ state: "now", name: "Add your resume", detail: "Your gaps come next" });
    return stops;
  }
  stops.push({ state: "done", name: "Resume read", detail: `${monthLabel(opts.resumeReadAt)} · ${plural(opts.gaps, "gap")}` });
  // A skipped goal ("Not for me", FR-48) is never the current stop, as on the Map and Today (T60).
  const current = line.goals.findIndex((g) => !g.proved && !g.skipped);
  line.goals.slice(0, GOAL_STOPS).forEach((g, i) => {
    if (g.proved) stops.push({ state: "done", name: `Goal met · ${cut(g.name, 60)}`, detail: "Proved" });
    else if (g.skipped) stops.push({ state: "future", name: `${cut(g.name, 70)} goal`, detail: "Skipped" });
    else if (i === current) {
      const learning = g.status === "missing" && !g.learnDone;
      stops.push({
        state: "now",
        name: `${cut(g.name, 50)} goal · ${learning ? "learn" : "prove"}`,
        detail: learning ? "Getting ready" : "Fills the gap",
      });
    } else stops.push({ state: "future", name: `${cut(g.name, 70)} goal`, detail: g.status === "missing" ? "Learn, then prove" : "Prove" });
  });
  const more = line.goals.length - GOAL_STOPS;
  if (more > 0) stops.push({ state: current >= GOAL_STOPS ? "now" : "future", name: plural(more, "more goal"), detail: "On your map" });
  stops.push({ state: current === -1 ? "now" : "future", name: "Match", detail: "Destination" });
  return stops;
}

/**
 * Your profile from the confirmed profile and current gaps, in plain code, with what the person added on Me: added
 * roles merge with resume roles by start date and count in the total once where they overlap; added education follows
 * the resume's; stories carry their SMART check, worked out here and never stored. Proof stays empty until its table
 * exists. Certifications come from accepted certificate proof and the resume (src/lib/me/certs.ts); only a Credly badge
 * that matched is ever marked verified. The matcher, gaps and Match never read the added rows (plan choice 2).
 */
export function meFromProfile(input: MeInput): MeProfile {
  const { profile, analysis, line, now } = input;
  const added = input.added ?? NO_ADDITIONS;
  const nowT = decimalYear(now);

  type Row = { r: Profile["roles"][number]; id: string; own: { id: string; startMonth: string; endMonth: string | null } | null };
  const dated = (x: Row) => ({ ...x, start: readYearMonth(x.r.start), end: readYearMonth(x.r.end) });
  const newestFirst = (a: ReturnType<typeof dated>, b: ReturnType<typeof dated>) => (b.start?.t ?? -Infinity) - (a.start?.t ?? -Infinity);
  // The 20 newest resume roles and up to 20 added ones, merged by start date.
  const roles = [
    ...(profile?.roles ?? [])
      .map((r, i): Row => ({ r, id: `role-${i}`, own: null }))
      .map(dated)
      .sort(newestFirst)
      .slice(0, 20),
    ...added.roles.slice(0, 20).map((a): Row => ({ r: addedAsResumeRole(a), id: `me-${a.id}`, own: { id: a.id, startMonth: a.startMonth, endMonth: a.endMonth } })).map(dated),
  ].sort(newestFirst);
  const spans: [number, number][] = [];
  // The sample's jobs are made up (T111): its rows get no check at all, and only added roles can be the checked job.
  const sample = Boolean(input.resumeSample);
  // An added current role is a current job for the work-email check as a resume one is (FR-47).
  const checked = jobToCheck({ roles: roles.filter((x) => !sample || x.own).map((x) => x.r) });
  const checks = input.jobChecks ?? [];
  const keyOf = (r: Profile["roles"][number]) => {
    const k = jobKeyOf(r);
    return k.employerKey ? `${k.employerKey}|${k.startMonth}` : null;
  };
  // T95: an added role can share the badge key (company key and start month) with a resume role uploaded after it was
  // added. One check, one badge, on the row the check was made on: the side the check saved settles it. A check saved
  // before the side was kept falls back to the company as written on it, when only one side has it. Otherwise (no check
  // yet, or an old check both sides write the same) the badge goes to the side that is still current, the one
  // jobToCheck picks, and to the resume role when both are current or both ended. The other row shows no check at all,
  // only "Self-declared" where that applies.
  const ownerOf = new Map<string, "resume" | "added">();
  for (const { r, own } of roles) {
    const k = keyOf(r);
    if (!k || own || sample) continue;
    const clash = roles.filter((x) => x.own && keyOf(x.r) === k);
    if (!clash.length) continue;
    const resumeRows = roles.filter((x) => !x.own && keyOf(x.r) === k);
    const saved = checks.find((c) => `${c.employerKey}|${c.startMonth}` === k);
    if (saved?.source) {
      ownerOf.set(k, saved.source);
      continue;
    }
    const written = saved?.employer;
    const onResume = written !== undefined && resumeRows.some((x) => jobKeyOf(x.r).employer === written);
    const onAdded = written !== undefined && clash.some((x) => jobKeyOf(x.r).employer === written);
    if (onResume !== onAdded) {
      ownerOf.set(k, onAdded ? "added" : "resume");
      continue;
    }
    const resumeCurrent = resumeRows.some((x) => !x.r.end);
    const addedCurrent = clash.some((x) => !x.r.end);
    ownerOf.set(k, addedCurrent && !resumeCurrent ? "added" : "resume");
  }
  const checkOf = (r: Profile["roles"][number], added: boolean) => {
    if (sample && !added) return null;
    const k = keyOf(r);
    const owner = k ? ownerOf.get(k) : undefined;
    const side = added ? "added" : "resume";
    return owner && owner !== side ? experienceCheck(r, null, []) : experienceCheck(r, checked, checks, side);
  };
  const experience = roles.map(({ r, id, own, start, end }) => {
    const current = !!start && !end;
    const until = end?.t ?? (start ? nowT : null);
    if (start && until !== null && until > start.t) spans.push([start.t, until]);
    const dates = start ? `${start.label} to ${end ? end.label : "now"} · ${duration(start.t, until!)}` : (end?.label ?? "No dates on your resume");
    return {
      id,
      title: cut(r.title, 120),
      employer: cut(r.employer, 120),
      dates,
      current,
      highlights: r.highlights.slice(0, 8).map((h) => cut(h, 300)),
      check: checkOf(r, !!own),
      ...(own ? { added: own } : {}),
    };
  });

  const gaps = analysis?.gaps ?? [];
  const seen = new Set<string>();
  const unique = (names: string[]) =>
    names
      .filter((n) => {
        const k = n.trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((n) => cut(n.trim(), 80));
  const missing = unique(gaps.filter((g) => g.status === "missing").map((g) => g.skillName));
  const weak = unique(gaps.filter((g) => g.status !== "missing").map((g) => g.skillName));
  const have = unique([...(analysis?.metSkillIds ?? []).map(input.skillName), ...(profile?.skills ?? []).map((s) => s.name)]).slice(0, 30);

  const aim = line?.role.title ?? null;
  return meProfile.parse({
    name: cut(input.name, 120),
    headline: input.headline ?? null,
    aim: aim && cut(aim, 120),
    stats: [
      { value: String(have.length), label: "skills found", private: false },
      { value: String(gaps.length), label: gaps.length === 1 ? "gap to your next role" : "gaps to your next role", private: true },
      { value: String(line?.goals.filter((g) => g.proved).length ?? 0), label: "goals proved", private: true },
    ],
    journey: journeyFor(line, { joinedAt: input.joinedAt, resumeReadAt: input.resumeReadAt, gaps: gaps.length }),
    journeyLabel: line ? `${line.role.title} · ${plural(line.goals.length, "goal")}` : "starts with your resume",
    experience,
    experienceTotal: worked(spans) > 0 ? duration(0, worked(spans)) : null,
    education: [
      ...(profile?.education ?? [])
        .slice(0, 12)
        .map((e) => ({ qualification: cut(e.qualification, 160), institution: cut(e.institution, 160), year: cut(e.year ?? "", 40) })),
      ...added.education.slice(0, 12).map((e) => ({
        qualification: cut(e.qualification, 160),
        institution: cut(e.institution, 160),
        year: cut(e.year ?? "", 40),
        added: { id: e.id },
      })),
    ],
    skills: { have, weak: weak.slice(0, 12), missing: missing.slice(0, 12) },
    interests: added.interests.slice(0, 30),
    stories: added.stories.slice(0, 50).map((s) => ({
      id: s.id,
      title: s.title,
      where: s.where,
      boxes: s.boxes,
      situation: s.situation,
      task: s.task,
      action: s.action,
      result: s.result,
      ...smartCheck({ ...s, goalLinked: s.goalId !== null }),
      confirmed: s.confirmed,
      fromGoal: s.goalId !== null,
      goalId: s.goalId,
    })),
    proofs: [],
    certifications: profileCertifications({ proofs: input.proofCerts ?? [], resume: profile?.certifications ?? [], today: indiaDate(now) }),
    resumeReadOn: input.resumeReadAt ? monthLabel(input.resumeReadAt) : null,
    resumeSample: Boolean(input.resumeReadAt && input.resumeSample),
    // Read from the line, so Me and the Map always show the same Nearby lines.
    nearby: line?.nearby ?? null,
    changeRoleHref: line?.resumeId ? `/resume/${line.resumeId}/role` : null,
  });
}
