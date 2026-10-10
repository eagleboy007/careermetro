import { meProfile, type GapAnalysis, type JourneyStop, type MapLine, type MeProfile, type Profile } from "@/lib/schemas";
import { decimalYear, monthLabel, readYearMonth } from "@/lib/map/life-layout";

/** Goals shown one by one on the journey strip before the rest fold into "N more goals". */
const GOAL_STOPS = 5;

export type MeInput = {
  name: string;
  profile: Profile | null;
  analysis: GapAnalysis | null;
  /** The person's line, for the journey strip and the destination. */
  line: MapLine | null;
  skillName: (skillId: string) => string;
  joinedAt: Date;
  resumeReadAt: Date | null;
  now: Date;
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
  const current = line.goals.findIndex((g) => !g.proved);
  line.goals.slice(0, GOAL_STOPS).forEach((g, i) => {
    if (g.proved) stops.push({ state: "done", name: `Goal met · ${cut(g.name, 60)}`, detail: "Proved" });
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
 * Your profile from the confirmed profile and current gaps, in plain code. Stories, interests and proof stay empty until
 * their tables exist; certifications from a resume are listed but never marked verified.
 */
export function meFromProfile(input: MeInput): MeProfile {
  const { profile, analysis, line, now } = input;
  const nowT = decimalYear(now);

  const roles = (profile?.roles ?? [])
    .map((r, i) => ({ r, i, start: readYearMonth(r.start), end: readYearMonth(r.end) }))
    .sort((a, b) => (b.start?.t ?? -Infinity) - (a.start?.t ?? -Infinity));
  const spans: [number, number][] = [];
  const experience = roles.map(({ r, i, start, end }) => {
    const current = !!start && !end;
    const until = end?.t ?? (start ? nowT : null);
    if (start && until !== null && until > start.t) spans.push([start.t, until]);
    const dates = start ? `${start.label} to ${end ? end.label : "now"} · ${duration(start.t, until!)}` : (end?.label ?? "No dates on your resume");
    return {
      id: `role-${i}`,
      title: cut(r.title, 120),
      employer: cut(r.employer, 120),
      dates,
      current,
      highlights: r.highlights.slice(0, 8).map((h) => cut(h, 300)),
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
    aim: aim && cut(aim, 120),
    stats: [
      { value: String(have.length), label: "skills found", private: false },
      { value: String(gaps.length), label: gaps.length === 1 ? "gap to your next role" : "gaps to your next role", private: true },
      { value: String(line?.goals.filter((g) => g.proved).length ?? 0), label: "goals proved", private: true },
    ],
    journey: journeyFor(line, { joinedAt: input.joinedAt, resumeReadAt: input.resumeReadAt, gaps: gaps.length }),
    journeyLabel: line ? `${line.role.title} · ${plural(line.goals.length, "goal")}` : "starts with your resume",
    experience: experience.slice(0, 20),
    experienceTotal: worked(spans) > 0 ? duration(0, worked(spans)) : null,
    education: (profile?.education ?? [])
      .slice(0, 12)
      .map((e) => ({ qualification: cut(e.qualification, 160), institution: cut(e.institution, 160), year: cut(e.year ?? "", 40) })),
    skills: { have, weak: weak.slice(0, 12), missing: missing.slice(0, 12) },
    interests: [],
    stories: [],
    proofs: [],
    certifications: (profile?.certifications ?? [])
      .map((c) => c.trim())
      .filter((c, i, all) => c && all.findIndex((o) => o.toLowerCase() === c.toLowerCase()) === i)
      .slice(0, 30)
      .map((name) => ({ name: cut(name, 160), verified: false })),
    resumeReadOn: input.resumeReadAt ? monthLabel(input.resumeReadAt) : null,
  });
}
