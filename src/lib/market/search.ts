/* The Market search (handoff C6). Kept free of the schemas, so the search box in the browser stays small. */

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
