import { describe, expect, it } from "vitest";
import { marketStates } from "@/content/market/places";
import { STATE_CODES } from "@/lib/schemas";
import { experienceBand, placesOf, STATES } from "../../../scripts/jd-mining/market.mjs";
import { CITIES } from "./cities.mjs";
import { toCsv } from "./csv.mjs";

// The plain-code place and experience rules the daily Departures feed reads postings with
// (scripts/jd-mining/market.mjs, through src/lib/departures/feed-rules.mjs), and the city list the rollup shares
// (./cities.mjs), over synthetic strings only: the job boards are never called here.

describe("experience band", () => {
  it("comes only from stated years", () => {
    expect(experienceBand("We need 3-5 years of experience in Java")).toBe("3-5");
    expect(experienceBand("5+ years of professional experience")).toBe("3-5");
    expect(experienceBand("Minimum 7 years in security operations")).toBe("6-10");
    expect(experienceBand("0-2 years experience, freshers welcome")).toBe("0-2");
    expect(experienceBand("12+ years of industry experience")).toBe("10+");
    expect(experienceBand("10+ years of experience leading teams")).toBe("10+");
    expect(experienceBand("4 to 6 yrs of experience")).toBe("3-5");
    expect(experienceBand("1.5 years of hands-on experience")).toBe("0-2");
    expect(experienceBand("At least 4 years in a similar role")).toBe("3-5");
  });

  it("is null when no years are stated, never guessed from the title or a company blurb", () => {
    expect(experienceBand("Hands-on experience with Kubernetes")).toBeNull();
    expect(experienceBand("Founded 15 years ago, our company")).toBeNull();
    expect(experienceBand("We have served banks for over 20 years with deep industry experience.")).toBeNull();
    expect(experienceBand("A trusted partner for more than 12 years of industry experience")).toBeNull();
    expect(experienceBand("You must be at least 18 years old.")).toBeNull();
    expect(experienceBand("Senior Staff Engineer")).toBeNull();
  });

  it("collapses whitespace, so long runs of spaces read normally and never backtrack", () => {
    expect(experienceBand("3 -\n 5   years   of\texperience")).toBe("3-5");
    const text = `1${" ".repeat(10_000)}x`;
    const start = performance.now();
    expect(experienceBand(text)).toBeNull();
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("takes the posting's highest stated minimum, not a shorter ask for one skill", () => {
    expect(experienceBand("8+ years of experience in backend systems, including 2+ years of experience with Kafka")).toBe("6-10");
  });
});

describe("places", () => {
  it("knows exactly the cities on the /market tile map, each in its own state", () => {
    const mapCities = marketStates.flatMap((s) => s.cities.map((c) => `${s.code}|${c}`)).sort();
    expect(CITIES.map(([state, city]) => `${state}|${city}`).sort()).toEqual(mapCities);
    for (const [state] of CITIES) expect(STATE_CODES).toContain(state);
  });

  it("reads every Indian city a location names, by its usual spellings", () => {
    expect(placesOf("Bengaluru, Karnataka, India")).toEqual([{ state: "KA", city: "Bengaluru" }]);
    expect(placesOf("Mumbai, Maharashtra, Bangalore, Karnataka").map((p) => p.city).sort()).toEqual(["Bengaluru", "Mumbai"]);
    expect(placesOf("Gurgaon")).toEqual([{ state: "HR", city: "Gurugram" }]);
    expect(placesOf("New Delhi, India")).toEqual([{ state: "DL", city: "New Delhi" }]);
    expect(placesOf("Delhi")).toEqual([{ state: "DL", city: "New Delhi" }]);
    expect(placesOf("Delhi NCR")).toEqual([]);
    expect(placesOf("Trivandrum")).toEqual([{ state: "KL", city: "Thiruvananthapuram" }]);
    expect(placesOf("Jammu and Kashmir")).toEqual([{ state: "JK", city: "" }]);
    expect(placesOf("Remote, United States")).toEqual([]);
    expect(placesOf("Indianapolis, Indiana")).toEqual([]);
  });

  it("reads a state named without a city of it, and counts it with no city", () => {
    expect(placesOf("Karnataka, India")).toEqual([{ state: "KA", city: "" }]);
    expect(placesOf("Tamil Nadu")).toEqual([{ state: "TN", city: "" }]);
    expect(placesOf("Pune, Maharashtra; Kerala")).toEqual([{ state: "MH", city: "Pune" }, { state: "KL", city: "" }]);
    // Every state on the tile map is reachable by its name, except Delhi, which the city covers.
    for (const s of marketStates.filter((x) => x.code !== "DL")) expect([s.name, placesOf(s.name).some((p) => p.state === s.code)]).toEqual([s.name, true]);
    expect(new Set(STATES.map(([code]) => code))).toEqual(new Set(STATE_CODES.filter((c) => c !== "DL")));
  });

  it("keeps out places outside India that share a name", () => {
    expect(placesOf("Delhi, NY")).toEqual([]);
    expect(placesOf("Hyderabad, Sindh, Pakistan")).toEqual([]);
    expect(placesOf("Lahore, Punjab")).toEqual([]);
    expect(placesOf("Hyderabad")).toEqual([{ state: "TG", city: "Hyderabad" }]);
    expect(placesOf("Hyderabad, India; New York, US")).toEqual([{ state: "TG", city: "Hyderabad" }]);
    expect(placesOf("Mohali, Punjab")).toEqual([{ state: "PB", city: "Mohali" }]);
  });
});

describe("csv", () => {
  it("quotes every field and doubles quotes, the format mine.mjs writes", () => {
    expect(toCsv([["a", 'say "hi"', "x,y"], ["line\nbreak", null, 3]])).toBe('"a","say ""hi""","x,y"\n"line\nbreak","","3"\n');
  });
});
