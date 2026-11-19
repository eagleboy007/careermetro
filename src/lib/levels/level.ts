import type { LevelFacts, Profile } from "@/lib/schemas";
import { LEVELS, type LevelId } from "@/lib/schemas/levels";
import { levels } from "./data";

/**
 * C26: a person's level from the facts on their resume (docs/plans/signup-levels-plan.md section 2). Plain code: the
 * model states facts with their resume lines and never names a level, and no title is ever read, so a title the person
 * picks or the resume prints can't move it.
 */

/** Years at which each level after L1 starts: L2 from 1, L3 from 2.5 ... L8 from 16 (Data research's cut points). */
export const YEAR_CUTS = [1, 2.5, 4.5, 7.5, 11, 13.5, 16] as const;

/** A reporting line to the top of a company: a chief officer, CEO, MD, founder or the board ("Vice President" isn't). */
const TOP_REPORTING = /\b(ceo|cfo|coo|cto|cio|ciso|cro|md|managing director|(co-?)?founders?|board( of directors)?|chief [a-z ]*officer|(?<!vice[- ])president)\b/i;

/** What moved the level: years alone, the years in this kind of work, and the scope facts. */
export type LevelBasis = "years" | "this_work" | "scope";
export type ScopeSignal = "people_led" | "manages_managers" | "budget" | "reports_to_top";

export type LevelReading = {
  level: LevelId;
  /** Total years used: the profile's, or plain code's count over the role dates. Null when neither gives any. */
  years: number | null;
  basis: LevelBasis[];
  /** The scope facts that held, whether or not the years let them move the level. */
  scope: ScopeSignal[];
  facts: LevelFacts | null;
};

const index = (level: LevelId) => LEVELS.indexOf(level);
const at = (i: number): LevelId => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];

/** The level a number of years falls in, as an index (0 is L1). */
export function levelIndexForYears(years: number): number {
  return YEAR_CUTS.filter((cut) => years >= cut).length;
}

const month = (ym: string, end: boolean) => {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m ? m - 1 : end ? 11 : 0);
};

/**
 * Years of work from the role dates, overlaps counted once. A missing end reads as now for the newest role (the parser
 * lists roles newest first) and as the start for any other, so a role with no end date never adds years it may not have.
 */
export function yearsFromRoles(roles: Profile["roles"], now: Date): number | null {
  const today = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans = roles.flatMap((r, i) => {
    if (!r.start) return [];
    const start = month(r.start, false);
    const end = r.end ? month(r.end, true) + 1 : i === 0 ? today + 1 : start;
    return end > start ? [[start, Math.min(end, today + 1)] as const] : [];
  });
  if (!spans.length) return null;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [from, to] = sorted[0];
  for (const [s, e] of sorted.slice(1)) {
    if (s <= to) to = Math.max(to, e);
    else {
      total += to - from;
      [from, to] = [s, e];
    }
  }
  total += to - from;
  return Math.round((total / 12) * 10) / 10;
}

/** The scope facts that hold: 5 or more people led, leading managers, a budget or P&L line, or reporting to the top. */
export function scopeSignals(facts: LevelFacts | null | undefined): ScopeSignal[] {
  if (!facts) return [];
  const out: ScopeSignal[] = [];
  if (facts.peopleLed !== null && facts.peopleLed >= 5) out.push("people_led");
  if (facts.managesManagers) out.push("manages_managers");
  if (facts.budget) out.push("budget");
  if (facts.reportsTo && TOP_REPORTING.test(facts.reportsTo)) out.push("reports_to_top");
  return out;
}

/**
 * 1. Years: total years on the cut points. 2. A change of field: with years in this kind of work, the higher of their
 * level and one below the total's, so a career changer drops one step at most. 3. Scope: one step up, once, when a
 * scope fact holds and the years reach the next level's typical start. Never above L8.
 */
export function readLevel(profile: Pick<Profile, "totalYearsExperience" | "roles" | "levelFacts">, now: Date): LevelReading {
  const facts = profile.levelFacts ?? null;
  const years = profile.totalYearsExperience ?? yearsFromRoles(profile.roles, now);
  const basis: LevelBasis[] = ["years"];
  let i = years === null ? 0 : levelIndexForYears(years);
  const inThisWork = facts?.yearsInThisWork;
  if (years !== null && inThisWork !== null && inThisWork !== undefined && inThisWork < years) {
    const switched = Math.max(levelIndexForYears(inThisWork), i - 1);
    if (switched < i) {
      i = switched;
      basis.push("this_work");
    }
  }
  const scope = scopeSignals(facts);
  const next = levels.levels[i + 1];
  if (scope.length && next && (years ?? 0) >= next.typicalYears.min) {
    i += 1;
    basis.push("scope");
  }
  return { level: at(i), years, basis, scope, facts };
}

/** The level shown: the worked-out level moved by the person's one step ("Not quite right?"), kept within L1 to L8. */
export function shownLevel(level: LevelId, step: -1 | 1 | null): LevelId {
  return at(index(level) + (step ?? 0));
}

/** The level one step up, or null at L8. */
export function levelAbove(level: LevelId): LevelId | null {
  const i = index(level);
  return i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}
