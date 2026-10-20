import { describe, expect, it } from "vitest";
import type { MyApplicationView } from "@/lib/corporate/types";
import { arrivalsGroups, OFFERS_EMPTY, waitingLine } from "./groups";

const app = (id: string, stage: MyApplicationView["stage"], withdrawn = false) => ({ id, stage, withdrawn }) as unknown as MyApplicationView;

describe("Arrivals groups", () => {
  it("puts offers in their own group, apart from Moving forward", () => {
    const groups = arrivalsGroups([app("a", "team"), app("b", "offer"), app("c", "applied"), app("d", "not_this_time"), app("e", "shortlisted", true)]);
    expect(groups.map((g) => [g.key, g.items.map((a) => a.id)])).toEqual([
      ["moving", ["a"]],
      ["offers", ["b"]],
      ["waiting", ["c"]],
      ["closed", ["d"]],
      ["withdrawn", ["e"]],
    ]);
    expect(groups.find((g) => g.key === "closed")?.hint).toBe("Kept so you can learn from it");
  });

  it("keeps an empty Offers group with its line only when asked and there are applications", () => {
    const shown = arrivalsGroups([app("a", "applied")], { showEmptyOffers: true });
    expect(shown.map((g) => g.key)).toEqual(["offers", "waiting"]);
    expect(shown[0].empty).toBe(OFFERS_EMPTY);
    expect(arrivalsGroups([app("a", "applied")]).map((g) => g.key)).toEqual(["waiting"]);
    expect(arrivalsGroups([], { showEmptyOffers: true })).toEqual([]);
  });

  it("counts the applications still waiting once another has moved", () => {
    expect(waitingLine([app("a", "team"), app("b", "applied"), app("c", "applied")])).toBe("2 more applied, waiting to hear");
    expect(waitingLine([app("a", "applied"), app("b", "applied")])).toBeNull();
    expect(waitingLine([app("a", "team"), app("b", "applied", true)])).toBeNull();
    expect(waitingLine([])).toBeNull();
  });
});
