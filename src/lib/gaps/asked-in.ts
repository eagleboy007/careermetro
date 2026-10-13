import { skillGroups, type RoleProfile } from "@/lib/schemas";

/**
 * "Asked in 7 of 10 postings" on the Gaps page (role-suggest-plan.md part B): how common a skill is, from the share of
 * public postings the role profile was measured on (data/jd-snapshots, written into src/content/roles as postingShare).
 * Only roles measured on postings have it; every other gap says nothing rather than guess.
 */
export function askedInLabel(share: number | null | undefined): string | null {
  if (typeof share !== "number" || !Number.isFinite(share) || share < 0 || share > 1) return null;
  const n = Math.round(share * 10);
  return n === 0 ? "Asked in fewer than 1 of 10 postings" : `Asked in ${n} of 10 postings`;
}

/** Measured shares by skill id, and by "one of these" group id at the group's most asked skill. */
export function postingShares(role: Pick<RoleProfile, "skills" | "groups">): ReadonlyMap<string, number> {
  const shares = new Map<string, number>();
  for (const s of role.skills) if (s.postingShare !== null) shares.set(s.skillId, s.postingShare);
  for (const g of skillGroups(role)) {
    const known = g.skillIds.flatMap((id) => (shares.has(id) ? [shares.get(id)!] : []));
    if (known.length) shares.set(`group:${g.id}`, Math.max(...known));
  }
  return shares;
}

/** The label for one gap: its group's share when it stands for a group, else its skill's. */
export function askedInForGap(gap: { skillId: string; groupId?: string }, shares: ReadonlyMap<string, number>): string | null {
  return askedInLabel(gap.groupId ? shares.get(`group:${gap.groupId}`) : shares.get(gap.skillId));
}
