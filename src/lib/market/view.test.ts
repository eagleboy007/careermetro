import { describe, expect, it } from "vitest";
import type { MarketState } from "@/lib/schemas";
import { marketChoices, marketHref, parsePlace, placeKey, readMarketView, searchMarket } from "./view";

const states: MarketState[] = [
  { code: "KA", name: "Karnataka", col: 1, row: 5, cities: ["Bengaluru", "Mysuru"] },
  { code: "MH", name: "Maharashtra", col: 1, row: 4, cities: ["Pune", "Mumbai"] },
  { code: "DL", name: "Delhi", col: 2, row: 2, cities: ["New Delhi"] },
];
const roles = ["data-analyst", "ml-engineer"];

describe("market address", () => {
  it("round-trips India, a state and a city", () => {
    for (const key of ["IN", "KA", "MH:Pune", "DL:New Delhi"]) expect(placeKey(parsePlace(key, states)!)).toBe(key);
  });

  it("refuses places it doesn't know", () => {
    for (const key of ["XX", "KA:Pune", "ka", "KA:Bengaluru:x", "", undefined]) expect(parsePlace(key, states)).toBeNull();
  });

  it("falls back to the defaults for anything unknown", () => {
    const v = readMarketView({ role: "astronaut", place: "ZZ", map: "colour", a: "nope" }, { roles, states, defaultRole: "data-analyst" });
    expect(v).toEqual({
      role: "data-analyst",
      place: { kind: "india" },
      metric: "openings",
      a: { kind: "city", state: "KA", city: "Bengaluru" },
      b: { kind: "city", state: "MH", city: "Pune" },
    });
    const w = readMarketView({ role: ["ml-engineer", "x"], place: "MH:Mumbai", map: "pay" }, { roles, states, defaultRole: "data-analyst" });
    expect([w.role, w.place, w.metric]).toEqual(["ml-engineer", { kind: "city", state: "MH", city: "Mumbai" }, "pay"]);
    expect(readMarketView({}, { roles, states, defaultRole: "posting-stand-in" }).role).toBe("data-analyst");
  });

  it("builds links with only slugs and place names in them", () => {
    const v = readMarketView({}, { roles, states, defaultRole: "data-analyst" });
    expect(marketHref(v, { place: { kind: "state", state: "KA" } })).toBe("/market?role=data-analyst&place=KA&map=openings&a=KA%3ABengaluru&b=MH%3APune");
  });
});

describe("market search", () => {
  const choices = marketChoices([{ slug: "data-analyst", title: "Data Analyst" }, { slug: "ml-engineer", title: "Machine Learning Engineer" }], states);

  it("finds roles, states and cities, names starting with the words first", () => {
    expect(searchMarket(choices, "pune").map((c) => [c.label, c.hint])).toEqual([["Pune", "City · Maharashtra"]]);
    expect(searchMarket(choices, "Kar")[0]).toMatchObject({ kind: "state", label: "Karnataka", patch: { place: "KA" } });
    expect(searchMarket(choices, "engineer")[0]).toMatchObject({ kind: "role", patch: { role: "ml-engineer" } });
    expect(searchMarket(choices, "delhi").map((c) => c.label)).toEqual(["Delhi", "New Delhi"]);
    expect(searchMarket(choices, "a").length).toBeLessThanOrEqual(8);
  });

  it("finds nothing for blank or unknown text", () => {
    expect(searchMarket(choices, "   ")).toEqual([]);
    expect(searchMarket(choices, "atlantis")).toEqual([]);
  });
});
