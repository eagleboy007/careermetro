/*
 * The Market search and the Market's addresses (handoff C6). Kept free of the schemas, so the pickers in the browser
 * stay small: the server sends the current view's parameters and each option's key, and the browser builds the address.
 */

/** The Market's address parameters: a role slug, place keys ("IN", "KA", "KA:Bengaluru") and the map metric. */
export type MarketQuery = { role: string; place: string; map: string; a: string; b: string };

/** The address for the view with some parameters changed, always in the order role, place, map, a, b. */
export function marketQueryHref(base: MarketQuery, patch: Partial<MarketQuery> = {}): string {
  const v = { ...base, ...patch };
  const q = new URLSearchParams({ role: v.role, place: v.place, map: v.map, a: v.a, b: v.b });
  return `/market?${q.toString()}`;
}

export type MarketChoice = { kind: "role" | "state" | "city"; label: string; hint: string; patch: { role?: string; place?: string } };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Search by role, state or city: names starting with the words first, then names containing them. At most 8. */
export function searchMarket(choices: MarketChoice[], query: string, limit = 8): MarketChoice[] {
  const q = norm(query);
  if (!q) return [];
  const scored = choices
    .map((c, i) => {
      const n = norm(c.label);
      const words = n.split(" ");
      const score = n.startsWith(q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : -1;
      return { c, i, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.c);
}
