import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { marketStates } from "@/content/market/places";
import { FEED_SOURCE as APP_FEED_SOURCE, INDIA_ROW as APP_INDIA_ROW, STATE_CODES } from "@/lib/schemas";
import { accumulate, INDIA_ROW, main, previousMonth, ROW_COLUMNS, SEEN_COLUMNS } from "../../../scripts/jd-mining/accumulate.mjs";
import { CITIES, experienceBand, FEED_SOURCE, isIndia, MARKET_POSTING_COLUMNS, MARKET_ROLES, marketPostings, marketRole, placesOf, STATES } from "../../../scripts/jd-mining/market.mjs";
import { parseCsv, parseCsvObjects, toCsv } from "./csv.mjs";

// The monthly /market openings feed (scripts/jd-mining/market.mjs and accumulate.mjs, dev/market-plan.md), over
// synthetic postings only: the job boards are never called here.
const root = resolve(__dirname, "../../..");
type Posting = { ats: string; company: string; title: string; location: string; url: string; text: string };
const postings: Posting[] = JSON.parse(readFileSync(join(root, "fixtures/market/postings.json"), "utf8"));

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

describe("market role", () => {
  it("maps titles onto exactly the live roles, keeping seniority", () => {
    expect(new Set(MARKET_ROLES.map(([slug]) => slug))).toEqual(new Set(roleProfiles.map((r) => r.slug)));
    expect(MARKET_ROLES).toHaveLength(roleProfiles.length);
  });

  it("names the role for common titles", () => {
    const cases: [string, string | null, string?][] = [
      ["SOC Lead", "soc-lead"],
      ["Senior SOC Analyst (L2)", "soc-analyst-l2"],
      ["Cloud Security Engineer", "cloud-security-engineer"],
      ["Product Security Engineer", "appsec-engineer"],
      ["Engineering Manager, Payments", "engineering-manager"],
      ["Senior Data Scientist", "senior-data-scientist"],
      ["Data Scientist", "data-scientist"],
      ["Android Developer", "android-developer"],
      ["iOS Engineer", "ios-developer"],
      ["Flutter Developer", "cross-platform-mobile-developer"],
      ["Senior Backend Engineer", "senior-backend-engineer"],
      ["Backend Engineer", "java-backend-developer", "Java Spring"],
      ["Backend Engineer", null, "Go and Rust"],
      ["Machine Learning Engineer", "ml-engineer"],
      ["Product Designer", "ui-ux-designer"],
      ["Privacy Analyst", "privacy-analyst"],
      ["GRC Manager", "grc-manager"],
      ["Information Security Analyst", "information-security-analyst"],
      ["Penetration Tester", "penetration-tester"],
      ["Security Analyst", "cyber-security-analyst"],
      ["Product Manager", "product-manager"],
      ["Site Reliability Engineer", "site-reliability-engineer"],
      ["DevOps Engineer", "devops-engineer"],
      ["Cloud Engineer", "cloud-engineer"],
      ["Data Engineer", "data-engineer"],
      ["Database Administrator", "database-architect"],
      ["Data Analyst", "data-analyst"],
      ["Business Analyst", "business-analyst"],
      ["SDET", "qa-automation-engineer"],
      ["Full Stack Developer", "full-stack-developer"],
      ["Frontend Engineer", "frontend-developer"],
      ["Performance Marketing Manager", "digital-marketing-executive"],
    ];
    for (const [title, role, text] of cases) expect([title, marketRole(title, text)]).toEqual([title, role]);
    // Every live role is reachable from some title.
    expect(new Set(cases.map(([, r]) => r).filter(Boolean))).toEqual(new Set(roleProfiles.map((r) => r.slug)));
  });

  it("leaves out titles that are not one of the live roles", () => {
    for (const title of ["Sales Engineer", "Chief Information Security Officer", "Director, Product Management", "Data Analyst Intern", "Supplier Quality Engineer", "Recruiter", "Office Manager"])
      expect([title, marketRole(title)]).toEqual([title, null]);
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
    expect(isIndia("Remote - India")).toBe(true);
    expect(isIndia("Delhi NCR")).toBe(true);
    expect(isIndia("Remote, United States")).toBe(false);
    expect(isIndia("Indianapolis, Indiana")).toBe(false);
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
    expect(isIndia("Delhi, NY")).toBe(false);
    expect(isIndia("Hyderabad, Sindh, Pakistan")).toBe(false);
    expect(placesOf("Lahore, Punjab")).toEqual([]);
    expect(placesOf("Hyderabad")).toEqual([{ state: "TG", city: "Hyderabad" }]);
    expect(placesOf("Hyderabad, India; New York, US")).toEqual([{ state: "TG", city: "Hyderabad" }]);
    expect(placesOf("Mohali, Punjab")).toEqual([{ state: "PB", city: "Mohali" }]);
  });
});

describe("market postings (mine.mjs)", () => {
  const rows = marketPostings(postings);

  it("keeps India postings from Lever and Greenhouse only, one row per city, with URL, role, place and band", () => {
    expect(rows).toEqual([
      { url: postings[0]!.url, role: "data-analyst", state: "KA", city: "Bengaluru", band: "3-5" },
      { url: postings[1]!.url, role: "data-analyst", state: "KA", city: "Bengaluru", band: "0-2" },
      { url: postings[1]!.url, role: "data-analyst", state: "MH", city: "Mumbai", band: "0-2" },
      { url: postings[2]!.url, role: "product-manager", state: "HR", city: "Gurugram", band: "6-10" },
      { url: postings[3]!.url, role: "full-stack-developer", state: "", city: "", band: "0-2" },
      { url: postings[4]!.url, role: "frontend-developer", state: "MH", city: "Pune", band: "" },
    ]);
  });

  it("keeps no posting text, names or emails", () => {
    const written = toCsv([MARKET_POSTING_COLUMNS, ...rows.map((p) => MARKET_POSTING_COLUMNS.map((c) => p[c as keyof typeof p]))]);
    expect(written).not.toMatch(/@|Priya|SQL|example-labs\.test/);
    expect(Object.keys(rows[0]!)).toEqual(MARKET_POSTING_COLUMNS);
  });

  it("writes a state-only row when the location names a state but none of its cities", () => {
    const p = { ...postings[0]!, location: "Karnataka, India" };
    expect(marketPostings([p])).toEqual([{ url: p.url, role: "data-analyst", state: "KA", city: "", band: "3-5" }]);
  });

  it("dedupes on URL and place within a run", () => {
    expect(marketPostings([...postings, ...postings])).toEqual(rows);
  });
});

describe("accumulate", () => {
  const first = accumulate({ seen: [], postings: marketPostings(postings), month: "2026-09" });

  it("counts each posting in the month it first appears: India and a state once per posting, a city per city", () => {
    expect(first.rows).toEqual([
      ["data-analyst", "IN", "", "0-2", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["data-analyst", "IN", "", "3-5", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["data-analyst", "KA", "", "0-2", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["data-analyst", "KA", "", "3-5", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["data-analyst", "KA", "Bengaluru", "0-2", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["data-analyst", "KA", "Bengaluru", "3-5", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["data-analyst", "MH", "", "0-2", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["data-analyst", "MH", "Mumbai", "0-2", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["full-stack-developer", "IN", "", "0-2", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["product-manager", "IN", "", "6-10", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["product-manager", "HR", "", "6-10", 1, "", "", "", FEED_SOURCE, "2026-09"],
      ["product-manager", "HR", "Gurugram", "6-10", 1, "", "", "", FEED_SOURCE, "2026-09"],
    ]);
    expect(first.stats).toMatchObject({ seen: 6, added: 6, noBand: 1, baselineMonth: "2026-09" });
    expect(APP_FEED_SOURCE).toBe(FEED_SOURCE);
    expect(APP_INDIA_ROW).toBe(INDIA_ROW);
  });

  it("never counts a repost of the same URL twice across runs", () => {
    const extra = { url: "https://jobs.lever.co/example-labs/00000000-0000-4000-8000-000000000009", role: "data-analyst", state: "KA", city: "Bengaluru", band: "3-5" };
    const second = accumulate({ seen: first.seen, postings: [...marketPostings(postings), extra], month: "2026-10" });
    expect(second.stats).toMatchObject({ seen: 7, added: 1, baselineMonth: "2026-09" });
    expect(second.rows.filter((r) => r[9] === "2026-10")).toEqual([
      ["data-analyst", "IN", "", "3-5", 1, "", "", "", FEED_SOURCE, "2026-10"],
      ["data-analyst", "KA", "", "3-5", 1, "", "", "", FEED_SOURCE, "2026-10"],
      ["data-analyst", "KA", "Bengaluru", "3-5", 1, "", "", "", FEED_SOURCE, "2026-10"],
    ]);
    expect(second.rows.filter((r) => r[9] === "2026-09")).toEqual(first.rows);
  });

  it("labels the run on the 1st with the month that just ended", () => {
    expect(previousMonth(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10");
    expect(previousMonth(new Date("2027-01-01T03:00:00Z"))).toBe("2026-12");
    expect(() => accumulate({ seen: [], postings: [], month: "2026-13" })).toThrow();
  });

  it("runs from the command line over the data/market folder and this run's postings", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-market-"));
    const market = join(dir, "market");
    const postingsFile = join(dir, "market-postings.csv");
    mkdirSync(market);
    writeFileSync(join(market, "seen.csv"), toCsv([SEEN_COLUMNS, ...first.seen.map((s: Record<string, string>) => SEEN_COLUMNS.map((c) => s[c]))]));
    writeFileSync(postingsFile, toCsv([MARKET_POSTING_COLUMNS, ...marketPostings(postings).map((p) => MARKET_POSTING_COLUMNS.map((c) => p[c as keyof typeof p]))]));
    const run = spawnSync(process.execPath, [join(root, "scripts/jd-mining/accumulate.mjs"), market, postingsFile], { env: { ...process.env, MARKET_MONTH: "2026-10" }, encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("0 new India postings");
    expect(run.stdout).toContain("Baseline month: 2026-09");
    const rows = parseCsv(readFileSync(join(market, "market-rows.csv"), "utf8"));
    expect(rows[0]).toEqual(ROW_COLUMNS);
    expect(rows).toHaveLength(first.rows.length + 1);
    expect(parseCsvObjects(readFileSync(join(market, "seen.csv"), "utf8"))).toHaveLength(6);
  });

  it("refuses to start a new baseline when seen.csv is missing, unless told it is the first run", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-market-"));
    const market = join(dir, "market");
    const postingsFile = join(dir, "market-postings.csv");
    mkdirSync(market);
    writeFileSync(postingsFile, toCsv([MARKET_POSTING_COLUMNS, ...marketPostings(postings).map((p) => MARKET_POSTING_COLUMNS.map((c) => p[c as keyof typeof p]))]));
    const env = { MARKET_MONTH: "2026-09" };
    expect(() => main([market, postingsFile], env)).toThrow(/MARKET_BASELINE/);
    expect(existsSync(join(market, "market-rows.csv"))).toBe(false);
    main([market, postingsFile], { ...env, MARKET_BASELINE: "1" });
    expect(parseCsvObjects(readFileSync(join(market, "seen.csv"), "utf8"))).toHaveLength(6);
    expect(parseCsv(readFileSync(join(market, "market-rows.csv"), "utf8"))).toHaveLength(first.rows.length + 1);
  });
});

describe("csv", () => {
  it("round-trips quotes, commas and line breaks", () => {
    const rows = [["a", 'say "hi"', "x,y"], ["line\nbreak", "", "3"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(() => parseCsvObjects('"a","b"\n"1"\n')).toThrow(/expected 2/);
  });
});
