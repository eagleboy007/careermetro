import { eliteShelfView, type EliteShelfCard, type EliteShelfView, type LibraryGoal, type LibraryItem, type ShelfEntry } from "@/lib/schemas";
import { ELITE_SHELF_GROUPS } from "@/lib/schemas/constants";

export type ShelfInput = {
  /** eliteOn for the person. Off, the shelf shows what each card is, with no link and no steps. */
  elite: boolean;
  entries: readonly ShelfEntry[];
  /** The healthy catalog as the Library shows it. A free source missing from it (a broken link) stays off the shelf. */
  items: readonly LibraryItem[];
  /** The catalog's skill ids by URL (src/content/resources.json), to put the sources for the person's goals first. */
  skillIdsByUrl: ReadonlyMap<string, readonly string[]>;
  /** The person's open goals in map order. */
  goals: readonly Pick<LibraryGoal, "skillId" | "name">[];
  /** Playbooks and drills not yet checked by someone in the role show on local and preview deployments only. */
  allowUnreviewed: boolean;
};

/**
 * The Elite shelf for one person, in plain code (handoff 12l): Paid courses (Coming soon slots), Playbooks and
 * walkthroughs, then Drills and labs. In each group the cards for the person's goals come first, in map order, then
 * the rest in the content file's order; never by who made them.
 */
export function buildEliteShelf(input: ShelfInput): EliteShelfView {
  const itemByUrl = new Map(input.items.map((i) => [i.url, i]));
  const goalFor = (skillIds: readonly string[]) => {
    const at = input.goals.findIndex((g) => skillIds.includes(g.skillId));
    return at < 0 ? { rank: input.goals.length, goal: null } : { rank: at, goal: input.goals[at].name };
  };

  const ranked = input.entries.flatMap((e, order): { card: EliteShelfCard; rank: number; order: number }[] => {
    if (e.type === "slot") return [{ card: { type: "slot", id: e.id, group: e.group, label: e.label, summary: e.summary }, rank: 0, order }];
    if (e.type === "own") {
      if (!e.reviewed && !input.allowUnreviewed) return [];
      const { rank, goal } = goalFor(e.skillIds);
      const card: EliteShelfCard = {
        type: "own",
        id: e.id,
        group: e.group,
        title: e.title,
        minutes: e.minutes,
        summary: e.summary,
        count: e.parts.length,
        reviewed: e.reviewed,
        goal,
        parts: input.elite ? e.parts : null,
      };
      return [{ card, rank, order }];
    }
    const item = itemByUrl.get(e.url);
    if (!item) return [];
    const { rank, goal } = goalFor(input.skillIdsByUrl.get(e.url) ?? []);
    const card: EliteShelfCard = {
      type: "free",
      id: e.id,
      group: e.group,
      title: item.title,
      provider: item.provider,
      kind: item.kind,
      minutes: item.minutes,
      why: e.why,
      goal,
      url: input.elite ? item.url : null,
    };
    return [{ card, rank, order }];
  });

  const groupAt = (c: EliteShelfCard) => ELITE_SHELF_GROUPS.indexOf(c.group);
  ranked.sort((a, b) => groupAt(a.card) - groupAt(b.card) || a.rank - b.rank || a.order - b.order);
  return eliteShelfView.parse({ elite: input.elite, cards: ranked.map((r) => r.card) });
}
