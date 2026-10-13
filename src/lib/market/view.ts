import { MARKET_METRICS, stateCode, type MarketMetric, type MarketPlace, type MarketState } from "@/lib/schemas";
import { marketQueryHref, type MarketChoice, type MarketQuery } from "./search";

export { marketQueryHref, searchMarket, type MarketChoice, type MarketQuery } from "./search";

/*
 * What the Market screen shows lives in its address (/market?role=…&place=…&map=…&a=…&b=…), so a choice survives a
 * reload and the back button, and nothing is stored. Only role slugs and place names go in it, never anything about
 * the person.
 */

export type MarketView = { role: string; place: MarketPlace; metric: MarketMetric; a: MarketPlace; b: MarketPlace };
type Params = Record<string, string | string[] | undefined>;

const INDIA = "IN";
export const INDIA_PLACE: MarketPlace = { kind: "india" };
const COMPARE_DEFAULTS: [MarketPlace, MarketPlace] = [
  { kind: "city", state: "KA", city: "Bengaluru" },
  { kind: "city", state: "MH", city: "Pune" },
];

/** "IN" for India, "KA" for a state, "KA:Bengaluru" for a city. */
export const placeKey = (p: MarketPlace) => (p.kind === "india" ? INDIA : p.kind === "state" ? p.state : `${p.state}:${p.city}`);

/** Reads a place key back, or null when it names no place we know. */
export function parsePlace(key: string | undefined, states: MarketState[]): MarketPlace | null {
  if (!key) return null;
  if (key === INDIA) return INDIA_PLACE;
  const [code, city, ...rest] = key.split(":");
  const parsed = stateCode.safeParse(code);
  if (!parsed.success || rest.length) return null;
  const state = states.find((s) => s.code === parsed.data);
  if (!state) return null;
  if (city === undefined) return { kind: "state", state: state.code };
  return state.cities.includes(city) ? { kind: "city", state: state.code, city } : null;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The view from the address. Anything unknown falls back to the default, so an old or hand-made link still opens. */
export function readMarketView(params: Params, { roles, states, defaultRole }: { roles: string[]; states: MarketState[]; defaultRole: string }): MarketView {
  const role = one(params.role);
  const metric = one(params.map);
  // A target role the Market has no figures for (a posting standing in, say) opens on the first role instead.
  const fallback = roles.includes(defaultRole) ? defaultRole : roles[0]!;
  return {
    role: role && roles.includes(role) ? role : fallback,
    place: parsePlace(one(params.place), states) ?? INDIA_PLACE,
    metric: MARKET_METRICS.includes(metric as MarketMetric) ? (metric as MarketMetric) : "openings",
    a: parsePlace(one(params.a), states) ?? COMPARE_DEFAULTS[0],
    b: parsePlace(one(params.b), states) ?? COMPARE_DEFAULTS[1],
  };
}

/** The view as its address parameters, so the pickers can build their addresses in the browser. */
export const marketQuery = (v: MarketView): MarketQuery => ({ role: v.role, place: placeKey(v.place), map: v.metric, a: placeKey(v.a), b: placeKey(v.b) });

/** The address for the view with some parts changed. */
export function marketHref(view: MarketView, patch: Partial<MarketView> = {}): string {
  return marketQueryHref(marketQuery({ ...view, ...patch }));
}

/** Everything the search can find: roles, then states, then cities. */
export function marketChoices(roles: { slug: string; title: string }[], states: MarketState[]): MarketChoice[] {
  const byName = [...states].sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...roles.map((r) => ({ kind: "role" as const, label: r.title, hint: "Role", patch: { role: r.slug } })),
    ...byName.map((s) => ({ kind: "state" as const, label: s.name, hint: "State", patch: { place: s.code } })),
    ...byName.flatMap((s) => s.cities.map((c) => ({ kind: "city" as const, label: c, hint: `City · ${s.name}`, patch: { place: `${s.code}:${c}` } }))),
  ];
}
