import type { MyApplicationView } from "@/lib/corporate/types";

/*
 * Arrivals' groups (handoff section 9; v44 gap list item 47): Moving forward, Offers, Waiting to hear, Not this time and
 * Withdrawn. Offers always has a place once there are applications, so the person sees where an offer will land.
 * "N more applied, waiting to hear" counts applications still at Applied, shown when others have moved on.
 */

export type ArrivalsGroupKey = "moving" | "offers" | "waiting" | "closed" | "withdrawn";
export type ArrivalsGroup = { key: ArrivalsGroupKey; title: string; hint: string; items: MyApplicationView[]; empty?: string };

const MOVING = new Set(["shortlisted", "ai", "team"]);

export const OFFERS_EMPTY = "Offers land here. Your line keeps going while you wait.";

export function arrivalsGroups(applications: readonly MyApplicationView[], opts: { showEmptyOffers?: boolean } = {}): ArrivalsGroup[] {
  const open = applications.filter((a) => !a.withdrawn);
  const groups: ArrivalsGroup[] = [
    { key: "moving", title: "Moving forward", hint: "Shortlisted and interviews", items: open.filter((a) => MOVING.has(a.stage)) },
    { key: "offers", title: "Offers", hint: "A company made you an offer", items: open.filter((a) => a.stage === "offer"), empty: OFFERS_EMPTY },
    { key: "waiting", title: "Waiting to hear", hint: "Sent, not reviewed yet", items: open.filter((a) => a.stage === "applied") },
    { key: "closed", title: "Not this time", hint: "Kept so you can learn from it", items: open.filter((a) => a.stage === "not_this_time") },
    { key: "withdrawn", title: "Withdrawn", hint: "You took these back", items: applications.filter((a) => a.withdrawn) },
  ];
  return groups.filter((g) => g.items.length || (g.key === "offers" && opts.showEmptyOffers && applications.length > 0));
}

/** "2 more applied, waiting to hear": only when some other application has moved, so "more" reads right. */
export function waitingLine(applications: readonly MyApplicationView[]): string | null {
  const open = applications.filter((a) => !a.withdrawn);
  const waiting = open.filter((a) => a.stage === "applied").length;
  return waiting && waiting < open.length ? `${waiting} more applied, waiting to hear` : null;
}
