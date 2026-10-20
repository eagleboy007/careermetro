import type { LibraryGoal, LibraryItem, LibraryKind, LibraryView } from "@/lib/schemas";

/*
 * The Library's search and filters (handoff 12a), in plain code so the screen, the design page and the tests share
 * them. Nothing here reads the database or ships Zod, so client components can use it.
 */

export type LibraryFilters = {
  query: string;
  kind: LibraryKind | null;
  /** Shorter than this many minutes. */
  under: number | null;
  /** Hindi only, when on. */
  hindi: boolean;
};

export const NO_FILTERS: LibraryFilters = { query: "", kind: null, under: null, hindi: false };

/** How many search results show below the goal cards, from the rest of the catalog. */
export const MORE_RESULTS = 20;

export const filtersOn = (f: LibraryFilters) => Boolean(f.query.trim() || f.kind || f.under || f.hindi);

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Every word of the search in its title, source, type or skills, ignoring case; then the type, length and language. */
export function matches(item: LibraryItem, f: LibraryFilters): boolean {
  if (f.kind && item.kind !== f.kind) return false;
  if (f.under && item.minutes >= f.under) return false;
  if (f.hindi && item.language !== "Hindi") return false;
  const ws = words(f.query);
  if (!ws.length) return true;
  const text = [item.title, item.provider, item.kind, ...item.skills].join(" ").toLowerCase();
  return ws.every((w) => text.includes(w));
}

export type GoalCard = { goal: LibraryGoal; items: LibraryItem[] };

/**
 * The goal cards with the resources that pass the filters. A goal whose name matches the search keeps all its
 * resources that pass the other filters. With any filter on, a goal with nothing left is left out, as in the prototype.
 */
export function goalCards(view: Pick<LibraryView, "goals" | "items">, f: LibraryFilters): GoalCard[] {
  const byId = new Map(view.items.map((i) => [i.id, i]));
  const on = filtersOn(f);
  return view.goals.flatMap((goal) => {
    const own = goal.resourceIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    const nameHit = words(f.query).every((w) => goal.name.toLowerCase().includes(w));
    const items = own.filter((i) => matches(i, nameHit ? { ...f, query: "" } : f));
    const card: GoalCard = { goal, items };
    return on && !items.length ? [] : [card];
  });
}

/** Search results from the rest of the catalog: only while something is typed, never what the cards above show. */
export function moreResults(items: LibraryItem[], f: LibraryFilters, shown: ReadonlySet<string>, limit = MORE_RESULTS): LibraryItem[] {
  if (!f.query.trim()) return [];
  return items.filter((i) => !shown.has(i.id) && matches(i, f)).slice(0, limit);
}

/** Items from a list of ids that pass the filters, in the catalog's order. */
export function pick(items: LibraryItem[], ids: ReadonlySet<string>, f: LibraryFilters): LibraryItem[] {
  return items.filter((i) => ids.has(i.id) && matches(i, f));
}

/**
 * Goals whose learning is done: the learn pitstop ticked, or every resource on its card finished. The Finished tab
 * asks for the proof; finishing never fills the gap.
 */
export function readyToProve(view: Pick<LibraryView, "goals" | "finished">): LibraryGoal[] {
  const done = new Set(view.finished);
  return view.goals.filter((g) => g.learnDone || (g.resourceIds.length > 0 && g.resourceIds.every((id) => done.has(id))));
}

/** "45 min", "4 h", "about 3 h", like the prototype. */
export function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} h` : `about ${Math.round(minutes / 60)} h`;
}

/** The goal a resource counts toward: the first card that lists it. */
export function goalOf(goals: LibraryGoal[], itemId: string): LibraryGoal | null {
  return goals.find((g) => g.resourceIds.includes(itemId)) ?? null;
}
