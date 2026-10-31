import type { Profile, RoleProfile } from "@/lib/schemas";
import { formatExperience, wellPastBand } from "@/lib/role-view";
import { countAbilities } from "./implies";
import { profileMatcher } from "./match";

/**
 * A role is only suggested once the resume shows at least this share of its required skills, counted as separate
 * abilities: a shown skill another shown skill implies isn't counted again (Excel and pivot tables are one).
 */
export const MIN_SHARE = 0.25;

export type RoleSuggestion = {
  slug: string;
  title: string;
  experience: string;
  /** Required skills the resume shows, out of `total`. */
  met: number;
  total: number;
  /** Up to 3 of those skills, to say why the role was suggested. */
  shown: string[];
  /** False when the role asks for more years than the resume shows; such roles go last. */
  fits: boolean;
};

/**
 * The roles the resume already covers best (Milin, 2026-10-12: freshers don't know which role to pick). Plain code
 * over the same matcher the Gaps page uses, so a suggestion never says something the gaps don't.
 */
export function suggestRoles(profile: Profile, roles: RoleProfile[], now = new Date(), limit = 3): RoleSuggestion[] {
  const years = profile.totalYearsExperience ?? 0;
  const matchRole = profileMatcher(profile, now);
  return roles
    .filter((role) => !wellPastBand(years, role.experienceBand))
    .map((role) => {
      const match = matchRole(role);
      const { requiredMet, requiredTotal, estimatedHours } = match.readiness;
      return {
        suggestion: {
          slug: role.slug,
          title: role.title,
          experience: formatExperience(role.experienceBand),
          met: requiredMet,
          total: requiredTotal,
          shown: match.met.slice(0, 3).map((s) => s.skillName),
          // A year's grace: a fresher can aim at a role that asks for 1 year.
          fits: years >= role.experienceBand.minYears - 1,
        },
        share: requiredTotal ? requiredMet / requiredTotal : 0,
        // Only the threshold counts abilities, as the closest role does; the card and the order still count every
        // shown skill ("3 of 8").
        abilityShare: requiredTotal ? countAbilities(match.met.map((s) => s.skillId)) / requiredTotal : 0,
        hours: estimatedHours,
      };
    })
    .filter((r) => r.suggestion.met > 0 && r.abilityShare >= MIN_SHARE)
    .sort(
      (a, b) =>
        Number(b.suggestion.fits) - Number(a.suggestion.fits) ||
        b.share - a.share ||
        a.hours - b.hours ||
        a.suggestion.title.localeCompare(b.suggestion.title),
    )
    .slice(0, limit)
    .map((r) => r.suggestion);
}
