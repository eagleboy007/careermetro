/**
 * The target role picked from the chips above the upload box on Today (v44 gap list item 1), carried to the role
 * step after the parse in this tab's sessionStorage, the way the stand-in title is (src/lib/stand-in-title.ts). Only a
 * role slug from the chip list is kept. Nothing is stored on the server: the role step still opens the Gaps page, with
 * the picked role first. Storage can be missing or blocked: then nothing is carried and the role step looks as before.
 */
const KEY = "cm-target-role";

/** The chips, in the prototype's order. Each slug is a role profile in src/content/roles (checked in the tests). */
export const TARGET_ROLE_CHIPS = [
  { slug: "cyber-security-analyst", title: "Cyber Security Analyst" },
  { slug: "data-analyst", title: "Data Analyst" },
  { slug: "cloud-engineer", title: "Cloud Engineer" },
] as const;

export type TargetRoleChip = (typeof TARGET_ROLE_CHIPS)[number];

const known = (slug: string): TargetRoleChip | undefined => TARGET_ROLE_CHIPS.find((c) => c.slug === slug);

/** Keeps the picked role, or forgets any earlier one when `slug` is null ("More roles") or not a chip. */
export function saveTargetRole(slug: string | null): void {
  try {
    if (slug && known(slug)) sessionStorage.setItem(KEY, slug);
    else sessionStorage.removeItem(KEY);
  } catch {}
}

/** The carried role's slug, or "" without one. Reading leaves it in place. */
export function peekTargetRole(): string {
  try {
    const slug = sessionStorage.getItem(KEY) ?? "";
    return known(slug) ? slug : "";
  } catch {
    return "";
  }
}

/** Forgets the carried role, once the role step has taken it. */
export function clearTargetRole(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
